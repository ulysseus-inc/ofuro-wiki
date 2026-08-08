import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { SyncService } from './sync.service';
import { AwarenessService } from './awareness.service';
import { IndexerService } from '../search/indexer.service';
import { PrismaService } from '../../prisma.service';
import { PermissionService } from '../permission/permission.service';
import type { DocAction } from '../permission/doc-role';
import { DocEditAggregator } from '../audit/doc-edit-aggregator';
import { AuditService } from '../audit/audit.service';
import { LogFileService } from '../logging/log-file.service';
import { parseAllowedOrigins } from '../../common/cors';

// AFFiNE protocol: response wrapper
type WsResponse<T> = { data: T } | { error: { name: string; message: string } };

function ok<T>(data: T): WsResponse<T> {
  return { data };
}

function err(name: string, message: string): WsResponse<never> {
  return { error: { name, message } };
}

// Room naming convention matching AFFiNE server
function syncRoom(spaceType: string, spaceId: string): string {
  return `${spaceType}:${spaceId}:sync`;
}

function syncRoom026(spaceType: string, spaceId: string): string {
  return `${spaceType}:${spaceId}:sync-026`;
}

function awarenessRoom(
  spaceType: string,
  spaceId: string,
  docId: string,
): string {
  return `${spaceType}:${spaceId}:${docId}:awareness`;
}

/**
 * #90: 利用者が作ったドキュメントではない内部データか。
 *
 * ワークスペースのルート doc（docId が spaceId と同じ）や、
 * `db$` / `userdata$` などの内部ドキュメントは編集操作として記録しない。
 */
function isInternalDoc(spaceId: string, docId: string): boolean {
  return docId === spaceId || docId.includes('$');
}

interface ConnectionState {
  userId?: string;
  // #90: 監査ログ・アクセスログに「当時の利用者」を残すため保持する。
  // 接続時の1クエリで取得し、以降は使い回す（毎回引くと打鍵ごとの負荷になる）。
  userEmail?: string;
  userName?: string;
  spaces: Set<string>; // joined "spaceType:spaceId" keys
  awarenessDocs: Set<string>; // joined "spaceType:spaceId:docId" keys
  // #90: この接続で既に「新規作成かどうか」を判定済みのドキュメント（"spaceId:docId"）。
  // 判定は1回だけでよく、打鍵のたびに問い合わせないためのもの。
  checkedDocs: Set<string>;
  connectedAt: number;
  ip?: string;
  userAgent?: string;
}

/**
 * ⚠️ #90: **1メッセージごとに出る記録は `logger.debug()` を使うこと。**
 *
 * `space:push-doc-update` は打鍵のたび、`space:load-doc-timestamps` は
 * 定期的に飛ぶ。これらを `logger.log()`（INFO）で出すと、実測で
 * **アプリケーションログの77%**を占め、100名規模では1日140MBに達した。
 *
 * INFO に残すのは接続・切断・join・リストアモードなど、**接続単位の事象**のみ。
 * 詳細が必要なときは LOG_LEVEL=debug で有効化する（docs/logging.md 3章）。
 */
@WebSocketGateway({
  cors: {
    // #2/M-3: HTTP と同じ ALLOWED_ORIGINS ポリシーに従う（従来は any-origin 固定だった）
    origin: parseAllowedOrigins(),
    credentials: true,
  },
  // AFFiNE frontend uses root namespace '/'
  namespace: '/',
  transports: ['polling', 'websocket'],
  pingInterval: 15000,
  pingTimeout: 10000,
})
export class SyncGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SyncGateway.name);
  private connections = new Map<string, ConnectionState>();
  private _restoreMode = false;

  // space:push-doc-update 等は高頻度で呼ばれるため、アクセス判定結果を短時間
  // キャッシュして DB 負荷を抑える。TTL は「メンバー剥奪が反映されるまでの
  // 最大遅延」でもあるため短めに設定する。
  private readonly accessCache = new Map<
    string,
    { authorized: boolean; expiresAt: number }
  >();
  private static readonly ACCESS_CACHE_TTL_MS = 5000;
  private static readonly ACCESS_CACHE_MAX = 10000;

  /**
   * #97: ドキュメント単位の判定のキャッシュ。
   *
   * ⚠️ `space:push-doc-update` は**打鍵のたびに飛ぶ**。毎回 DB を引けない。
   *
   * ワークスペース単位のキャッシュ（上）と**同じ寿命・同じ上限**にしてある。
   * 権限を外してから最大 5 秒は編集が通りうるが、
   * 「権限を外した瞬間に相手のタブが止まる」ことまでは求めない。
   * **短い寿命で妥協し、複雑な無効化の仕組みを持たない**方が安全側に働く
   * （無効化の実装漏れは、期限切れを待たない=永久に古い判定、を意味する）。
   */
  private readonly docAccessCache = new Map<
    string,
    { allowed: boolean; expiresAt: number }
  >();

  /** Enter restore mode: disconnect all clients and reject new connections/pushes */
  async enterRestoreMode(): Promise<void> {
    this._restoreMode = true;
    this.logger.log('Entering restore mode — disconnecting all clients');
    const sockets = await this.server.fetchSockets();
    for (const socket of sockets) {
      socket.disconnect(true);
    }
  }

  /** Exit restore mode: allow connections again */
  exitRestoreMode(): void {
    this._restoreMode = false;
    this.logger.log('Exiting restore mode — accepting connections');
  }

  constructor(
    private syncService: SyncService,
    private awarenessService: AwarenessService,
    private jwtService: JwtService,
    private indexerService: IndexerService,
    private prisma: PrismaService,
    // #97: ドキュメント単位の認可。判定はすべてここに委ねる
    private permission: PermissionService,
    // #90: 編集は打鍵のたびに飛ぶため、15分ごとに1件へ集約して記録する
    private editAggregator: DocEditAggregator,
    // #90: WebSocket の接続・切断はアクセスログへ。engine.io のハンドシェイクは
    // Express を通らないため、ミドルウェアでは記録できない
    private logFile: LogFileService,
    private audit: AuditService,
  ) {
    // #97: 権限が変わったら即座に判定キャッシュを捨てる（7章）
    this.permission.onInvalidate((workspaceId, docId, userId) =>
      this.invalidateDocAccess(workspaceId, docId, userId),
    );
  }

  async handleConnection(client: Socket) {
    // Reject connections during restore
    if (this._restoreMode) {
      this.logger.log(`Rejecting connection ${client.id} — restore in progress`);
      client.disconnect(true);
      return;
    }

    try {
      const token =
        client.handshake.auth?.token ||
        this.parseCookie(client.handshake.headers.cookie, 'affine_token');

      let userId: string | undefined;
      let revocationCheck: { sub: string; tv: number } | undefined;
      if (token) {
        try {
          const payload = this.jwtService.verify(token);
          // userId は同期的に確定させる（await を挟むと connections 未登録のまま
          // space:join が到達しうるため。tokenVersion 検証は登録後に非同期で行う）。
          userId = payload.sub;
          revocationCheck = { sub: payload.sub, tv: payload.tv ?? 0 };
        } catch {
          // Anonymous connection allowed for public docs
        }
      }

      // ⚠️ X-Forwarded-For は**プロキシ配下でのみ**信じる。
      // 直接公開しているサーバーで無条件に信じると、クライアントが任意の値を
      // 送れるため、**偽装した IP が監査ログに残る**（HTTP 側の trust proxy と
      // 同じ考え方・main.ts 参照）。
      const forwarded = process.env.TRUST_PROXY
        ? (client.handshake.headers['x-forwarded-for'] as string)
            ?.split(',')[0]
            ?.trim()
        : undefined;
      const ip = forwarded || client.handshake.address;
      const userAgent = client.handshake.headers['user-agent'];
      this.connections.set(client.id, {
        userId,
        spaces: new Set(),
        awarenessDocs: new Set(),
        checkedDocs: new Set(),
        connectedAt: Date.now(),
        ip,
        userAgent,
      });
      this.logger.log(
        `Client connected: ${client.id} (user: ${userId || 'anonymous'})`,
      );
      this.logFile.write(
        'access',
        `${new Date().toISOString()} WS-CONNECT ${client.id} ip=${ip ?? '-'} user=${
          userId ?? '-'
        } ua="${(userAgent ?? '').slice(0, 255)}"`,
      );

      // L-1: 接続登録後に tokenVersion を検証。検証が完了する（または失効が
      // 確定する）まで、ソケット個別ミドルウェアで受信パケットの処理をブロックし、
      // 失効済みトークンが接続直後の隙に read/write するレースを防ぐ。
      if (revocationCheck) {
        const check = revocationCheck;
        const verificationPromise = this.prisma.user
          .findUnique({
            where: { id: check.sub },
            // #90: 監査ログ用に当時のメールアドレス・氏名も取る（追加クエリを避ける）
            select: { tokenVersion: true, email: true, name: true },
          })
          .then((user) => {
            const isValid = !!user && user.tokenVersion === check.tv;
            if (isValid) {
              const conn = this.connections.get(client.id);
              if (conn) {
                conn.userEmail = user.email;
                conn.userName = user.name ?? undefined;
              }
            }
            if (!isValid) {
              this.logger.warn(`Disconnecting ${client.id}: token revoked`);
              client.disconnect(true);
            }
            return isValid;
          })
          .catch(() => false);

        client.use(async (_packet, next) => {
          const isValid = await verificationPromise;
          if (!isValid) {
            next(new Error('Token has been revoked'));
            return;
          }
          next();
        });
      }
    } catch (e) {
      this.logger.error(`Connection error: ${e}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const conn = this.connections.get(client.id);
    if (conn) {
      // Clean up awareness rooms
      for (const key of conn.awarenessDocs) {
        const room = key + ':awareness';
        this.awarenessService.leaveBySocketId(client.id);
      }
    }
    this.connections.delete(client.id);
    this.logger.log(`Client disconnected: ${client.id}`);
    if (conn) {
      const seconds = Math.round((Date.now() - conn.connectedAt) / 1000);
      this.logFile.write(
        'access',
        `${new Date().toISOString()} WS-DISCONNECT ${client.id} ${seconds}s ip=${
          conn.ip ?? '-'
        } user=${conn.userId ?? '-'} email=${conn.userEmail ?? '-'}`,
      );
    }
  }

  // ─── space:join ──────────────────────────────────────────────
  @SubscribeMessage('space:join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { spaceType: string; spaceId: string; clientVersion?: string },
  ): Promise<WsResponse<{ clientId: string }>> {
    const conn = this.connections.get(client.id);
    if (!conn) return err('INTERNAL', 'Connection not found');

    const { spaceType, spaceId } = data;
    const key = `${spaceType}:${spaceId}`;

    // Verify workspace exists (guard against stale IndexedDB data)
    if (spaceType === 'workspace') {
      const ws = await this.prisma.workspace.findUnique({
        where: { id: spaceId },
        select: { id: true },
      });
      if (!ws) {
        this.logger.warn(
          `space:join rejected — workspace ${spaceId} not found (stale client data)`,
        );
        return err('WORKSPACE_NOT_FOUND', `Workspace ${spaceId} not found`);
      }
    }

    // H-1: メンバーシップ検証（読み取りアクセス）
    if (!(await this.hasSpaceAccess(spaceType, spaceId, conn.userId, false))) {
      this.logger.warn(
        `space:join rejected — user ${conn.userId ?? 'anonymous'} lacks access to ${key}`,
      );
      return err('ACCESS_DENIED', 'Access denied to this space');
    }

    // Join rooms
    client.join(syncRoom(spaceType, spaceId));
    client.join(syncRoom026(spaceType, spaceId));
    conn.spaces.add(key);

    this.logger.log(`Client ${client.id} joined ${key}`);
    return ok({ clientId: client.id });
  }

  // ─── space:leave ─────────────────────────────────────────────
  @SubscribeMessage('space:leave')
  async handleLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { spaceType: string; spaceId: string },
  ) {
    const conn = this.connections.get(client.id);
    if (!conn) return;

    const { spaceType, spaceId } = data;
    const key = `${spaceType}:${spaceId}`;

    client.leave(syncRoom(spaceType, spaceId));
    client.leave(syncRoom026(spaceType, spaceId));
    conn.spaces.delete(key);
  }

  // ─── space:load-doc ──────────────────────────────────────────
  @SubscribeMessage('space:load-doc')
  async handleLoadDoc(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      spaceType: string;
      spaceId: string;
      docId: string;
      stateVector?: string;
    },
  ): Promise<
    WsResponse<{ missing: string; state: string; timestamp: number }>
  > {
    this.logger.debug(
      `space:load-doc from ${client.id}: spaceType=${data.spaceType} spaceId=${data.spaceId} docId=${data.docId} hasStateVector=${!!data.stateVector}`,
    );

    // H-1: メンバーシップ検証（読み取りアクセス）
    const conn = this.connections.get(client.id);
    if (
      !(await this.hasSpaceAccess(
        data.spaceType,
        data.spaceId,
        conn?.userId,
        false,
      ))
    ) {
      return err('ACCESS_DENIED', 'Access denied to this space');
    }

    // #97: ドキュメント単位の判定。判定は PermissionService に委ねる
    if (
      !(await this.canDoc(
        data.spaceType,
        data.spaceId,
        data.docId,
        conn?.userId,
        'Doc_Read',
      ))
    ) {
      return err('ACCESS_DENIED', 'Access denied to this doc');
    }

    try {
      let stateVector: Uint8Array | undefined;
      if (data.stateVector) {
        stateVector = Buffer.from(data.stateVector, 'base64');
      }

      const result = await this.syncService.loadDoc(
        data.spaceId,
        data.docId,
        stateVector,
      );

      this.logger.debug(
        `space:load-doc response for ${data.docId}: missing=${result.missing.length}bytes state=${result.state.length}bytes`,
      );

      return ok({
        missing: Buffer.from(result.missing).toString('base64'),
        state: Buffer.from(result.state).toString('base64'),
        timestamp: result.timestamp,
      });
    } catch (e: any) {
      this.logger.error(`space:load-doc error for ${data.docId}: ${e.message}`);
      return err('DOC_NOT_FOUND', e.message || 'Document not found');
    }
  }

  // ─── space:push-doc-update ───────────────────────────────────
  @SubscribeMessage('space:push-doc-update')
  async handlePushDocUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      spaceType: string;
      spaceId: string;
      docId: string;
      update: string;
    },
  ): Promise<WsResponse<{ timestamp: number }>> {
    // Reject pushes during restore to prevent stale cache from overwriting restored data
    if (this._restoreMode) {
      return err('RESTORE_IN_PROGRESS', 'System is being restored');
    }

    const conn = this.connections.get(client.id);
    if (!conn)
      return err('INTERNAL', 'Connection not found');

    // H-1: メンバーシップ検証（書き込みアクセス）
    if (
      !(await this.hasSpaceAccess(
        data.spaceType,
        data.spaceId,
        conn.userId,
        true,
      ))
    ) {
      this.logger.warn(
        `space:push-doc-update rejected — user ${conn.userId ?? 'anonymous'} lacks write access to ${data.spaceType}:${data.spaceId}`,
      );
      return err('ACCESS_DENIED', 'Access denied to this space');
    }

    // #97: ドキュメント単位の判定
    if (
      !(await this.canDoc(
        data.spaceType,
        data.spaceId,
        data.docId,
        conn.userId,
        'Doc_Update',
      ))
    ) {
      this.logger.warn(
        `space:push-doc-update rejected — user ${conn.userId ?? 'anonymous'} lacks Doc_Update on ${data.docId}`,
      );
      return err('ACCESS_DENIED', 'Access denied to this doc');
    }

    this.logger.debug(
      `space:push-doc-update from ${client.id}: docId=${data.docId} updateSize=${data.update.length}chars`,
    );

    // #90: 監査ログの記録が、利用者の編集を巻き込んで失敗してはいけない。
    // ⚠️ ここで例外を投げると handler が抜けて ack が返らず、**その更新が保存されない**。
    // 監査ログのために利用者のデータを失うのは本末転倒（fail-open の方針）。
    await this.recordEditAudit(conn, data.spaceType, data.spaceId, data.docId);

    try {
      const update = Buffer.from(data.update, 'base64');
      const { spaceType, spaceId, docId } = data;

      const timestamp = await this.syncService.pushUpdate(
        spaceId,
        docId,
        update,
        conn.userId,
      );

      // Broadcast to sync-026 room (batched format)
      client
        .to(syncRoom026(spaceType, spaceId))
        .emit('space:broadcast-doc-updates', {
          spaceType,
          spaceId,
          docId,
          updates: [data.update],
          timestamp,
          editor: conn.userId,
        });

      // Broadcast to legacy sync room (single update format)
      client
        .to(syncRoom(spaceType, spaceId))
        .emit('space:broadcast-doc-update', {
          spaceType,
          spaceId,
          docId,
          update: data.update,
          timestamp,
          editor: conn.userId,
        });

      // Schedule search index update (debounced)
      this.indexerService.scheduleIndex(spaceId, docId);

      return ok({ timestamp });
    } catch (e: any) {
      return err('PUSH_FAILED', e.message || 'Failed to push update');
    }
  }

  // ─── space:load-doc-timestamps ───────────────────────────────
  @SubscribeMessage('space:load-doc-timestamps')
  async handleLoadDocTimestamps(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { spaceType: string; spaceId: string; timestamp?: number },
  ): Promise<WsResponse<Record<string, number>>> {
    this.logger.debug(
      `space:load-doc-timestamps from ${client.id}: spaceId=${data.spaceId} after=${data.timestamp ?? 'none'}`,
    );

    // H-1: メンバーシップ検証（読み取りアクセス）
    const conn = this.connections.get(client.id);
    if (
      !(await this.hasSpaceAccess(
        data.spaceType,
        data.spaceId,
        conn?.userId,
        false,
      ))
    ) {
      return err('ACCESS_DENIED', 'Access denied to this space');
    }

    // ⚠️ #97: **doc 単位の判定には身元が要る。**
    // 公開ワークスペースは未認証でも `hasSpaceAccess` を通るため、
    // ここまで来てしまう。そのまま絞ると**成功したのに0件**という
    // 紛らわしい応答になるので、明示的に拒否する。
    // 未認証の閲覧は `External`（公開共有トークン）の経路であり、
    // まだ実装していない（docs/doc-permission.md 5章）。
    if (data.spaceType === 'workspace' && !conn?.userId) {
      return err('ACCESS_DENIED', 'Sign-in required to list documents');
    }

    try {
      const timestamps = await this.syncService.getDocTimestamps(
        data.spaceId,
        data.timestamp,
      );

      // #97: ⚠️ これはドキュメント一覧そのもの。読めない doc を落とす。
      // 本文を返していなくても、**doc の存在と更新時刻**が漏れる。
      const readable = await this.filterReadableDocs(
        data.spaceType,
        data.spaceId,
        Object.keys(timestamps),
        conn?.userId,
      );
      for (const docId of Object.keys(timestamps)) {
        if (!readable.has(docId)) delete timestamps[docId];
      }
      this.logger.debug(
        `space:load-doc-timestamps response: ${Object.keys(timestamps).length} docs`,
      );
      return ok(timestamps);
    } catch (e: any) {
      this.logger.error(`space:load-doc-timestamps error: ${e.message}`);
      return err('LOAD_TIMESTAMPS_FAILED', e.message);
    }
  }

  // ─── space:delete-doc ────────────────────────────────────────
  @SubscribeMessage('space:delete-doc')
  async handleDeleteDoc(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { spaceType: string; spaceId: string; docId: string },
  ) {
    const conn = this.connections.get(client.id);
    if (!conn) return;

    // H-1: メンバーシップ検証（書き込みアクセス）
    if (
      !(await this.hasSpaceAccess(
        data.spaceType,
        data.spaceId,
        conn.userId,
        true,
      ))
    ) {
      this.logger.warn(
        `space:delete-doc rejected — user ${conn.userId ?? 'anonymous'} lacks write access to ${data.spaceType}:${data.spaceId}`,
      );
      return err('ACCESS_DENIED', 'Access denied to this space');
    }

    // #97: ドキュメント単位の判定
    if (
      !(await this.canDoc(
        data.spaceType,
        data.spaceId,
        data.docId,
        conn.userId,
        'Doc_Trash',
      ))
    ) {
      this.logger.warn(
        `space:delete-doc rejected — user ${conn.userId ?? 'anonymous'} lacks Doc_Trash on ${data.docId}`,
      );
      return err('ACCESS_DENIED', 'Access denied to this doc');
    }

    // #90: タイトルは**消す前にしか取れない**。docId だけ残しても
    // 「何を消したのか」が後から分からない。
    const meta =
      conn.userId && data.spaceType === 'workspace'
        ? await this.prisma.docMeta
            .findFirst({
              where: { workspaceId: data.spaceId, docId: data.docId },
              select: { title: true },
            })
            .catch(() => null)
        : null;

    await this.syncService.deleteDoc(data.spaceId, data.docId);

    // #90: 消えた事実は最も追跡価値が高い。削除は明確なイベントなので1件ずつ残す
    if (
      conn.userId &&
      data.spaceType === 'workspace' &&
      !isInternalDoc(data.spaceId, data.docId)
    ) {
      await this.recordDocAudit(
        conn,
        'doc.delete',
        data.spaceId,
        data.docId,
        meta?.title ?? undefined,
      );
    }
  }

  /**
   * #90: 編集の監査ログ（新規作成の判定＋集約）。
   *
   * **例外を外へ出さない。** この処理の失敗で利用者の更新が失われないようにする。
   */
  private async recordEditAudit(
    conn: ConnectionState,
    spaceType: string,
    spaceId: string,
    docId: string,
  ): Promise<void> {
    if (!conn.userId || spaceType !== 'workspace') return;
    // 内部ドキュメント（ワークスペースのルート、db$/userdata$ 等）は
    // 利用者の操作ではない。記録すると1ページ編集で複数行が立ち、
    // しかも名前が無い UUID だけの行になって一覧が読めなくなる
    if (isInternalDoc(spaceId, docId)) return;

    try {
      // ドキュメントはブラウザ側（Yjs）で作られ、サーバーには「作成した」という
      // 通知が来ない。**最初の更新が届いた時点で保存済みデータが無ければ新規作成**
      // とみなす。判定は**接続ごと・ドキュメントごとに1回だけ**行う
      // （打鍵のたびに問い合わせると、集約で減らした負荷を打ち消してしまう）。
      //
      // ⚠️ キーに spaceId を含める。docId だけだと、同じ接続で別ワークスペースの
      // 同じ docId に触れたとき、2つ目の doc.create が落ちる
      const key = `${spaceId}:${docId}`;
      if (!conn.checkedDocs.has(key)) {
        conn.checkedDocs.add(key);
        if (await this.syncService.isNewDoc(spaceId, docId)) {
          await this.recordDocAudit(conn, 'doc.create', spaceId, docId);
        }
      }

      // 接続直後の検証が終わる前に編集が届くと email が未設定になりうる。
      // 「誰が編集したか分からない記録」を残さないよう、その場合だけ引き直す
      if (!conn.userEmail) {
        const user = await this.prisma.user.findUnique({
          where: { id: conn.userId },
          select: { email: true, name: true },
        });
        if (user) {
          conn.userEmail = user.email;
          conn.userName = user.name ?? undefined;
        }
      }

      this.editAggregator.track({
        actorId: conn.userId,
        actorEmail: conn.userEmail ?? 'unknown',
        actorName: conn.userName ?? undefined,
        workspaceId: spaceId,
        docId,
      });
    } catch (e) {
      this.logger.error(
        `監査ログの記録に失敗しました (doc=${docId}): ${(e as Error).message}`,
      );
    }
  }

  /** #90: ドキュメント操作の監査ログ。当時の利用者を残すため email を補う。 */
  private async recordDocAudit(
    conn: ConnectionState,
    action: string,
    workspaceId: string,
    docId: string,
    targetName?: string,
  ): Promise<void> {
    if (!conn.userEmail && conn.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: conn.userId },
        select: { email: true, name: true },
      });
      if (user) {
        conn.userEmail = user.email;
        conn.userName = user.name ?? undefined;
      }
    }
    await this.audit.record({
      action,
      actor: {
        id: conn.userId,
        email: conn.userEmail,
        name: conn.userName,
      },
      targetType: 'doc',
      targetId: docId,
      targetName,
      workspaceId,
      ip: conn.ip,
    });
  }

  // ─── space:join-awareness ────────────────────────────────────
  @SubscribeMessage('space:join-awareness')
  async handleJoinAwareness(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      spaceType: string;
      spaceId: string;
      docId: string;
      clientVersion?: string;
    },
  ): Promise<WsResponse<{ clientId: string }>> {
    const conn = this.connections.get(client.id);
    if (!conn) return err('INTERNAL', 'Connection not found');

    const { spaceType, spaceId, docId } = data;

    // H-1: メンバーシップ検証（読み取りアクセス）
    if (!(await this.hasSpaceAccess(spaceType, spaceId, conn.userId, false))) {
      return err('ACCESS_DENIED', 'Access denied to this space');
    }

    // #97: ⚠️ awareness は本文を流さないが、**誰がその doc を開いているか**が漏れる。
    // 「役員が3人で何かを編集している」は、本文が読めなくても情報である
    if (
      !(await this.canDoc(spaceType, spaceId, docId, conn.userId, 'Doc_Read'))
    ) {
      return err('ACCESS_DENIED', 'Access denied to this doc');
    }

    const room = awarenessRoom(spaceType, spaceId, docId);
    const key = `${spaceType}:${spaceId}:${docId}`;

    client.join(room);
    conn.awarenessDocs.add(key);
    this.awarenessService.join(room, client.id, conn.userId);

    return ok({ clientId: client.id });
  }

  // ─── space:leave-awareness ───────────────────────────────────
  @SubscribeMessage('space:leave-awareness')
  async handleLeaveAwareness(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { spaceType: string; spaceId: string; docId: string },
  ) {
    const conn = this.connections.get(client.id);
    if (!conn) return;

    const { spaceType, spaceId, docId } = data;
    const room = awarenessRoom(spaceType, spaceId, docId);
    const key = `${spaceType}:${spaceId}:${docId}`;

    client.leave(room);
    conn.awarenessDocs.delete(key);
    this.awarenessService.leave(room, client.id);
  }

  // ─── space:update-awareness ──────────────────────────────────
  @SubscribeMessage('space:update-awareness')
  async handleUpdateAwareness(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      spaceType: string;
      spaceId: string;
      docId: string;
      awarenessUpdate: string;
    },
  ) {
    const conn = this.connections.get(client.id);
    if (!conn) return;

    const { spaceType, spaceId, docId, awarenessUpdate } = data;

    // #97: カーソル位置・選択範囲を配信する。読めない doc へ流さない
    if (
      !(await this.canDoc(spaceType, spaceId, docId, conn.userId, 'Doc_Read'))
    ) {
      return;
    }

    const room = awarenessRoom(spaceType, spaceId, docId);

    // Broadcast to all other clients in the awareness room
    client.to(room).emit('space:broadcast-awareness-update', {
      spaceType,
      spaceId,
      docId,
      awarenessUpdate,
    });
  }

  // ─── space:load-awarenesses ──────────────────────────────────
  @SubscribeMessage('space:load-awarenesses')
  async handleLoadAwarenesses(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { spaceType: string; spaceId: string; docId: string },
  ) {
    const conn = this.connections.get(client.id);
    if (!conn) return;

    const { spaceType, spaceId, docId } = data;

    // #97: 他の参加者に awareness の再送を促す＝**参加者一覧の取得**にあたる
    if (
      !(await this.canDoc(spaceType, spaceId, docId, conn.userId, 'Doc_Read'))
    ) {
      return;
    }

    const room = awarenessRoom(spaceType, spaceId, docId);

    // Ask all other clients in the room to re-broadcast their awareness
    client.to(room).emit('space:collect-awareness', {
      spaceType,
      spaceId,
      docId,
    });
  }

  /**
   * H-1 対策: WebSocket 経由のワークスペース越境を防ぐ。
   * spaceType/spaceId に対して呼び出しユーザーのアクセス可否を判定する。
   * - userspace(個人スペース): 本人のみ。
   * - workspace: accepted メンバーのみ。書き込みは reader 以外。
   *   サーバ全体 Admin は常に許可。未認証/非メンバーは公開WSの読み取りのみ。
   */
  private async hasSpaceAccess(
    spaceType: string,
    spaceId: string,
    userId: string | undefined,
    write: boolean,
  ): Promise<boolean> {
    if (spaceType !== 'workspace') {
      // 個人スペースは spaceId === userId のときのみ許可（DBアクセス不要）
      return !!userId && spaceId === userId;
    }

    const now = Date.now();
    const cacheKey = `${userId ?? 'anonymous'}:${spaceId}:${write ? 'w' : 'r'}`;
    const cached = this.accessCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.authorized;
    }

    const authorized = await this.checkWorkspaceAccess(spaceId, userId, write);

    // 肥大化時は期限切れを掃除し、それでも上限超過なら全クリア（メモリリーク防止）
    if (this.accessCache.size >= SyncGateway.ACCESS_CACHE_MAX) {
      for (const [k, v] of this.accessCache) {
        if (v.expiresAt <= now) this.accessCache.delete(k);
      }
      if (this.accessCache.size >= SyncGateway.ACCESS_CACHE_MAX) {
        this.accessCache.clear();
      }
    }
    this.accessCache.set(cacheKey, {
      authorized,
      expiresAt: now + SyncGateway.ACCESS_CACHE_TTL_MS,
    });

    return authorized;
  }

  /**
   * #97: 権限が変わったら、その doc の判定キャッシュを捨てる
   * （docs/doc-permission.md 7章）。
   *
   * ⚠️ **寿命切れを待ってはいけない。** 待つと「権限を外したのに、
   * 相手の開いているタブでは編集が続けられる」時間が生まれる。
   *
   * @param userId 省略時はその doc の全員分（既定ロールの変更）
   */
  private invalidateDocAccess(
    workspaceId: string,
    docId: string,
    userId?: string,
  ): void {
    // キーは `${userId}:${spaceId}:${docId}:${action}`
    const suffix = `:${workspaceId}:${docId}:`;
    for (const key of this.docAccessCache.keys()) {
      const matchesDoc = key.includes(suffix);
      if (!matchesDoc) continue;
      if (userId && !key.startsWith(`${userId}:`)) continue;
      this.docAccessCache.delete(key);
    }
  }

  /**
   * #97: ドキュメント単位の可否（docs/doc-permission.md）。
   *
   * ⚠️ **ここに判定ロジックを書かないこと。** PermissionService に委ねる。
   * このメソッドがやるのはキャッシュだけ。
   */
  private async canDoc(
    spaceType: string,
    spaceId: string,
    docId: string,
    userId: string | undefined,
    action: DocAction,
  ): Promise<boolean> {
    // 個人スペースは doc 単位の権限を持たない（本人のものしかない）
    if (spaceType !== 'workspace') return true;
    if (!userId) return false;

    const now = Date.now();
    const key = `${userId}:${spaceId}:${docId}:${action}`;
    const cached = this.docAccessCache.get(key);
    if (cached && cached.expiresAt > now) return cached.allowed;

    const allowed = await this.permission.can(spaceId, docId, userId, action);

    if (this.docAccessCache.size >= SyncGateway.ACCESS_CACHE_MAX) {
      for (const [k, v] of this.docAccessCache) {
        if (v.expiresAt <= now) this.docAccessCache.delete(k);
      }
      if (this.docAccessCache.size >= SyncGateway.ACCESS_CACHE_MAX) {
        this.docAccessCache.clear();
      }
    }
    this.docAccessCache.set(key, {
      allowed,
      expiresAt: now + SyncGateway.ACCESS_CACHE_TTL_MS,
    });
    return allowed;
  }

  /**
   * #97: 一覧から読めない doc を落とす。
   *
   * ⚠️ **1件ずつ canDoc を呼ばない。** doc が数千あると同じ回数だけ問い合わせる。
   * PermissionService.filterReadable がまとめて引く。
   */
  private async filterReadableDocs(
    spaceType: string,
    spaceId: string,
    docIds: string[],
    userId: string | undefined,
  ): Promise<Set<string>> {
    // 個人スペースは doc 単位の権限を持たない
    if (spaceType !== 'workspace') return new Set(docIds);
    if (!userId) return new Set();

    return new Set(
      await this.permission.filterReadable(spaceId, docIds, userId),
    );
  }

  /** ワークスペースへのアクセス可否を DB から判定する（キャッシュ無し実体）。 */
  private async checkWorkspaceAccess(
    spaceId: string,
    userId: string | undefined,
    write: boolean,
  ): Promise<boolean> {
    if (userId) {
      const dbUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { isAdmin: true },
      });
      if (dbUser?.isAdmin) return true;

      const member = await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: spaceId, userId } },
        select: { role: true, status: true },
      });
      if (member && member.status === 'accepted') {
        if (!write) return true;
        // 書き込みは reader 以外（member/admin/owner）
        return member.role !== 'reader';
      }
    }

    // 未認証 or 非メンバー: 公開ワークスペースの読み取りのみ許可
    if (!write) {
      const ws = await this.prisma.workspace.findUnique({
        where: { id: spaceId },
        select: { public: true },
      });
      return !!ws?.public;
    }
    return false;
  }

  private parseCookie(
    cookieHeader: string | undefined,
    name: string,
  ): string | null {
    if (!cookieHeader) return null;
    const match = cookieHeader.match(new RegExp(`${name}=([^;]+)`));
    return match?.[1] ?? null;
  }
}

import { io, type Socket } from 'socket.io-client';

import { CliError } from '../errors';

/** ブラウザと同じ同期プロトコル（socket.io）。サーバー側は sync.gateway.ts */
const SPACE_TYPE = 'workspace';
const ACK_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 15_000;
const ACCESS_DENIED = 'ACCESS_DENIED';
/** 応答の前に接続が切れた。サーバーの再起動・通信断・トークン失効のどれか */
const DISCONNECTED = 'DISCONNECTED';

type WsResponse<T> = { data: T } | { error: { name: string; message: string } };

export enum JoinResult {
  Joined,
  Denied,
}

/**
 * サーバーとの同期接続。1本の接続で複数のワークスペースに参加できる。
 *
 * ```
 * connect → join(ws) → load-doc / push-doc-update … → close
 * ```
 */
export class SyncClient {
  private socket: Socket | null = null;

  constructor(private readonly serverUrl: string) {}

  async connect(token: string): Promise<void> {
    this.close();
    const socket = io(this.serverUrl, {
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
      timeout: CONNECT_TIMEOUT_MS,
    });
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', () =>
        reject(
          new CliError(
            `同期サーバーに接続できない: ${this.serverUrl}`,
            'ワークスペース URL とネットワークを確かめる'
          )
        )
      );
    });
  }

  /** 拒否は「トークン失効」か「別アカウント・別 URL」。呼び出し側が判断する */
  async join(workspaceId: string): Promise<JoinResult> {
    const res = await this.emit<{ clientId: string }>('space:join', {
      spaceType: SPACE_TYPE,
      spaceId: workspaceId,
    });
    if ('error' in res) {
      // 失効したトークンはサーバーが接続ごと切る。取り直して再試行させる
      if (res.error.name === ACCESS_DENIED || res.error.name === DISCONNECTED) {
        return JoinResult.Denied;
      }
      throw new CliError(`ワークスペースに参加できない: ${res.error.message}`);
    }
    return JoinResult.Joined;
  }

  /**
   * 全状態を取る（state vector なし）。
   *
   * 不在のページは空の更新が返る。権限が無いときは null。
   */
  async loadDoc(
    workspaceId: string,
    docId: string
  ): Promise<Uint8Array | null> {
    const res = await this.emit<{ missing: string }>('space:load-doc', {
      spaceType: SPACE_TYPE,
      spaceId: workspaceId,
      docId,
    });
    if ('error' in res) {
      if (res.error.name === ACCESS_DENIED) {
        return null;
      }
      throw failure('ページを読めない', res.error);
    }
    return Buffer.from(res.data.missing, 'base64');
  }

  /** `subject` は権限が無いときの文言に使う。例: `フォルダ` */
  async pushUpdate(
    workspaceId: string,
    docId: string,
    update: Uint8Array,
    subject = `このページ（${docId}）`
  ): Promise<void> {
    const res = await this.emit<{ timestamp: number }>(
      'space:push-doc-update',
      {
        spaceType: SPACE_TYPE,
        spaceId: workspaceId,
        docId,
        update: Buffer.from(update).toString('base64'),
      }
    );
    if (!('error' in res)) {
      return;
    }
    if (res.error.name === ACCESS_DENIED) {
      throw new CliError(
        `${subject}を編集する権限が無い`,
        '権限を持つ人に編集権限を付けてもらう'
      );
    }
    throw failure('書き込みに失敗した', res.error);
  }

  close(): void {
    this.socket?.disconnect();
    this.socket = null;
  }

  private async emit<T>(
    event: string,
    payload: object
  ): Promise<WsResponse<T>> {
    if (!this.socket) {
      throw new CliError('同期サーバーに未接続');
    }
    try {
      return (await this.socket
        .timeout(ACK_TIMEOUT_MS)
        .emitWithAck(event, payload)) as WsResponse<T>;
    } catch {
      // ⚠️ 権限不足と混ぜない。AI が権限の問題と誤認するため
      if (!this.socket?.connected) {
        return { error: { name: DISCONNECTED, message: 'disconnected' } };
      }
      throw new CliError(
        `同期サーバーが応答しない（${event}）`,
        'しばらく待って再実行する'
      );
    }
  }
}

function failure(
  what: string,
  error: { name: string; message: string }
): CliError {
  if (error.name === DISCONNECTED) {
    return new CliError(
      `${what}: 同期サーバーとの接続が切れた`,
      'サーバーが動いているか確かめて再実行する（権限の問題ではない）'
    );
  }
  return new CliError(`${what}: ${error.message}`);
}

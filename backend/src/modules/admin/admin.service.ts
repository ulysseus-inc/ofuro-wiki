import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma.service';
import { getAdminEmail, isAdminEmail } from '../../common/admin-email';
import { WorkspaceKind } from '../../common/workspace-kind';
import { BCRYPT_ROUNDS } from '../../common/security.constants';
import { deriveUserName } from '../../common/user-name.util';
import { validatePasswordStrength } from '../../common/password.util';
import { AuditService } from '../audit/audit.service';
import { DiscoveryRevisionService } from '../discovery/discovery-revision.service';
import { IndexReaderService } from '../discovery/index-reader.service';
import { ParsedCsvRow } from './user-csv.util';
import { CsvUserRowResult } from './admin.model';
import { normalizeEmail } from '../../common/email.util';
import {
  DOC_VIEW_SETTING_KEY,
  DocViewRecorder,
} from '../audit/doc-view-recorder';

// メールアドレスの簡易検証。RFC 準拠の完全な判定は行わない
// （厳密にやるほど正当なアドレスを弾く危険が増すため、明らかな誤りだけを弾く）。
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


/**
 * 管理画面の汎用の書き換えで触れる設定。足すときは、画面（サーバー設定・バックアップ）と揃える。
 * SSO（oidc_*）は updateOidcConfig だけで変える（#330: 発行者を変えたらシークレットを消すため）
 */
const GENERAL_SETTING_KEYS: ReadonlySet<string> = new Set([
  'registration_open',
  'link_preview_enabled',
  'backup_enabled',
  'backup_retention_days',
  'backup_schedule',
  DOC_VIEW_SETTING_KEY,
]);

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private discovery: DiscoveryRevisionService,
    // #297: ユーザー削除の確認に出す、プライベートの名前（privateWorkspaceName）
    private indexReader: IndexReaderService,
    // #100: 閲覧の記録の設定を変えたら、すぐ効かせる
    private docViews: DocViewRecorder,
  ) {}

  async listUsers(search?: string, skip = 0, take = 20) {
    // #72: システム内部アカウント（マニュアルWS所有等）は外部に出さない。
    const where: any = { isSystem: false };
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' as const } },
        { name: { contains: search, mode: 'insensitive' as const } },
      ];
    }

    const [items, totalCount] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          isAdmin: true,
          emailVerified: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    // #297: root はほかのシステム管理者と区別して出す（docs/workspace-model.md 12.8.3）
    return {
      items: items.map((u) => ({ ...u, isRoot: isAdminEmail(u.email) })),
      totalCount,
    };
  }

  /**
   * #297: ユーザーを消すと一緒に消えるプライベートの名前（docs/workspace-model.md 5 章）。
   * 名前はワークスペースの中（Yjs）から取り、無ければサーバーの名前。プライベートが無ければ null
   */
  async privateWorkspaceName(userId: string): Promise<string | null> {
    const workspace = await this.prisma.workspace.findFirst({
      where: { ownerId: userId, kind: WorkspaceKind.Private },
      select: { id: true, name: true },
    });
    if (!workspace) {
      return null;
    }

    const name = await this.indexReader.readWorkspaceName(workspace.id);
    return name ?? workspace.name ?? '';
  }

  /**
   * #297: 管理画面「ワークスペース」の一覧（docs/workspace-model.md 12.8.1）。
   * 共有だけ。マニュアルは消せない・システムが持つため載せない。
   * 名前は返さない。`workspaces.name` は作った時の既定値のままで、本当の名前はワークスペースの中（Yjs）にある
   */
  async listSharedWorkspaces() {
    const rows = await this.prisma.workspace.findMany({
      where: { kind: WorkspaceKind.Shared },
      select: {
        id: true,
        createdAt: true,
        _count: { select: { members: { where: { status: 'accepted' } } } },
      },
    });
    const workspaces = rows;
    const ids = workspaces.map((w) => w.id);

    // 最終更新 = ページの中身が最後に保存された時刻。
    // workspaces.updated_at は名前を変えたときしか動かないため使わない
    const where = { workspaceId: { in: ids } };
    const [snapshots, updates] = await Promise.all([
      this.prisma.docSnapshot.groupBy({ by: ['workspaceId'], where, _max: { timestamp: true } }),
      this.prisma.docUpdate.groupBy({ by: ['workspaceId'], where, _max: { timestamp: true } }),
    ]);
    const lastSaved = new Map<string, Date>();
    for (const row of [...snapshots, ...updates]) {
      const time = row._max?.timestamp;
      if (!time) {
        continue;
      }
      const known = lastSaved.get(row.workspaceId);
      if (!known || known < time) {
        lastSaved.set(row.workspaceId, time);
      }
    }

    return workspaces
      .map((w) => ({
        id: w.id,
        memberCount: w._count.members,
        updatedAt: lastSaved.get(w.id) ?? w.createdAt,
      }))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async createUser(email: string, password: string, name?: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    validatePasswordStrength(password);

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    return this.prisma.user.create({
      data: {
        // #120: 保存値を揃える（照合は citext が担う）
        email: normalizeEmail(email),
        passwordHash,
        name: deriveUserName(email, name),
        emailVerified: true,
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        isAdmin: true,
        emailVerified: true,
        createdAt: true,
      },
    });
  }

  /**
   * #115: 管理者が対象ユーザーのパスワードを直接再設定する（機能 3）。
   *
   * パスワードを忘れた利用者の復旧経路。現在のパスワードは要求しない
   * （忘れているから使えない）ため、Admin 権限そのものが唯一の防壁になる。
   * この操作の後、Admin は対象利用者のパスワードを知った状態になる。
   * 本人に URL を渡せる場合は 4（変更 URL 発行）を使うこと。
   * 設定後は対象ユーザーの全セッションを失効させる（tokenVersion +1）。
   * 乗っ取り時に「気づかれずに居座る」ことを防ぐため、既存セッションは残さない。
   */
  async setUserPassword(
    userId: string,
    password: string,
    actor: { id: string; email: string },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    assertRootTouchedOnlyByRoot(user, actor.id);

    validatePasswordStrength(password);

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });

    // #90: 対象のメールアドレスを残したいので、ここで明示的に記録する
    // （Interceptor では対象が UUID でしか分からない）
    await this.audit.record({
      action: 'user.password.reset',
      actor: { email: actor.email },
      targetType: 'user',
      targetId: userId,
      targetName: user.email,
    });
    return true;
  }

  /**
   * #92: CSV の各行を検証する。**登録は行わない。**
   *
   * 画面はこの結果を一覧表示し、Admin が確認してから登録する。
   * 登録後に失敗行を報告する方式だと後始末が発生するため、押す前に分かるようにする。
   */
  async validateUserCsv(rows: ParsedCsvRow[]): Promise<CsvUserRowResult[]> {
    // 既存ユーザーとの重複は1件ずつ問い合わせると行数分のクエリになるため、
    // 対象メールアドレスをまとめて引く。
    const emails = rows.map((r) => r.email.toLowerCase()).filter(Boolean);
    const existing = await this.prisma.user.findMany({
      where: { email: { in: emails, mode: 'insensitive' } },
      select: { email: true },
    });
    const taken = new Set(existing.map((u) => u.email.toLowerCase()));

    const seen = new Set<string>();
    return rows.map((row) => {
      const error = this.validateCsvRow(row, taken, seen);
      if (!error) seen.add(row.email.toLowerCase());
      return {
        line: row.line,
        email: row.email,
        name: row.name || undefined,
        ok: !error,
        error,
      };
    });
  }

  /** #92: 1行分の検証。理由を1つだけ返す（利用者が直す順序を迷わないため）。 */
  private validateCsvRow(
    row: ParsedCsvRow,
    taken: Set<string>,
    seen: Set<string>,
  ): string | undefined {
    if (!row.email) {
      return 'メールアドレスが空です';
    }
    if (!EMAIL_PATTERN.test(row.email)) {
      return 'メールアドレスの形式が正しくありません';
    }
    const key = row.email.toLowerCase();
    if (seen.has(key)) {
      return 'この CSV 内で重複しています';
    }
    if (taken.has(key)) {
      return 'すでに登録されているメールアドレスです';
    }
    if (!row.password) {
      return 'パスワードが空です';
    }
    // 前後の空白は、区切り文字の後ろに空けた分が紛れ込んだのか、
    // 意図した文字なのかを区別できない。黙ってどちらかに倒すと、
    // 「CSV に書いた値でサインインできない」事故になるため直してもらう。
    if (row.password !== row.password.trim()) {
      return 'パスワードの前後に空白が含まれています';
    }
    try {
      validatePasswordStrength(row.password);
    } catch (e: any) {
      return e?.message ?? 'パスワードが要件を満たしていません';
    }
    return undefined;
  }

  /**
   * #92: CSV の内容を登録する。
   *
   * ⚠️ 画面が持っている検証結果は信用せず、**登録時にも同じ検証を行う**。
   * 検証から登録までの間に、別の Admin が同じメールアドレスを登録している
   * 可能性があるため。
   *
   * 行ごとに判定し、失敗した行があっても他の行は登録する（全件ロールバックしない）。
   */
  async importUsersFromCsv(
    rows: ParsedCsvRow[],
    actorEmail: string,
  ): Promise<CsvUserRowResult[]> {
    const validated = await this.validateUserCsv(rows);
    const byLine = new Map(rows.map((r) => [r.line, r]));
    const results: CsvUserRowResult[] = [];

    for (const candidate of validated) {
      if (!candidate.ok) {
        results.push(candidate);
        continue;
      }
      const row = byLine.get(candidate.line)!;
      try {
        await this.createUser(row.email, row.password, row.name || undefined);
        results.push(candidate);
      } catch (e: any) {
        // 同時実行で一意制約に触れた場合もここへ来る。1行の失敗で全体は止めない。
        results.push({
          ...candidate,
          ok: false,
          error: e?.message ?? '登録できませんでした',
        });
      }
    }

    const created = results.filter((r) => r.ok).length;
    // #90: 件数は結果にしか無いため、ここで記録する
    await this.audit.record({
      action: 'user.import',
      actor: { email: actorEmail },
      targetType: 'user',
      detail: {
        meta: { ok: created, ng: results.length - created },
      },
    });
    return results;
  }

  /** #90: actor は監査ログに残すため必須。誰が消したか分からない記録は役に立たない。 */
  async deleteUser(userId: string, actor: { id?: string; email: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    // #297: root は消せない（docs/workspace-model.md 3.5）
    if (isAdminEmail(user.email)) {
      throw new ForbiddenException('The root user (ROOT_EMAIL) cannot be deleted');
    }

    // #90: 消したものの名前は**消す前にしか取れない**。
    // UUID だけ残しても、参照先が消えているため後から何を消したのか分からない。
    // #296/#297: 一緒に消すのはその人のプライベートだけ。共有の持ち主は root なので対象にならない
    const ownedWorkspaces = await this.prisma.workspace.findMany({
      where: { ownerId: userId },
      select: { id: true, name: true, kind: true },
    });
    if (ownedWorkspaces.some((w) => w.kind === WorkspaceKind.Shared)) {
      // 移行ツール（12.9）の前などで、共有の持ち主が root でないとき。消すと共有が消える
      throw new ForbiddenException(
        'This user owns a shared workspace. Run the workspace migration first',
      );
    }

    // Delete owned workspaces first to avoid FK constraint on ownerId
    await this.prisma.workspace.deleteMany({ where: { ownerId: userId } });
    await this.prisma.user.delete({ where: { id: userId } });

    await this.audit.record({
      action: 'user.delete',
      actor,
      targetType: 'user',
      targetId: userId,
      targetName: user.email,
      detail: {
        meta: {
          // 連鎖して消えたワークスペースも残す（利用者削除に伴い黙って消える）
          deletedWorkspaces: ownedWorkspaces.map((w) => ({
            id: w.id,
            name: w.name,
          })),
        },
      },
    });
    return true;
  }

  /** L-1: 対象ユーザーの全トークンを失効させる（tokenVersion +1）。 */
  async revokeUserSessions(userId: string, actorId: string): Promise<boolean> {
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (target) {
      assertRootTouchedOnlyByRoot(target, actorId);
    }
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
      });
      return true;
    } catch (error: any) {
      // 対象ユーザーが存在しない場合 Prisma は P2025 を投げる
      if (error?.code === 'P2025') {
        throw new NotFoundException('User not found');
      }
      throw error;
    }
  }

  async setAdmin(userId: string, isAdmin: boolean) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    // #297: root は管理者を外せない（以前は外せたが、再起動で戻る紛らわしい状態だった）
    if (!isAdmin && isAdminEmail(user.email)) {
      throw new ForbiddenException('The root user (ROOT_EMAIL) cannot be demoted');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { isAdmin },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        isAdmin: true,
        emailVerified: true,
        createdAt: true,
      },
    });
  }

  /** 管理画面に出す設定（汎用の書き換えで触れるものと同じ） */
  async getSettings() {
    return this.prisma.serverSetting.findMany({
      where: { key: { in: [...GENERAL_SETTING_KEYS] } },
      orderBy: { key: 'asc' },
    });
  }

  /**
   * 汎用の書き換え（adminUpdateServerSetting）。触れるのは GENERAL_SETTING_KEYS だけ。
   * 何でも書けると、専用の処理（SSO の発行者を変えたらシークレットを消す等）を素通りできる
   */
  async updateSetting(key: string, value: string) {
    if (!GENERAL_SETTING_KEYS.has(key)) {
      throw new BadRequestException(`この設定はここでは変えられません: ${key}`);
    }
    const setting = await this.prisma.serverSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });

    if (key === DOC_VIEW_SETTING_KEY) {
      this.docViews.forgetSetting();
    }
    return setting;
  }

  async getSettingValue(key: string): Promise<string | null> {
    const setting = await this.prisma.serverSetting.findUnique({
      where: { key },
    });
    return setting?.value ?? null;
  }

  async seedAdmin() {
    const adminEmail = getAdminEmail();
    if (!adminEmail) {
      this.logger.log('ROOT_EMAIL not set, skipping admin seed');
      return;
    }

    // #77: 完全一致で引く（AuthService の isAdminEmail と同じ判定）。
    // 大文字小文字を無視すると、第三者が ROOT_EMAIL の大文字小文字違いで
    // サインアップしておくだけで、再起動時に管理者へ昇格させられてしまう。
    const user = await this.prisma.user.findUnique({
      where: { email: adminEmail },
    });

    if (!user) {
      // #294: root ができるまでは、このアドレスを知る誰でも root を作れる。
      // 気付けるように警告にする（docs/signin-registration.md 4.2）
      this.logger.warn(
        `ROOT_EMAIL=${adminEmail} has no account yet. Sign in as root first: until then, anyone who knows this address can create it.`,
      );
      return;
    }

    if (!user.isAdmin) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { isAdmin: true },
      });
      this.logger.log(`Admin role granted to ${adminEmail}`);
    } else {
      this.logger.log(`${adminEmail} is already admin`);
    }

    await this.reassignSharedOwner(user.id);
  }

  /**
   * #297: 共有ワークスペースの持ち主を、今の root に付け替える（docs/workspace-model.md 12.7）。
   *
   * ```
   * 持ち主が root でない共有ごとに
   *   owner_id ← root
   *   root のメンバーの行を owner にする（無ければ作る）
   *   前の持ち主の行は admin（ワークスペース管理者）に下げる … ⚠️ 消さない。消すと読めなくなる
   * ```
   */
  async reassignSharedOwner(rootId: string) {
    const candidates = await this.prisma.workspace.findMany({
      where: { kind: WorkspaceKind.Shared, ownerId: { not: rootId } },
      select: { id: true, ownerId: true, name: true },
    });
    for (const ws of candidates) {
      // ⚠️ 1 件の失敗で起動を止めない。残りは付け替え、失敗はログに残す（次の起動でやり直す）
      try {
        await this.reassignOne(ws, rootId);
      } catch (e) {
        this.logger.error(
          `共有の持ち主の付け替え、またはその記録（監査ログ・版数）に失敗しました（${ws.id}）: ${(e as Error).message}`,
        );
      }
    }
    if (candidates.length > 0) {
      this.logger.log(`Shared workspaces reassigned to root: ${candidates.length}`);
    }
  }

  private async reassignOne(
    ws: { id: string; ownerId: string; name: string | null },
    rootId: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.workspace.update({ where: { id: ws.id }, data: { ownerId: rootId } });
      await tx.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: ws.id, userId: rootId } },
        create: { workspaceId: ws.id, userId: rootId, role: 'owner', status: 'accepted' },
        update: { role: 'owner', status: 'accepted' },
      });
      await tx.workspaceMember.updateMany({
        where: { workspaceId: ws.id, userId: ws.ownerId },
        data: { role: 'admin' },
      });
    });
    // ⚠️ ここから先は、付け替えを書き込んだ**あと**。失敗すると次回の起動では候補から外れ
    // （持ち主はもう root）、記録が二度と残らない。前後の持ち主をログに残してから続ける
    this.logger.log(`共有の持ち主を root に付け替えた: ${ws.id}（${ws.ownerId} → ${rootId}）`);

    // ⚠️ #151: 誰に何が見えるかが変わる。**書き込んだあと**に上げる
    await this.discovery.bump(ws.id, 'permission-workspace');

    // ROOT_EMAIL の打ち間違いで意図しない人が持ち主になっても、後から気付けるように
    await this.audit.record({
      action: 'workspace.owner.reassign',
      actor: { email: 'system' },
      targetType: 'workspace',
      targetId: ws.id,
      targetName: ws.name ?? undefined,
      workspaceId: ws.id,
      detail: { meta: { from: ws.ownerId, to: rootId } },
    });
  }

  /**
   * #297: 移行ツール（docs/workspace-model.md 12.9）を流していないと思われるときに警告する。
   * 反映した直後は既存がすべてプライベート扱いで、招待が断られ、管理者も開けない（12.12）。
   * 「プライベートなのに、持ち主のほかにメンバーが居る」ものがあれば、まだ流していない。
   */
  async warnUnmigratedWorkspaces() {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM workspaces w
      WHERE w.kind = ${WorkspaceKind.Private}
        AND (SELECT count(*) FROM workspace_members m
             WHERE m.workspace_id = w.id AND m.status = 'accepted') > 1`;
    const count = Number(rows[0]?.count ?? 0);
    if (count > 0) {
      this.logger.warn(
        `メンバーの居るプライベートのワークスペースが ${count} 件あります。` +
          '移行ツール（migrate-workspace-kind）をまだ流していない可能性があります。' +
          'それまで、これらには招待できず、システム管理者も開けません',
      );
    }
  }
}

/**
 * #297: root のアカウント（パスワード・サインイン）を変えられるのは root 本人だけ。
 * ほかのシステム管理者が変えられると、root を乗っ取れる（docs/permission-matrix.md 1 章）。
 */
export function assertRootTouchedOnlyByRoot(
  target: { id: string; email: string },
  actorId: string,
): void {
  // 本人かどうかは ID で比べる（メールアドレスの表記の揺れに左右されない）
  if (isAdminEmail(target.email) && target.id !== actorId) {
    throw new ForbiddenException('Only the root user can change the root account');
  }
}

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from './audit.service';

/**
 * #90: GraphQL / REST の**成功した更新操作**を記録する。
 *
 * ⚠️ これだけでは足りない（docs/logging.md 2.7）。
 * - Guard の拒否は Interceptor に届かない → Guard 側で記録
 * - 認証の失敗は例外を投げる → AuthService で記録
 * - ドキュメント編集は WebSocket → Gateway で記録
 *
 * **記録するのは更新系のみ。** 参照（Query）まで記録すると閲覧ログになり、
 * 量が桁違いになる（それは #100 の範囲）。
 */

/**
 * 記録対象の mutation 名 → 監査ログの action。
 *
 * **明示的な対応表にする。** 「mutation は全部記録」にすると、
 * 記録したくないもの（下書き保存のような高頻度操作）が将来紛れ込み、
 * 気づかないうちにログが膨らむ。
 */
// ⚠️ 対象の氏名・件数など**その場でしか分からない情報**を残したい操作は、
// ここに書かず処理側で明示的に記録する（二重記録を避けるため）。
//   adminSetUserPassword / createChangePasswordUrl … 対象のメールアドレス
//   adminImportUsers … 成功・失敗の件数
//   adminDeleteUser / deleteWorkspace … **消す前にしか取れない対象の名前**
//   changePassword … @Public() で実行者が不明。対象はトークンからしか分からない
const MUTATION_ACTIONS: Record<string, string> = {
  // ユーザー管理（#92 / #115）
  adminCreateUser: 'user.create',
  adminSetUserAdmin: 'user.admin.change',
  adminRevokeUserSessions: 'user.sessions.revoke',
  // サーバー設定・バックアップ
  adminUpdateServerSetting: 'setting.update',
  adminCreateBackup: 'backup.create',
  adminDeleteBackup: 'backup.delete',
  updateOidcConfig: 'sso.config.update',
  // ワークスペース
  //
  // ⚠️ **キーは GraphQL の実際のフィールド名と完全一致しなければならない。**
  // `MUTATION_ACTIONS[info.fieldName]` は完全一致で引くため、名前が1文字でも
  // 違うと**黙って記録されない**（仕様書に「記録する」と書いてあっても残らない）。
  // 実際に inviteMember / revoke / updateWorkspace という存在しない名前を
  // 書いており、メンバーの招待・削除が1件も記録されていなかった。
  // 名前を足すときは workspace.resolver.ts 等の @Mutation を必ず確認すること。
  createWorkspace: 'workspace.create',
  inviteMembers: 'workspace.member.invite',
  revokeMember: 'workspace.member.remove',
  acceptInviteById: 'workspace.member.accept',
  leaveWorkspace: 'workspace.member.leave',
  grantMember: 'workspace.member.role',
  approveMember: 'workspace.member.approve',
  createInviteLink: 'workspace.invite.link.create',
  revokeInviteLink: 'workspace.invite.link.revoke',
  // ドキュメント（作成・編集・削除は WebSocket 経由のため Gateway 側で記録）
  recoverDoc: 'doc.restore',
  publishPage: 'doc.publish',
  revokePublicPage: 'doc.unpublish',
  // 本人による変更
  changeMyPassword: 'user.password.change',
};

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType<string>() !== 'graphql') {
      return next.handle();
    }

    const gql = GqlExecutionContext.create(context);
    const info = gql.getInfo();
    if (info?.operation?.operation !== 'mutation') {
      return next.handle();
    }

    const action = MUTATION_ACTIONS[info.fieldName];
    if (!action) {
      return next.handle();
    }

    const req = gql.getContext().req;
    const args = gql.getArgs<Record<string, any>>();

    return next.handle().pipe(
      // 成功時のみ記録する。失敗の記録は Guard / AuthService が担う
      tap((result) => {
        const user = req?.user;
        const created = resultIdentity(result);
        // 本人による操作は、対象を空にせず本人を入れる
        // （「誰のパスワードが変わったのか」が分からない記録にしない）
        const self = action === 'user.password.change';
        void this.audit.record({
          action,
          actor: { id: user?.id, email: user?.email, name: user?.name },
          targetType: targetTypeOf(action),
          // ⚠️ 作成系は**引数に対象の ID が無い**（結果にしかない）。
          // 引数だけを見ていると「誰を作ったか」が残らず、監査ログとして
          // 成立しない（E2E で検出した）。
          targetId: self ? user?.id : targetIdOf(action, args, created.id),
          targetName: self ? user?.email : created.name,
          workspaceId: args?.workspaceId,
          ip: req?.ip,
          userAgent: req?.headers?.['user-agent'],
          detail: { meta: safeMeta(args) },
        });
      }),
    );
  }
}

/**
 * 結果から対象の識別情報を取り出す。
 *
 * 作成系（`adminCreateUser` / `createWorkspace` 等）は、引数に対象の ID が無く
 * **結果にしか無い**。ここを拾わないと「誰を・何を作ったか」が残らない。
 */
/**
 * 操作の対象 ID を引数から取り出す。
 *
 * ⚠️ **引数名は mutation ごとに違う。** 決め打ちの `??` 連鎖にすると、
 * 名前が合わない mutation で**別の値（workspaceId 等）が入り込み、
 * 誤った対象を指す監査ログ**ができる。実際に `publishPage` / `revokePublicPage`
 * （`pageId`）と `recoverDoc`（`guid`）が該当していた。
 *
 * **対象種別ごとに、見るべき引数名を明示する。**
 */
export function targetIdOf(
  action: string,
  args: Record<string, any> | undefined,
  fallback?: string,
): string | undefined {
  const type = targetTypeOf(action);
  const candidates: Record<string, string[]> = {
    doc: ['docId', 'pageId', 'guid'],
    user: ['userId', 'id'],
    workspace: ['workspaceId', 'id'],
    setting: ['key', 'id'],
    backup: ['id'],
    sso: ['id'],
  };

  for (const name of candidates[type ?? ''] ?? ['id']) {
    const value = args?.[name];
    if (typeof value === 'string' && value) return value;
  }
  // 招待の受諾は招待 ID しか持たない
  if (typeof args?.inviteId === 'string') return args.inviteId;
  // SSO 設定は単一。対象を空にすると「何の設定か」が分からない
  if (type === 'sso') return 'oidc';
  // 作成系は引数に対象 ID が無く、結果にしかない
  return fallback;
}

export function resultIdentity(result: unknown): { id?: string; name?: string } {
  if (!result || typeof result !== 'object') return {};
  const value = result as Record<string, unknown>;
  const id = typeof value.id === 'string' ? value.id : undefined;
  // 利用者はメールアドレス、ワークスペースは名前が「当時の対象名」になる
  const name =
    typeof value.email === 'string'
      ? value.email
      : typeof value.name === 'string'
        ? value.name
        : undefined;
  return { id, name };
}

function targetTypeOf(action: string): string | undefined {
  // ⚠️ メンバー操作の**対象はワークスペースではなく利用者**。
  // 接頭辞だけで決めると targetId にワークスペース ID が入り、
  // 「誰を外したのか」が分からない記録になる（workspaceId は別列にある）。
  if (action.startsWith('workspace.member.')) return 'user';
  const [prefix] = action.split('.');
  return ['user', 'workspace', 'setting', 'backup', 'sso', 'doc'].includes(
    prefix,
  )
    ? prefix
    : undefined;
}

/**
 * 引数から記録してよい値だけを取り出す。
 *
 * ⚠️ **引数をそのまま入れてはいけない。** `password` や CSV 本文（`csv`）が
 * そのまま監査ログに残り、パスワードを保存しない設計が意味を失う
 * （docs/logging.md 1章の共通ルール）。
 */
const SENSITIVE_ARGS = ['password', 'newPassword', 'currentPassword', 'csv', 'token', 'clientSecret'];

export function safeMeta(args: Record<string, any> | undefined): Record<string, unknown> {
  if (!args) return {};
  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (SENSITIVE_ARGS.includes(key)) continue;
    if (value === null || value === undefined) continue;
    // Date は Object.entries が空になり、そのまま渡すと黙って消える。
    // recoverDoc の timestamp（復元点）が失われ、何に戻したのか分からなくなる
    if (value instanceof Date) {
      meta[key] = value.toISOString();
      continue;
    }
    if (Array.isArray(value)) {
      // 配列をそのまま safeMeta に渡すと、添字をキーにしたオブジェクトになり
      // 「何が並んでいたのか」が読めなくなる。配列のまま残す
      meta[key] = value.map((item) =>
        item && typeof item === 'object'
          ? safeMeta(item as Record<string, any>)
          : item,
      );
      continue;
    }
    if (typeof value === 'object') {
      // input オブジェクトも中身を選別する（AdminCreateUserInput.password 等）
      const nested = safeMeta(value as Record<string, any>);
      if (Object.keys(nested).length > 0) meta[key] = nested;
      continue;
    }
    meta[key] = value;
  }
  return meta;
}

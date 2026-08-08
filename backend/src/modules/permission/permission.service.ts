import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import {
  type DocAction,
  type DocRole,
  DOC_ROLES,
  fromWorkspaceRole,
  roleCan,
  toMemberDocRole,
  MEMBER_READABLE_ROLE_NAMES,
} from './doc-role';

/**
 * #97: ドキュメント単位の認可（docs/doc-permission.md）。
 *
 * ⚠️ **ここが唯一の認可エンジンである。**
 *
 * 呼び出し側（Resolver / Controller / Gateway）が書いてよいのは
 * **このサービスを呼ぶことだけ**。`if (role === 'owner' || ...)` を経路側に書き始めると、
 * 同じ判断が各所に散らばり、**片方だけ直った状態**が生まれる。それが漏洩になる。
 *
 * 公開するのは3種類だけ（docs/doc-permission.md 6.0）。
 *
 * | 種類 | 用途 |
 * |---|---|
 * | `can` / `canRead` / `canUpdate` / `canDelete` | 1件の可否 |
 * | `filterReadable` | 一覧の絞り込み |
 * | `readableDocFilter` | 検索の**問い合わせ条件**（取ってから捨てない） |
 */
@Injectable()
export class PermissionService {
  constructor(private prisma: PrismaService) {}

  // ───────────────────────────── 権限変更の通知

  /** 権限が変わったときに呼ばれる（キャッシュの破棄用）。 */
  private readonly invalidateListeners: InvalidateListener[] = [];

  /**
   * 判定をキャッシュしている側（`sync.gateway` 等）が登録する。
   *
   * ⚠️ **キャッシュの寿命だけに頼らないこと**（docs/doc-permission.md 7章）。
   * 頼ると「権限を外したのに、相手のタブでは編集が続けられる」時間が生まれる。
   */
  onInvalidate(listener: InvalidateListener): void {
    this.invalidateListeners.push(listener);
  }

  /**
   * 権限を変えたことを知らせる。**変更する操作は必ずこれを呼ぶ。**
   *
   * @param userId 省略時はその doc の全員分を捨てる
   *   （既定ロールの変更は、誰の判定にも影響するため）
   *
   * ⚠️ キャッシュは**プロセスごと**である。多重に立てる構成にしたときは、
   * ここをプロセス間へ広げる必要がある（現在は単一プロセス前提）。
   */
  invalidate(workspaceId: string, docId: string, userId?: string): void {
    for (const listener of this.invalidateListeners) {
      listener(workspaceId, docId, userId);
    }
  }

  // ───────────────────────────── ワークスペース

  async getWorkspaceRole(
    workspaceId: string,
    userId: string,
  ): Promise<string | null> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    return member?.role ?? null;
  }

  /** サーバー全体 Admin か（判定をバイパスする）。 */
  private async isServerAdmin(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isAdmin: true },
    });
    return user?.isAdmin === true;
  }

  // ───────────────────────────── 実効ロール

  /**
   * 実効ロールを決める（docs/doc-permission.md 4.2）。
   *
   * ```
   * ⓪ ワークスペースのメンバーでなければ null（アクセスさせない）
   * ① サーバー全体 Admin は Owner
   * ② ドキュメントの設定 ?? ワークスペースのロール
   *      ドキュメントの設定 = DocPermission[利用者] ?? DocMeta.defaultRole
   * ```
   *
   * **段を増やさないこと。** 認可バグは評価順序で起きる。
   */
  async getDocRole(
    workspaceId: string,
    docId: string,
    userId: string,
  ): Promise<DocRole | null> {
    // ① バイパス。運用上の最終手段（復旧・調査）
    if (await this.isServerAdmin(userId)) return 'Owner';

    // ⓪ ⚠️ 前提。ワークスペースに居ないなら、doc に設定があっても通さない。
    // ここを省くと「doc の設定が置換する」の素直な実装で外部の人が入れてしまう。
    const workspaceRole = fromWorkspaceRole(
      await this.getWorkspaceRole(workspaceId, userId),
    );
    if (workspaceRole === null) return null;

    // ⚠️ **ワークスペースの管理者（owner / admin）は締め出さない。**
    // doc の設定を管理者にも適用すると、既定ロールを None にした本人が
    // **自分のワークスペースの文書から締め出され、サーバー全体 Admin しか
    // 復旧できない状態**になる（E2E で検出）。
    //
    // 隠す相手は「同じワークスペースの一般の利用者」であって、
    // そのワークスペースの管理者ではない。管理者はバックアップからも
    // DB からも読めるため、ここで隠しても境界にならない。
    if (workspaceRole === 'Owner') return 'Owner';

    // ② ドキュメントの設定（1つの層として扱う）
    const [docPerm, meta] = await Promise.all([
      this.prisma.docPermission.findUnique({
        where: { workspaceId_docId_userId: { workspaceId, docId, userId } },
        select: { role: true },
      }),
      this.prisma.docMeta.findUnique({
        where: { workspaceId_docId: { workspaceId, docId } },
        select: { defaultRole: true },
      }),
    ]);

    // 利用者個別 > ドキュメント既定。どちらも無ければワークスペースのロール。
    // ⚠️ toMemberDocRole は External を通さない。混ぜると⓪の抜け道になる
    if (docPerm) return toMemberDocRole(docPerm.role);
    if (meta?.defaultRole) return toMemberDocRole(meta.defaultRole);
    return workspaceRole;
  }

  // ───────────────────────────── 1件の可否

  /** そのアクションを行えるか。**経路側はこれだけを呼ぶ。** */
  async can(
    workspaceId: string,
    docId: string,
    userId: string,
    action: DocAction,
  ): Promise<boolean> {
    const role = await this.getDocRole(workspaceId, docId, userId);
    if (role === null) return false;
    return roleCan(role, action);
  }

  canRead(workspaceId: string, docId: string, userId: string) {
    return this.can(workspaceId, docId, userId, 'Doc_Read');
  }

  canUpdate(workspaceId: string, docId: string, userId: string) {
    return this.can(workspaceId, docId, userId, 'Doc_Update');
  }

  canDelete(workspaceId: string, docId: string, userId: string) {
    return this.can(workspaceId, docId, userId, 'Doc_Delete');
  }

  // ───────────────────────────── 一覧の絞り込み

  /**
   * 読める doc だけに絞る（docs/doc-permission.md 6.0）。
   *
   * ⚠️ **一覧・バックリンクは必ずこれを通す。**
   * 本文を返していなくても、**タイトルと件数で存在が漏れる。**
   *
   * 入力の順序を保つ（並び順は呼び出し側の関心事）。
   */
  async filterReadable(
    workspaceId: string,
    docIds: string[],
    userId: string,
  ): Promise<string[]> {
    if (docIds.length === 0) return [];
    if (await this.isServerAdmin(userId)) return docIds;

    const workspaceRole = fromWorkspaceRole(
      await this.getWorkspaceRole(workspaceId, userId),
    );
    if (workspaceRole === null) return [];
    // ワークスペースの管理者は締め出さない（getDocRole と同じ扱い）
    if (workspaceRole === 'Owner') return docIds;

    // ⚠️ 1件ずつ getDocRole を呼ぶと N+1 になる。まとめて引く。
    const unique = [...new Set(docIds)];
    const [perms, metas] = await Promise.all([
      this.prisma.docPermission.findMany({
        where: { workspaceId, userId, docId: { in: unique } },
        select: { docId: true, role: true },
      }),
      this.prisma.docMeta.findMany({
        where: { workspaceId, docId: { in: unique } },
        select: { docId: true, defaultRole: true },
      }),
    ]);

    const permOf = new Map(perms.map((p) => [p.docId, p.role]));
    const defaultOf = new Map(metas.map((m) => [m.docId, m.defaultRole]));

    return docIds.filter((docId) => {
      const explicit = permOf.get(docId);
      const fallback = defaultOf.get(docId);
      const role = explicit
        ? toMemberDocRole(explicit)
        : fallback
          ? toMemberDocRole(fallback)
          : workspaceRole;
      return roleCan(role, 'Doc_Read');
    });
  }

  // ───────────────────────────── 検索の問い合わせ条件

  /**
   * 検索に差し込む「読める doc」の条件（docs/doc-permission.md 6.3）。
   *
   * ⚠️ **取ってから捨ててはいけない。**
   * 後から捨てると**ページングが壊れ**（20件取って15件捨てたら5件しか返らない）、
   * 件数表示も嘘になる。**その数字自体が存在を漏らす。**
   *
   * @param nextParamIndex 呼び出し側が既に使っている位置パラメータの次の番号
   *   （既存の検索は `$1` に workspaceId を使っているため、通常は 2）
   *
   * 返すのは `search_index` の `WHERE` に `AND` で足せる断片。
   * `doc_id` の相関副問い合わせにしてあるため、**検索対象そのものを絞る。**
   */
  async readableDocFilter(
    workspaceId: string,
    userId: string,
    nextParamIndex: number,
  ): Promise<DocFilter> {
    // Admin は全件。条件を足さない
    if (await this.isServerAdmin(userId)) return ALLOW_ALL;

    const workspaceRole = fromWorkspaceRole(
      await this.getWorkspaceRole(workspaceId, userId),
    );
    // ワークスペースに居ないなら1件も読めない（⓪ 前提）
    if (workspaceRole === null) return DENY_ALL;
    // ワークスペースの管理者は全件（getDocRole と同じ扱い）
    if (workspaceRole === 'Owner') return ALLOW_ALL;

    const p = (offset: number) => `$${nextParamIndex + offset}`;

    // ⚠️ 4.2 の優先順位（利用者個別 > doc 既定 > ワークスペース）を
    // そのまま SQL にしたもの。順序を崩さないこと。
    const sql = `(
      CASE
        WHEN dp.role IS NOT NULL        THEN lower(dp.role)          = ANY(${p(0)})
        WHEN dm.default_role IS NOT NULL THEN lower(dm.default_role) = ANY(${p(0)})
        ELSE ${p(1)}
      END
    )`;

    // search_index には doc の権限が無いため、外側から持ち込む。
    //
    // ⚠️ **ふつうの LEFT JOIN にしてはいけない。**
    // `doc_permissions` / `doc_meta` も `doc_id` と `workspace_id` を持つため、
    // 結合した瞬間に検索側の裸の列名が**曖昧になり、検索が 500 で落ちる**
    // （`column reference "doc_id" is ambiguous`）。
    // しかも落ちた検索は空を返すため、**「権限で隠せている」ように見えてしまう。**
    //
    // LATERAL で**必要な1列だけ**を出せば、持ち込む列名が衝突しない。
    const from = `
      LEFT JOIN LATERAL (
        SELECT dp0.role
          FROM doc_permissions dp0
         WHERE dp0.workspace_id = search_index.workspace_id
           AND dp0.doc_id       = search_index.doc_id
           AND dp0.user_id      = ${p(2)}::uuid
         LIMIT 1
      ) dp ON true
      LEFT JOIN LATERAL (
        SELECT dm0.default_role
          FROM doc_meta dm0
         WHERE dm0.workspace_id = search_index.workspace_id
           AND dm0.doc_id       = search_index.doc_id
         LIMIT 1
      ) dm ON true`;

    return {
      sql,
      // 呼び出し側が FROM に差し込む
      join: from,
      params: [
        MEMBER_READABLE_ROLE_NAMES,
        roleCan(workspaceRole, 'Doc_Read'),
        userId,
      ],
    };
  }
}

/**
 * 検索へ差し込む断片。
 *
 * `join` を FROM に、`sql` を WHERE に足し、`params` を末尾に連結する。
 */
export type InvalidateListener = (
  workspaceId: string,
  docId: string,
  userId?: string,
) => void;

export interface DocFilter {
  sql: string;
  join: string;
  params: unknown[];
}

/** 条件を足さない（Admin）。 */
const ALLOW_ALL: DocFilter = { sql: 'true', join: '', params: [] };

/** 1件も読めない（ワークスペースの非メンバー）。 */
const DENY_ALL: DocFilter = { sql: 'false', join: '', params: [] };


import { Args, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationInput } from '../user/user.model';
import { DocType } from '../workspace/workspace.model';
import { DocService } from '../doc/doc.service';
import {
  fromWorkspaceRole,
  toDocRole,
  type DocRole,
} from './doc-role';
import { PermissionService } from './permission.service';
import {
  DocRoleEnum,
  PaginatedGrantedDocUserType,
} from './permission.model';

/**
 * #97: 「誰がこの doc を見られるか」を返す項目（docs/doc-permission.md 8章）。
 *
 * ⚠️ **「誰が見られるか」と「既定の権限レベル」は分けて扱う。**
 *
 * | 項目 | 必要な判定 | 理由 |
 * |---|---|---|
 * | `grantedUsersList` | `Doc_Users_Read` | **個人が特定できる。** 役員限定ページの閲覧者一覧から人事異動が推測できる |
 * | `defaultRole` | `Doc_Read` | **文書の属性であって、誰の情報でもない。** 読める人が「この文書は既定で誰でも読める」と知っても、漏れるものが無い |
 *
 * ⚠️ `defaultRole` を `Doc_Users_Read` にしてはいけない。共有メニューが開くたびに
 * 要求される項目であり、Editor / Reader（`Doc_Users_Read` を持たない）が
 * **共有メニューを開いた時点で落ちる**。
 *
 * ⚠️ **`DocType` の項目として実装している**のは、要求されたときだけ
 * 判定を走らせるため。`workspace.doc` の戻り値に混ぜると、
 * 権限 UI を開いていない利用者にも毎回問い合わせが起きる。
 */
@Resolver(() => DocType)
export class DocTypeResolver {
  constructor(
    private permission: PermissionService,
    private docService: DocService,
  ) {}

  /**
   * ドキュメントの既定ロール。
   *
   * ⚠️ **これは「閲覧者が何を持つか」ではなく「ワークスペースのメンバーが
   * この文書に対して何を得るか」である。** 画面のラベルも
   * 「ワークスペースのメンバー」であり、**文書の属性**を表す。
   *
   * 一度、閲覧者自身の実効ロールを返す実装にして誤った。所有者が開くと
   * `Owner` が返り、**画面の選択肢（管理可能／編集可能／読めます／アクセス不可）に
   * `Owner` が無いため、ロール名が空欄で表示された。**
   *
   * ⚠️ **固定値も返さないこと。** さらに以前は `'manager'` を返していたが、
   * 実際の判定は「未設定ならワークスペースのロール」であり、
   * 画面の表示と挙動が食い違っていた。
   */
  @ResolveField(() => DocRoleEnum)
  async defaultRole(
    @Parent() doc: DocType & { defaultRole?: string | null },
    @CurrentUser() user: { id: string },
  ): Promise<DocRole> {
    // 読める人には見せる（この項目は個人を特定しない）。
    //
    // ⚠️ **例外を投げないこと。** この項目は非 null（`DocRole!`）なので、
    // 例外は非 null 伝播で親まで遡り、**`workspace.doc` ごと `null` に
    // する**（title も permissions も失われる）。
    // 読めない doc はそもそも `workspace.doc` が `null` を返すため
    // ここへ来ないが、**その前提に依存しない**。
    const allowed = await this.permission.can(
      doc.workspaceId,
      doc.id,
      user.id,
      'Doc_Read',
    );
    if (!allowed) return 'None';

    // ⚠️ **読み出し側で値を寄せないこと。** 寄せると保存した値と読み出した値が
    // 食い違い（Commenter を保存すると Reader が返る）、画面はその表示値を
    // そのまま保存に使うため、**メニューを開いて保存しただけで権限が下がる**。
    // 画面が扱えない値は、保存できないようにする側で防ぐ（DOC_DEFAULT_ROLES）。
    //
    // 設定があればそれ。無ければ「ワークスペースのメンバーが得るもの」＝
    // ワークスペースのロール member を 4.2 に通した結果
    return doc.defaultRole
      ? toDocRole(doc.defaultRole)
      : (fromWorkspaceRole('member') ?? 'None');
  }

  /**
   * 個別の権限を持つ利用者の一覧。
   *
   * ⚠️ **既定ロールで読めている人はここに出ない。** 出るのは
   * 明示的に設定された人だけである。
   */
  @ResolveField(() => PaginatedGrantedDocUserType)
  async grantedUsersList(
    @Parent() doc: DocType,
    @CurrentUser() user: { id: string },
    @Args('pagination', { type: () => PaginationInput, nullable: true })
    pagination?: PaginationInput,
  ): Promise<PaginatedGrantedDocUserType> {
    // ⚠️ **例外を投げないこと。** この項目は非 null（`PaginatedGrantedDocUserType!`）
    // なので、例外は非 null 伝播で親まで遡り、**`workspace.doc` ごと `null` に
    // する**。すると Doc_Users_Read を持たない Editor / Reader は
    // title も permissions も失い、画面が全操作不可になる。
    // **見せないだけにする（空を返す）。**
    const allowed = await this.permission.can(
      doc.workspaceId,
      doc.id,
      user.id,
      'Doc_Users_Read',
    );
    if (!allowed) return EMPTY_GRANTED_USERS;

    const take = Math.min(pagination?.first ?? 50, 100);
    const skip = decodeCursor(pagination?.after);

    const { rows, totalCount } = await this.docService.listDocGrantedUsers(
      doc.workspaceId,
      doc.id,
      skip,
      take,
    );

    return {
      totalCount,
      edges: rows.map((r, i) => ({
        cursor: encodeCursor(skip + i + 1),
        node: {
          // ⚠️ DB の値をそのまま列挙型に流さない。大文字小文字が違うだけで
          // GraphQL の直列化が落ち、権限UI 全体が壊れる。
          // ただし**値は寄せない**（寄せると表示と実体が食い違う）
          role: toDocRole(r.role),
          user: {
            id: r.user?.id ?? '',
            name: r.user?.name ?? undefined,
            email: r.user?.email ?? undefined,
            avatarUrl: r.user?.avatarUrl ?? undefined,
          },
        },
      })),
      pageInfo: {
        endCursor: encodeCursor(skip + rows.length),
        hasNextPage: skip + rows.length < totalCount,
      },
    };
  }

}

/** 権限が無いときに返すもの。**例外にしない**（上記の理由）。 */
const EMPTY_GRANTED_USERS: PaginatedGrantedDocUserType = {
  totalCount: 0,
  edges: [],
  pageInfo: { endCursor: undefined, hasNextPage: false },
};

/** 一覧の位置。件数をそのまま base64 にしただけの簡素なもの。 */
function encodeCursor(offset: number): string {
  return Buffer.from(String(offset)).toString('base64');
}

function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  const n = Number(Buffer.from(cursor, 'base64').toString('utf-8'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

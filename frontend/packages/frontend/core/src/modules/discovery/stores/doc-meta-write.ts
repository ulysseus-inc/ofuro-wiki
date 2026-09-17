import {
  changeDocTagsMutation,
  createDocMetaMutation,
  deleteDocMetaMutation,
  setDocTitleMutation,
  setDocTrashMutation,
} from '@ofuro/graphql';
import { Store } from '@toeverything/infra';

import type { WorkspaceServerService } from '../../cloud';

/**
 * #151 段階3: Discovery Metadata をサーバーへ書き込む。
 *
 * ⚠️ **ここは「送る」だけ。** ローカルへの反映は呼び出し側が
 * **送る前に**済ませること（7.5.2 の write-through）。
 * サーバーの応答を待ってから画面を変えると、`createDoc` の同期連鎖が
 * 壊れる（7.5.1 で実験済み。**サーバー先行は採れない**）。
 *
 * ## 値型と操作型を分ける
 *
 * | 種類 | 対象 | 送り方 |
 * |---|---|---|
 * | **値型** | `title` / `trash` | 基準の版数を添える |
 * | **操作型** | `tags` | **add / remove を送る**（配列全体を送らない） |
 *
 * 配列全体を送ると、2人が別のタグを付けたときに一方が消える（#164）。
 *
 * 詳細は docs/discovery-stage3-comparison.md 7.5.2 / 7.5.10
 */
export class DocMetaWriteStore extends Store {
  constructor(private readonly workspaceServerService: WorkspaceServerService) {
    super();
  }

  private get server() {
    const server = this.workspaceServerService.server;
    if (!server) throw new Error('No Server');
    return server;
  }

  /**
   * ⚠️ **`as any` を使う理由**（#131）。
   *
   * `gql()` の型は codegen が作る `schema.ts` の対応表を引く。
   * この3件は **`.gql` を伴わない手書き**（#131）で対応表に載らないため、
   * 型が `never` に落ちて呼び出せない。
   *
   * 既存の手書き定義（`oidcConfigQuery` など27件）も同じ回避をしている
   * （`admin-setting/sso-settings.tsx:64`）。
   * **#131 を直して `.gql` 化すれば、この回避は不要になる。**
   */
  private async call(
    query: unknown,
    variables: Record<string, unknown>
  ): Promise<Record<string, DocMetaWriteRaw>> {
    return (await this.server.gql({ query, variables } as never)) as never;
  }

  /**
   * ページを台帳へ登録する（#151 段階3）。
   *
   * ⚠️ **これを呼ばないと、新しいページが誰の一覧にも出ない。**
   * 段階2 までは `doc-meta-sync` が Yjs 目次から行を作っていた。
   */
  async createDoc(params: {
    workspaceId: string;
    docId: string;
    title: string;
    mode: string;
  }): Promise<DocMetaWriteResult> {
    const data = await this.call(createDocMetaMutation, params);
    return toResult(data.createDocMeta);
  }

  /** ページを台帳から消す（#151 段階3）。 */
  async deleteDoc(params: {
    workspaceId: string;
    docId: string;
  }): Promise<DocMetaWriteResult> {
    const data = await this.call(deleteDocMetaMutation, params);
    return toResult(data.deleteDocMeta);
  }

  /**
   * 題を変える。
   *
   * ⚠️ **競合の判定は版数（`baseRevision`）だけ。** 移行期間にあった
   * 「見ていた値と突き合わせる」判定は撤去された（7.7.5）。
   */
  async setTitle(params: {
    workspaceId: string;
    docId: string;
    title: string;
    baseRevision: string;
  }): Promise<DocMetaWriteResult> {
    const data = await this.call(setDocTitleMutation, {
        workspaceId: params.workspaceId,
        docId: params.docId,
        title: params.title,
        baseRevision: params.baseRevision,
    });
    return toResult(data.setDocTitle);
  }

  /** ゴミ箱へ入れる / 戻す。 */
  async setTrash(params: {
    workspaceId: string;
    docId: string;
    trash: boolean;
    baseRevision: string;
  }): Promise<DocMetaWriteResult> {
    const data = await this.call(setDocTrashMutation, {
        workspaceId: params.workspaceId,
        docId: params.docId,
        trash: params.trash,
        baseRevision: params.baseRevision,
    });
    return toResult(data.setDocTrash);
  }

  /**
   * タグを**要素単位**で足す / 外す。
   *
   * ⚠️ **配列全体を送らないこと。** #164 と同じ形で一方が消える。
   */
  async changeTags(params: {
    workspaceId: string;
    docId: string;
    add: string[];
    remove: string[];
  }): Promise<DocMetaWriteResult> {
    const data = await this.call(changeDocTagsMutation, {
        workspaceId: params.workspaceId,
        docId: params.docId,
        add: params.add,
        remove: params.remove,
    });
    return toResult(data.changeDocTags);
  }
}

interface DocMetaWriteRaw {
  status: string;
  revision?: string | null;
  currentTitle?: string | null;
  currentTrash?: boolean | null;
  // #151 段階3: 作成のときだけ返る（7.12）
  titleRevision?: string | null;
  trashRevision?: string | null;
  tagsRevision?: string | null;
}

function toResult(raw: DocMetaWriteRaw): DocMetaWriteResult {
  return {
    status: raw.status as DocMetaWriteResult['status'],
    revision: raw.revision ?? undefined,
    currentTitle: raw.currentTitle ?? undefined,
    currentTrash: raw.currentTrash ?? undefined,
    // #151 段階3: 作成のときだけ返る、3フィールドそれぞれの版数（7.12）
    titleRevision: raw.titleRevision ?? undefined,
    trashRevision: raw.trashRevision ?? undefined,
    tagsRevision: raw.tagsRevision ?? undefined,
  };
}

/**
 * 書き込みの結果。
 *
 * ⚠️ **「失敗」を1つにまとめないこと。** 扱いを分ける（7.5.10）。
 *
 * | status | 扱い |
 * |---|---|
 * | `ok` | 未送信分を破棄してよい |
 * | `stale` | **返された現在値をローカルへ反映してから**未送信分を捨てる |
 * | `not-found` | 台帳に行が無い。再取得する |
 *
 * 権限が無い場合は GraphQL エラー（例外）になる。
 */
export interface DocMetaWriteResult {
  status: 'ok' | 'stale' | 'not-found';
  revision?: string;
  currentTitle?: string;
  currentTrash?: boolean;
  /**
   * #151 段階3: **作成のときだけ返る、3フィールドそれぞれの版数**（7.12）。
   *
   * ⚠️ **`revision`（単数）で代用しないこと。** あれは「いま書いた
   * フィールドの版数」であり、作成は3つ同時に採番する。
   * ⚠️ **「作成時は全部 1」と推測しないこと。** 作成は冪等な upsert で、
   * 再送では**既にある行の版数**が返る。推測すると、改名済みのページを
   * 再送したときに trash / tags へ嘘の版数を書く。
   */
  titleRevision?: string;
  trashRevision?: string;
  tagsRevision?: string;
}

import type { DocMeta } from '@blocksuite/affine/store';

/**
 * #151 段階3: Discovery Metadata の**同期**キャッシュ。
 *
 * ## ⚠️ これは高速化のためのキャッシュではない
 *
 * 段階3 の設計では、**ここが実行時の正**になる（7.5.3）。
 * 失われると「表示が遅れる」ではなく**ドキュメントが存在しなくなる**。
 *
 * | | 通常のキャッシュ | ここでのキャッシュ |
 * |---|---|---|
 * | 正本 | サーバー | **ローカル（実行時の正）** |
 * | 失われたら | 引き直せばよい | **ドキュメントが存在しなくなる** |
 *
 * ## ⚠️ 同期でなければならない
 *
 * `WorkspaceMeta.getDocMeta` は**同期の getter で `Promise` を返せない**
 * （`blocksuite/.../workspace-meta.ts:27`）。
 * `root-block-model.ts:20` が「読んでから書く」ため、ここが `undefined` を
 * 返すと**ドキュメントを開くたびに本文の題がサーバーの題を上書きする**（7.3）。
 *
 * そのため取得は非同期でも、**読み出しは必ず同期**にする。
 *
 * ## いまの段階（PR2a）でできること
 *
 * ⚠️ **まだサーバー台帳が正ではない。** この版では、値の更新は従来どおり
 * Yjs 目次が駆動し、ここはその写しを保持するだけ。
 * 読み出し経路を差し替えて、上記の同期制約が成り立つことを確かめるのが目的。
 * サーバーを正にするのは write-through を入れる次の段階（7.5.2）。
 *
 * 詳細は docs/discovery-stage3-comparison.md 7.5
 */
export class DocMetaCache {
  private readonly byId = new Map<string, DocMeta>();

  /** ⚠️ 台帳の取得が完了したか。**初期化完了の定義**（7.5.5） */
  private ready = false;

  /**
   * 読み出せる状態か。
   *
   * ⚠️ **「API が返った」ではなく「読み出せる状態になった」を指す**（7.5.5）。
   * ここが false のあいだにメタデータ同期処理を走らせないこと。
   */
  get isReady(): boolean {
    return this.ready;
  }

  /**
   * 台帳から取得した内容で総入れ替えする。**初期化完了とみなす。**
   *
   * ⚠️ 取得に失敗したときに呼ばないこと。空で埋めると
   * **全ドキュメントが存在しない状態になる**（原則1・7.5.7）。
   */
  hydrate(metas: DocMeta[]): void {
    this.byId.clear();
    for (const meta of metas) this.byId.set(meta.id, meta);
    this.ready = true;
  }

  /**
   * 1件を**丸ごと差し替える**。**既に無ければ何もしない。**
   *
   * ⚠️ **混ぜ合わせ（merge）にしないこと。** 目次からフィールドごと
   * 消された場合、その項目は渡される内容に含まれない。混ぜると
   * **消えたはずの値がキャッシュに残り続ける**。
   *
   * @returns 差し替えたか。false なら呼び出し側で作り直すこと
   *   （そのまま捨てると、その変更が反映されないまま残る）
   */
  replace(meta: DocMeta): boolean {
    if (!this.byId.has(meta.id)) return false;
    this.byId.set(meta.id, meta);
    return true;
  }

  /**
   * 1件を足す（#151 段階3）。
   *
   * ⚠️ **同期で足せること。** `createDoc` は `addDocMeta` の直後に
   * `getDoc` を呼ぶため（7.5.1 で実験済み）、非同期にすると
   * **作ったページを開けない**。
   *
   * ⚠️ **すでにあれば足さないこと。** 作成は再送され得るし、
   * 足すと一覧に同じページが2つ出る。
   */
  add(meta: DocMeta, index?: number): void {
    if (this.byId.has(meta.id)) return;

    if (index === undefined || index >= this.byId.size) {
      this.byId.set(meta.id, meta);
      return;
    }
    // ⚠️ 並び順は投入順で保っているため、途中に入れるには組み直す
    const entries = [...this.byId.entries()];
    entries.splice(index, 0, [meta.id, meta]);
    this.byId.clear();
    for (const [id, m] of entries) this.byId.set(id, m);
  }

  /** 1件を消す（#151 段階3）。**無ければ何もしない。** */
  remove(id: string): boolean {
    return this.byId.delete(id);
  }

  /**
   * 1件の**一部だけ**を書き換える（#151 段階3）。
   *
   * ⚠️ `replace` との違いに注意。あちらは丸ごと差し替えで、
   * 渡されなかった項目は**消える**。こちらは編集や巻き戻しのように
   * **1フィールドだけを触る**ときに使う。
   *
   * @returns 書き換えたか。false なら台帳に無いページ
   */
  patch(id: string, props: Partial<DocMeta>): boolean {
    const current = this.byId.get(id);
    if (!current) return false;
    this.byId.set(id, { ...current, ...props });
    return true;
  }

  /**
   * ⚠️ 同期で返すこと（`Promise` にしない）。
   *
   * ⚠️ **戻り値は写しであり、書き換えても保存されない。**
   * 以前は Yjs の proxy をそのまま返していたため、その場で
   * `meta.title = '...'` と書くと Yjs へ届いていた。いまは届かない。
   * 変更は必ず `setDocMeta` を通すこと（そこが競合制御の唯一の入口）。
   *
   * 差し替え時に全消費者を確認済み（2026-08-19）。`titleMiddleware` /
   * `.find()` / 比較のみで、**戻り値を書き換えている箇所は無い**。
   * `workspace/impls/workspace.ts:161` / `root-block-model.ts:20` /
   * `embed-linked-doc-block.ts:131` / `embed-synced-doc-block.ts:494` の
   * いずれも読み取りだけ。
   */
  get(id: string): DocMeta | undefined {
    return this.byId.get(id);
  }

  /**
   * ⚠️ 同期で返すこと。並び順は投入順を保つ。戻り値は写し（`get` と同じ）。
   *
   * ⚠️ 型で `readonly` にはできない。`WorkspaceMeta` の宣言が
   * `DocMeta[]` を要求するため（上流の型に合わせる）。
   */
  list(): DocMeta[] {
    return [...this.byId.values()];
  }

  // ⚠️ ワークスペースの切り替えでは `WorkspaceMetaImpl` ごと作り直されるため、
  // 中身を捨てる操作は要らない。呼び出し元の無い機能を置かないこと
}

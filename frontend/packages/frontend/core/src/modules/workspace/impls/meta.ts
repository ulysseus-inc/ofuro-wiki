import {
  createYProxy,
  type DocMeta,
  type DocsPropertiesMeta,
  type WorkspaceMeta,
} from '@blocksuite/affine/store';
import { Subject } from 'rxjs';
import type * as Y from 'yjs';

import { DocMetaCache } from './doc-meta-cache';

type MetaState = {
  pages?: unknown[];
  properties?: DocsPropertiesMeta;
  name?: string;
  avatar?: string;
};

export class WorkspaceMetaImpl implements WorkspaceMeta {
  /* eslint-disable rxjs/finnish */
  commonFieldsUpdated = new Subject<void>();
  docMetaAdded = new Subject<string>();
  docMetaRemoved = new Subject<string>();
  docMetaUpdated = new Subject<void>();
  /* eslint-enable rxjs/finnish */

  private readonly _handleDocCollectionMetaEvents = (
    events: Y.YEvent<Y.Array<unknown> | Y.Text | Y.Map<unknown>>[]
  ) => {
    // ⚠️ **通知より先にキャッシュを更新すること。**
    // 購読者は通知を受けたその場で読みに来る（`workspace.ts:93` は
    // `DocImpl` を作る）。順序を逆にすると、作成直後のメタを引けない。
    //
    // ⚠️ **通知の条件（下の forEach）とは別に、全イベントで更新すること。**
    // タグはページの中の Y.Array で変わるため、`e.target.parent === yDocs`
    // に当てはまらず、通知の条件では拾えない（実測で確認）。
    // 拾い漏らすと**タグの変更が一覧に出ない**
    // ⚠️ 台帳が正のときは、目次の変化でキャッシュを触らない。
    // 触ると**目次に残っている権限外のページが混ざる**
    if (!this._ledgerDriven) events.forEach(e => this._syncCacheFor(e));

    events.forEach(e => {
      const hasKey = (k: string) =>
        e.target === this._yMap && e.changes.keys.has(k);

      if (
        e.target === this.yDocs ||
        e.target.parent === this.yDocs ||
        hasKey('pages')
      ) {
        this._handleDocMetaEvent();
      }

      if (hasKey('name') || hasKey('avatar')) {
        this._handleCommonFieldsEvent();
      }
    });
  };

  private readonly _id: string = 'meta';
  private readonly _doc: Y.Doc;
  private readonly _proxy: MetaState;
  private readonly _yMap: Y.Map<MetaState[keyof MetaState]>;
  private _prevDocs = new Set<string>();

  get avatar() {
    return this._proxy.avatar;
  }

  setAvatar(avatar: string) {
    this._doc.transact(() => {
      this._proxy.avatar = avatar;
    }, this._doc.clientID);
  }

  get name() {
    return this._proxy.name;
  }

  setName(name: string) {
    this._doc.transact(() => {
      this._proxy.name = name;
    }, this._doc.clientID);
  }

  get properties(): DocsPropertiesMeta {
    const meta = this._proxy.properties;
    if (!meta) {
      return {
        tags: {
          options: [],
        },
      };
    }
    return meta;
  }

  setProperties(meta: DocsPropertiesMeta) {
    this._proxy.properties = meta;
    this.docMetaUpdated.next();
  }

  /**
   * ⚠️ **同期で返すこと。** `WorkspaceMeta` の宣言が `Promise` を許さず、
   * `root-block-model.ts` は「読んでから書く」ため、ここが空を返すと
   * **ドキュメントを開くたびに本文の題が上書きされる**（7.3）。
   *
   * #151 段階3: 読み出しはキャッシュ経由にした。いまは Yjs 目次が
   * その中身を駆動しているため、**返す内容は今までと同じ**。
   */
  get docMetas() {
    return this.docMetaCache.list();
  }

  get docs() {
    return this._proxy.pages;
  }

  get yDocs() {
    return this._yMap.get('pages') as unknown as Y.Array<unknown>;
  }

  /**
   * #151 段階3: 同期で読める Discovery Metadata の保持先。
   *
   * ⚠️ `getDocMeta` / `docMetas` は**同期**でなければならない
   * （`WorkspaceMeta` の宣言が `Promise` を許さない）。7.3 を参照。
   */
  readonly docMetaCache: DocMetaCache;

  /**
   * #151 段階3: サーバーへ書き込みを送る手段。
   *
   * ⚠️ **無ければ送らない。** BlockSuite のテストなど、サーバーが無い
   * 場面でも `WorkspaceMetaImpl` は作られる。
   */
  private readonly _sendToServer?: DocMetaWriteSender;

  /**
   * #151 段階3: ページの作成・削除を台帳へ知らせる手段。
   *
   * ⚠️ **無ければ目次を正のまま使う**（下の `_ledgerDriven`）。
   * BlockSuite のテストなど、サーバーが無い場面でも
   * `WorkspaceMetaImpl` は作られる。
   */
  private readonly _notifyCreated?: (id: string, meta: DocMeta) => void;
  private readonly _notifyDeleted?: (id: string) => void;

  /**
   * 台帳が Discovery Metadata の供給元か。
   *
   * ⚠️ **段階3 の中心。** true なら目次（Yjs `meta.pages`）には
   * 書かないし読まない。false（サーバー不在）なら従来どおり目次を使う。
   *
   * ⚠️ **`_sendToServer` の有無で判定してはいけない。** ローカル
   * ワークスペースでも呼び出し側は常に渡すため、常に真になる。
   * その結果**ローカルのページが一覧に出ず、開けなくなる**
   * （`DocsStore` はサーバー不在時に目次を見るため、食い違う）。
   * 判定の根拠を `DocsStore.ledgerDriven` と必ず揃えること。
   */
  private readonly _ledgerDriven: boolean;

  constructor(
    doc: Y.Doc,
    docMetaCache?: DocMetaCache,
    sendToServer?: DocMetaWriteSender,
    notifyCreated?: (id: string, meta: DocMeta) => void,
    notifyDeleted?: (id: string) => void,
    ledgerDriven = false
  ) {
    this._doc = doc;
    this._ledgerDriven = ledgerDriven;
    this._sendToServer = sendToServer;
    this._notifyCreated = notifyCreated;
    this._notifyDeleted = notifyDeleted;
    this.docMetaCache = docMetaCache ?? new DocMetaCache();
    const map = doc.getMap(this._id) as Y.Map<MetaState[keyof MetaState]>;
    this._yMap = map;
    this._proxy = createYProxy(map);
    this._yMap.observeDeep(this._handleDocCollectionMetaEvents);
    // ⚠️ 台帳が正のときは目次から取り込まない。取り込むと
    // **権限外のページが（目次に残っている限り）一覧に出る**
    if (!this._ledgerDriven) this._syncCacheFromIndex();
  }

  /**
   * #151 段階3: **台帳の内容をキャッシュへ入れる。**
   *
   * ⚠️ **これが 7.5.5 の「初期化完了」。** API が返ったことではなく、
   * `WorkspaceMeta` の読み出しがキャッシュを参照できる状態になったこと。
   *
   * ⚠️ 取得に失敗したときに呼ばないこと。空で埋めると
   * **全ドキュメントが存在しない状態になる**（原則1）。
   */
  hydrateFromLedger(metas: DocMeta[]): void {
    this.docMetaCache.hydrate(metas);
    // ⚠️ 取り込んだあとに知らせること。逆にすると、購読者が
    // その場で読みに来たときに古い内容を引く
    this._handleDocMetaEvent();
  }

  /**
   * 変わったところだけキャッシュへ反映する。
   *
   * ⚠️ **毎回すべて作り直さないこと。** 題は打鍵のたびに `setDocMeta` を
   * 通るため（`doc-title.ts:141`）、ページ数ぶんの作り直しが毎打鍵で走る。
   */
  private _syncCacheFor(
    event: Y.YEvent<Y.Array<unknown> | Y.Text | Y.Map<unknown>>
  ): void {
    // ⚠️ **目次と無関係な変更で作り直さないこと。**
    // `meta` 直下には `properties`（タグの選択肢）・`name`・`avatar` も
    // ぶら下がっている。これらはページを特定できないため、除外しないと
    // **タグの選択肢をいじるたびに全ページを作り直す**
    if (event.target === this._yMap && !event.changes.keys.has('pages')) {
      return;
    }

    const pageMap = this._owningPage(event.target);
    if (pageMap) {
      const meta = pageMap.toJSON() as DocMeta;
      // ⚠️ 差し替えられたときだけ終わること。まだ取り込んでいないページや
      // 初期化前だと `replace` は何もしないので、そのまま返すと
      // **その変更が反映されないまま残る**。
      //
      // ⚠️ これは**予防**であって、現状この経路に入る操作は見つけられていない
      // （ページの増減は必ず作り直しを起こすため、入れ子の変更が来る時点で
      // そのページはキャッシュにある）。**テストで固定できていない。**
      if (typeof meta.id === 'string' && this.docMetaCache.replace(meta)) {
        return;
      }
    }
    // ページを特定できない（一覧そのものの増減など）／まだ取り込んでいない
    // なら作り直す
    this._syncCacheFromIndex();
  }

  /** その変更が属するページの Y.Map を辿る。見つからなければ undefined */
  private _owningPage(
    // ⚠️ YEvent.target の型（YMap | YArray | YText）をそのまま受ける。
    // AbstractType に狭めると呼び出し側で型が合わない
    target: Y.YEvent<Y.Array<unknown> | Y.Text | Y.Map<unknown>>['target']
  ): Y.Map<unknown> | undefined {
    let node: unknown = target;
    while (node) {
      const current = node as { parent?: unknown };
      if (current.parent === this.yDocs) return node as Y.Map<unknown>;
      node = current.parent ?? null;
    }
    return undefined;
  }

  /**
   * 目次の内容をまるごとキャッシュへ写す。
   *
   * ⚠️ **この段階（PR2a）では Yjs 目次が正のまま。**
   * サーバー台帳を正にするのは write-through を入れる次の段階（7.5.2）。
   * いまは読み出し経路だけを差し替え、同期制約が成り立つことを確かめる。
   */
  private _syncCacheFromIndex(): void {
    // ⚠️ **proxy 越しではなく Y.Map から直接読むこと。**
    // proxy の内部状態が更新される順序に依存すると、目次が消えたときに
    // 古い内容を読んでしまう（実測で確認）
    const pages = this.yDocs;

    // ⚠️ **目次がまだ無いときと、目次が空になったときを区別する。**
    // 前者（初期化前）は「情報が無い」だけなので、未初期化のままにする。
    // 後者で何もしないと、**消えたページが一覧に残り続ける**
    if (!pages) {
      if (this.docMetaCache.isReady) this.docMetaCache.hydrate([]);
      return;
    }

    // ⚠️ 総入れ替えにすること。1件ずつ足すと、目次から消えたページが残る
    this.docMetaCache.hydrate(pages.toJSON() as DocMeta[]);
  }

  private _handleCommonFieldsEvent() {
    this.commonFieldsUpdated.next();
  }

  private _handleDocMetaEvent() {
    const { docMetas, _prevDocs } = this;

    const newDocs = new Set<string>();

    docMetas.forEach(docMeta => {
      if (!_prevDocs.has(docMeta.id)) {
        this.docMetaAdded.next(docMeta.id);
      }
      newDocs.add(docMeta.id);
    });

    _prevDocs.forEach(prevDocId => {
      const isRemoved = newDocs.has(prevDocId) === false;
      if (isRemoved) {
        this.docMetaRemoved.next(prevDocId);
      }
    });

    this._prevDocs = newDocs;

    this.docMetaUpdated.next();
  }

  /**
   * ページを足す。
   *
   * ⚠️ **同期で完了すること。** `createDoc` はこの直後に `getDoc` を呼び、
   * `docMetaAdded` → `blockCollections.set` の**同期連鎖**に依存している
   * （7.5.1 で実験済み。**サーバー先行は採れない**）。
   */
  addDocMeta(doc: DocMeta, index?: number) {
    if (!this._ledgerDriven) {
      this._doc.transact(() => {
        if (!this.docs) {
          return;
        }
        const docs = this.docs as unknown[];
        if (index === undefined) {
          docs.push(doc);
        } else {
          docs.splice(index, 0, doc);
        }
      }, this._doc.clientID);
      return;
    }

    // #151 段階3: **目次には書かない。** 書くと、権限の無い相手にも
    // 題が配信される（共有目次は全メンバーが読める）
    this.docMetaCache.add(doc, index);
    // ⚠️ キャッシュを更新してから知らせる（購読者はその場で読みに来る）
    this._handleDocMetaEvent();
    this._notifyCreated?.(doc.id, doc);
  }

  /** ⚠️ 同期で返すこと（理由は `docMetas` と同じ） */
  getDocMeta(id: string) {
    return this.docMetaCache.get(id);
  }

  initialize() {
    if (!this._proxy.pages) {
      this._proxy.pages = [];
    }
  }

  removeDocMeta(id: string) {
    if (this._ledgerDriven) {
      // #151 段階3: キャッシュから消して、台帳へ知らせる。
      // ⚠️ **キャッシュに無くても台帳へは知らせること。** 取り込みの直後
      // などキャッシュに載っていない瞬間があり、そこで打ち切ると
      // **削除がサーバーへ届かず、全員の一覧に残り続ける**
      if (this.docMetaCache.remove(id)) this._handleDocMetaEvent();
      this._notifyDeleted?.(id);
      return;
    }

    // you cannot delete a doc if there's no doc
    if (!this.docs) {
      return;
    }

    const docMeta = this.docMetas;
    const index = docMeta.findIndex((doc: DocMeta) => id === doc.id);
    if (index === -1) {
      return;
    }
    this._doc.transact(() => {
      if (!this.docs) {
        return;
      }
      this.docs.splice(index, 1);
    }, this._doc.clientID);
  }

  setDocMeta(id: string, props: Partial<DocMeta>) {
    if (this._ledgerDriven) {
      const before = this.docMetaCache.get(id);
      // ⚠️ 台帳に無いページは触らない。作ると**存在しないページが
      // 一覧に出る**
      if (!before) return;

      // ⚠️ **ローカルへ先に反映する**（write-through・7.5.2）。
      // 応答を待つと `createDoc` の同期連鎖が壊れる（7.5.1）
      this.docMetaCache.patch(id, props);
      this._handleDocMetaEvent();
      this._sendToServer?.(id, props, before);
      return;
    }

    const docs = (this.docs as DocMeta[]) ?? [];
    const index = docs.findIndex((doc: DocMeta) => id === doc.id);

    // ⚠️ **送る前の値を控える。** タグの差分（add / remove）と、
    // 移行期間に必要な「利用者が見ていた値」を出すために要る（7.7.4）
    //
    // ⚠️ キャッシュに無いときは目次の現在値を使う。**送信ごと落とさないこと。**
    // 落とすと台帳に届かず、しかも例外も記録も残らないので気づけない
    const before =
      this.docMetaCache.get(id) ??
      (index !== -1 ? ({ ...docs[index] } as DocMeta) : undefined);

    this._doc.transact(() => {
      if (!this.docs) {
        return;
      }
      if (index === -1) return;

      const doc = this.docs[index] as Record<string, unknown>;
      Object.entries(props).forEach(([key, value]) => {
        // #164: tags だけは配列ごと差し替えない
        if (key === 'tags' && Array.isArray(value)) {
          this._applyTags(doc, value as string[]);
          return;
        }
        doc[key] = value;
      });
    }, this._doc.clientID);

    // ⚠️ **ローカルへ反映したあとで送ること。** 応答を待ってから画面を
    // 変えると `createDoc` の同期連鎖が壊れる（7.5.1 で実験済み。
    // **サーバー先行は採れない**）。送信は投げっぱなしにする
    if (index !== -1 && before) {
      this._sendToServer?.(id, props, before);
    }
  }

  /**
   * #151 段階3: **サーバー由来の値を取り込む。送り返さない。**
   *
   * ⚠️ **`setDocMeta` を使ってはいけない。** あちらは送信を伴うため、
   * 受け取った値をそのままサーバーへ送り返し、**堂々巡りになる**。
   * 7.5.9 の原則5（リモート更新を未送信キューへ再登録しない）と同じ話。
   *
   * stale だったときに、サーバーの現在値をローカルへ反映するために使う
   * （7.5.10 の「取ってから捨てる」）。
   */
  applyRemoteDocMeta(id: string, props: Partial<DocMeta>) {
    if (this._ledgerDriven) {
      // ⚠️ **送り返さない。** キャッシュだけを更新する（原則5）
      if (this.docMetaCache.patch(id, props)) this._handleDocMetaEvent();
      return;
    }

    const docs = (this.docs as DocMeta[]) ?? [];
    const index = docs.findIndex((doc: DocMeta) => id === doc.id);
    if (index === -1) return;

    this._doc.transact(() => {
      if (!this.docs) return;
      const doc = this.docs[index] as Record<string, unknown>;
      Object.entries(props).forEach(([key, value]) => {
        if (key === 'tags' && Array.isArray(value)) {
          this._applyTags(doc, value as string[]);
          return;
        }
        doc[key] = value;
      });
    }, this._doc.clientID);
  }

  /**
   * #164: タグを**要素単位**で更新する。
   *
   * ## ⚠️ なぜ `doc.tags = [...]` にしないのか
   *
   * 代入は `native2Y` を通り、**Y.Array ごと新しい実体に差し替わる**
   * （`blocksuite/framework/store/src/reactive/proxy.ts` の set ハンドラ）。
   * その結果 Y.Map のキー競合となり last-writer-wins で片方が丸ごと捨てられる。
   *
   * | 場面 | 差し替え | 要素単位 |
   * |---|---|---|
   * | 2人が別のタグを足す | **一方が消える** | 両方残る |
   * | 一方が外し、他方が足す | **外したはずのタグが復活する** | 正しく消える |
   * | オフライン復帰時の突き合わせ | **変更が消える** | 両方残る |
   *
   * ## 仕様上の許容事項
   *
   * **同一タグの同時追加では一時的に重複が発生し得る。**
   * 独立した2つの挿入はどちらも正当なため、CRDT の性質上これは避けられない。
   * **タグ操作時に重複を除去する**（下の掃除）。
   * **重複によってタグ自体が失われることはない。**
   *
   * ⚠️ 掃除は「2つ目以降を消す」形にすること。収束後は各クライアントの配列が
   * 一致するため同じ要素を指し、同時に掃除しても Yjs が冪等に扱う。
   * 「重複を1つ消す」と書くと、2人が同時に掃除して**両方消える**。
   *
   * ## ⚠️ 集合としてしか扱わない（並べ替えは効かない）
   *
   * 追加・削除だけを見るため、**同じ集合を並べ替えて渡しても何も起きない**。
   * 現在の呼び出し元は追加・削除・複製時のコピーのみで並べ替えが無いため
   * 実害は無いが、**タグの並べ替え UI を足すときはここも直すこと**。
   * そのまま足すと、並べ替えが黙って元に戻る（テストも検知しない）。
   *
   * この操作モデルは #151 段階3（A案）の未送信変更キューでもそのまま使う
   * （`docs/discovery-stage3-comparison.md` 7.5.8）。
   */
  private _applyTags(doc: Record<string, unknown>, next: string[]) {
    const tags = doc.tags;

    // ⚠️ **ここだけは要素単位にできない。** 配列そのものが無いので作るしかなく、
    // Y.Array を作る行為自体が競合する（Y.Map のキー競合 → last-writer-wins）。
    // 空配列を先に置いてから push しても同じで、実測でも片方が消える。
    // これは #151 段階3 の D 案が潰れたのと同じ構造の問題であり、
    // `_applyTags` の中では解決できない。
    //
    // **代わりに「配列が必ず存在する」ことで回避している。**
    // ドキュメント作成時に `addDocMeta` が `tags: []` を入れるため
    // （`impls/workspace.ts:141-147`）、通常このフォールバックには入らない。
    // ⚠️ 作成経路を増やすときは `tags` を必ず初期化すること。
    if (!Array.isArray(tags)) {
      doc.tags = [...new Set(next)];
      return;
    }

    const want = new Set(next);
    const kept = new Set<string>();
    const dropIndexes: number[] = [];

    // ⚠️ 判定は前から行う。**最初の出現を残し、2つ目以降を消す。**
    // 後ろから判定すると最後の出現が残り、並び順が変わる
    for (let i = 0; i < tags.length; i++) {
      const tag = tags[i] as string;
      if (!want.has(tag) || kept.has(tag)) {
        dropIndexes.push(i);
        continue;
      }
      kept.add(tag);
    }

    // ⚠️ 削除は後ろから行う。前から消すと添字がずれる
    for (let i = dropIndexes.length - 1; i >= 0; i--) {
      tags.splice(dropIndexes[i], 1);
    }

    const added = [...want].filter(tag => !kept.has(tag));
    if (added.length > 0) {
      tags.push(...added);
    }
  }
}

/**
 * #151 段階3: 変更をサーバーへ送る。
 *
 * ⚠️ **ローカルへ反映したあとに呼ばれる。** ここで待たせないこと
 * （`createDoc` の同期連鎖が壊れる・7.5.1）。
 *
 * @param before 変更前のメタ。タグの差分と、移行期間に必要な
 *   「利用者が見ていた値」を出すために要る（7.7.4）
 */
export type DocMetaWriteSender = (
  id: string,
  props: Partial<DocMeta>,
  before: DocMeta
) => void;

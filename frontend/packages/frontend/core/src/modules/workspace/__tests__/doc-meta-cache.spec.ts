import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';

import { DocMetaCache } from '../impls/doc-meta-cache';
import { WorkspaceMetaImpl } from '../impls/meta';

/**
 * #151 段階3: Discovery Metadata の**同期**キャッシュ。
 *
 * ⚠️ ここが崩れると「表示が遅れる」ではなく、
 * **ドキュメントが存在しなくなる**（7.5.3）。
 *
 * 詳細は docs/discovery-stage3-comparison.md 7.3 / 7.5
 */
describe('#151 段階3 同期キャッシュ', () => {
  describe('キャッシュ単体', () => {
    const meta = (id: string, over: Record<string, unknown> = {}) => ({
      id,
      title: `題-${id}`,
      tags: [] as string[],
      createDate: 0,
      ...over,
    });

    test('取得前は未初期化', () => {
      expect(new DocMetaCache().isReady).toBe(false);
    });

    test('総入れ替えで初期化完了になる', () => {
      const c = new DocMetaCache();
      c.hydrate([meta('a'), meta('b')]);
      expect(c.isReady).toBe(true);
      expect(c.list().map(m => m.id)).toEqual(['a', 'b']);
    });

    /**
     * ⚠️ 1件ずつ足す形にすると、**目次から消えたページが残る**。
     */
    test('総入れ替えなので、前の内容は残らない', () => {
      const c = new DocMetaCache();
      c.hydrate([meta('a'), meta('b')]);
      c.hydrate([meta('a')]);
      expect(c.list().map(m => m.id)).toEqual(['a']);
    });

    test('1件を差し替えられる', () => {
      const c = new DocMetaCache();
      c.hydrate([meta('a')]);
      expect(c.replace({ ...meta('a'), title: '新しい題' })).toBe(true);
      expect(c.get('a')?.title).toBe('新しい題');
    });

    /**
     * ⚠️ **混ぜ合わせにしないこと。**
     *
     * 目次からフィールドごと消された場合、その項目は渡される内容に
     * 含まれない。混ぜると**消えたはずの値が残り続ける**。
     */
    test('⚠️ 差し替えなので、渡されなかった項目は消える', () => {
      const c = new DocMetaCache();
      c.hydrate([meta('a', { trash: true })]);

      // trash を持たない内容で差し替える（目次から消された状況）
      c.replace(meta('a'));

      expect(c.get('a')?.trash).toBeUndefined();
    });

    /**
     * ⚠️ false を返したら、呼び出し側は作り直すこと。
     * 捨てると**その変更が反映されないまま残る**。
     */
    test('⚠️ 無いものは差し替えず、false を返す', () => {
      const c = new DocMetaCache();
      c.hydrate([]);
      expect(c.replace(meta('x'))).toBe(false);
      expect(c.get('x')).toBeUndefined();
    });
  });

  /**
   * #151 段階3: **初期化完了の定義**（7.5.5）。
   *
   * ⚠️ 「API が返った」ではなく「**キャッシュへ投入され、読める状態に
   * なった**」を指す。この2つは別である。
   *
   * ここが崩れると、台帳が空のまま画面が出て
   * `root-block-model.ts:20` が**本文の題をサーバーの題で上書きする**（7.3）。
   */
  describe('初期化完了の定義', () => {
    const meta = (id: string) => ({
      id,
      title: `題-${id}`,
      tags: [] as string[],
      createDate: 0,
    });

    test('⚠️ 投入されるまでは未完了（空でも「完了」にしない）', () => {
      const c = new DocMetaCache();
      expect(c.isReady).toBe(false);
      expect(c.list()).toEqual([]);
    });

    test('投入されたら完了になり、同期で読める', () => {
      const c = new DocMetaCache();
      c.hydrate([meta('a')]);

      expect(c.isReady).toBe(true);
      expect(c.get('a')).not.toBeInstanceOf(Promise);
      expect(c.get('a')?.title).toBe('題-a');
    });

    /**
     * ⚠️ **0件の投入と、未投入を区別すること。**
     * 「ドキュメントが1件も無いワークスペース」は正常な状態であり、
     * 未完了として待ち続けてはいけない。
     */
    test('⚠️ 0件でも、投入されたなら完了とみなす', () => {
      const c = new DocMetaCache();
      c.hydrate([]);
      expect(c.isReady).toBe(true);
    });
  });

  describe('WorkspaceMetaImpl との結線', () => {
    const makeMeta = () => {
      const doc = new Y.Doc();
      const meta = new WorkspaceMetaImpl(doc);
      meta.initialize();
      return { doc, meta };
    };

    test('目次に足すと、キャッシュから読める', () => {
      const { meta } = makeMeta();
      meta.addDocMeta({ id: 'a', title: 'あ', tags: [], createDate: 0 });

      expect(meta.getDocMeta('a')?.title).toBe('あ');
      expect(meta.docMetas.map(m => m.id)).toEqual(['a']);
    });

    /**
     * ⚠️ **これが 7.3 の制約そのもの。**
     *
     * `WorkspaceMeta` の宣言は `Promise` を許さない。
     * `root-block-model.ts` は「読んでから書く」ため、ここが同期で
     * 引けないと**ドキュメントを開くたびに本文の題が上書きされる**。
     */
    test('⚠️ 読み出しが同期である（Promise を返さない）', () => {
      const { meta } = makeMeta();
      meta.addDocMeta({ id: 'a', title: 'あ', tags: [], createDate: 0 });

      expect(meta.getDocMeta('a')).not.toBeInstanceOf(Promise);
      expect(meta.docMetas).not.toBeInstanceOf(Promise);
    });

    /**
     * ⚠️ **通知より先にキャッシュを更新すること。**
     *
     * 購読者は通知を受けた直後に読みに来る（`workspace.ts:93` は
     * その場で `DocImpl` を作る）。順序が逆だと、
     * **作られた直後のドキュメントのメタを引けない**。
     * これは 7.5.1 で実証した「同期連鎖」の要件。
     */
    test('⚠️ docMetaAdded を受け取った時点で、もう読める', () => {
      const { meta } = makeMeta();
      const seen: (string | undefined)[] = [];
      meta.docMetaAdded.subscribe(id => {
        seen.push(meta.getDocMeta(id)?.title);
      });

      meta.addDocMeta({ id: 'a', title: 'あ', tags: [], createDate: 0 });

      expect(seen).toEqual(['あ']);
    });

    /**
     * ⚠️ **「目次がまだ無い」と「目次が空になった」を区別すること。**
     *
     * 前者は初期化前で「情報が無い」だけ。後者で何もしないと、
     * **消えたページが一覧に残り続ける**。
     */
    test('⚠️ 目次が空になったら、キャッシュも空になる', () => {
      const { doc, meta } = makeMeta();
      meta.addDocMeta({ id: 'a', title: 'あ', tags: [], createDate: 0 });
      expect(meta.docMetas).toHaveLength(1);

      // 目次そのものを取り去る（pages が undefined になる）
      doc.getMap('meta').delete('pages');

      expect(meta.docMetas).toEqual([]);
      expect(meta.getDocMeta('a')).toBeUndefined();
    });

    test('目次がまだ無い時点では、未初期化のまま', () => {
      const doc = new Y.Doc();
      const meta = new WorkspaceMetaImpl(doc); // initialize していない
      expect(meta.docMetaCache.isReady).toBe(false);
    });

    /**
     * ⚠️ **目次と無関係な変更で全ページを作り直さないこと。**
     *
     * `meta` 直下には `properties`（タグの選択肢）・`name`・`avatar` も
     * ある。除外しないと、タグの選択肢をいじるたびに全ページを作り直す。
     *
     * ⚠️ ただし**除外しすぎて必要な更新を落とさないこと**。
     * ページの増減（`pages` キーの変更）は必ず拾う。
     */
    test('⚠️ タグの選択肢を変えても、ページのメタは保たれる', () => {
      const { meta } = makeMeta();
      meta.addDocMeta({ id: 'a', title: 'あ', tags: ['x'], createDate: 0 });

      meta.setProperties({ tags: { options: [{ id: 'x', value: 'X', color: 'red' }] } });

      expect(meta.getDocMeta('a')?.title).toBe('あ');
      expect(meta.getDocMeta('a')?.tags).toEqual(['x']);
    });

    test('⚠️ ワークスペース名を変えても、ページのメタは保たれる', () => {
      const { meta } = makeMeta();
      meta.addDocMeta({ id: 'a', title: 'あ', tags: [], createDate: 0 });

      meta.setName('新しい名前');

      expect(meta.getDocMeta('a')?.title).toBe('あ');
    });

    /**
     * ⚠️ **送信に渡す `before` が「変更前」であること。**
     *
     * キャッシュの値が Yjs の生きた参照だと、`transact` の中で書き換わり
     * **before == after になって何も送られない**（送信が黙って死ぬ）。
     */
    test('⚠️ 送信には「変更前」の値が渡る', () => {
      const doc = new Y.Doc();
      const seen: Array<{ before: string; after?: string }> = [];
      const meta = new WorkspaceMetaImpl(doc, undefined, (_id, props, before) => {
        seen.push({ before: before.title, after: props.title });
      });
      meta.initialize();
      meta.addDocMeta({ id: 'a', title: '元の題', tags: [], createDate: 0 });

      meta.setDocMeta('a', { title: '新しい題' });

      expect(seen).toEqual([{ before: '元の題', after: '新しい題' }]);
    });

    /**
     * ⚠️ **台帳が正のときは、目次を当てにしないこと**（#151 段階3・PR5）。
     *
     * 以前は「キャッシュに無ければ目次の現在値を使って送る」としていた。
     * 段階3 では**その退避経路こそが漏洩源**になる。
     *
     * ```
     * 目次   権限外のページも含めて、全メンバーへ配信されている
     * 台帳   その利用者が見てよいページだけ
     *        ↓ キャッシュ（＝台帳）に無いページを目次から拾うと
     * 結果   見えてはいけないページのメタを、書き込みとして送ってしまう
     * ```
     *
     * キャッシュに無い ＝ **そのページは存在しない（か、見てはいけない）**。
     */
    test('⚠️ 台帳に無いページには送らない（目次を当てにしない）', () => {
      const doc = new Y.Doc();
      const first = new WorkspaceMetaImpl(doc);
      first.initialize();
      first.addDocMeta({ id: 'a', title: '元の題', tags: [], createDate: 0 });

      // 目次を共有する別インスタンスを、台帳が正の形で作る
      const seen: string[] = [];
      const second = new WorkspaceMetaImpl(
        doc,
        undefined,
        (id) => {
          seen.push(id);
        },
        undefined,
        undefined,
        // ⚠️ 台帳が正のワークスペース（サーバーあり）として作る
        true
      );
      second.docMetaCache.hydrate([]); // 台帳は「見てよいページ 0 件」

      second.setDocMeta('a', { title: '新しい題' });

      expect(seen).toEqual([]);
    });

    /**
     * ⚠️ **サーバー由来の値を取り込んでも、送り返さないこと。**
     *
     * `setDocMeta` を使うと送信を伴い、受け取った値をそのまま
     * サーバーへ送り返して**堂々巡りになる**（7.5.9 の原則5）。
     */
    test('⚠️ リモート由来の取り込みは、サーバーへ送り返さない', () => {
      const doc = new Y.Doc();
      const sent: string[] = [];
      const meta = new WorkspaceMetaImpl(doc, undefined, id => {
        sent.push(id);
      });
      meta.initialize();
      meta.addDocMeta({ id: 'a', title: '元の題', tags: [], createDate: 0 });
      sent.length = 0; // 作成時の送信は数えない

      meta.applyRemoteDocMeta('a', { title: 'サーバーの題' });

      expect(meta.getDocMeta('a')?.title).toBe('サーバーの題');
      expect(sent).toEqual([]); // ⚠️ 送っていないこと
    });

    test('通常の変更は、これまでどおり送る', () => {
      const doc = new Y.Doc();
      const sent: string[] = [];
      const meta = new WorkspaceMetaImpl(doc, undefined, id => {
        sent.push(id);
      });
      meta.initialize();
      meta.addDocMeta({ id: 'a', title: '元の題', tags: [], createDate: 0 });
      sent.length = 0;

      meta.setDocMeta('a', { title: '新しい題' });

      expect(sent).toEqual(['a']);
    });

    test('目次から消すと、キャッシュからも消える', () => {
      const { meta } = makeMeta();
      meta.addDocMeta({ id: 'a', title: 'あ', tags: [], createDate: 0 });
      meta.removeDocMeta('a');

      expect(meta.getDocMeta('a')).toBeUndefined();
      expect(meta.docMetas).toEqual([]);
    });

    /**
     * ⚠️ **タグはページの中の Y.Array で変わる。**
     *
     * `e.target.parent === yDocs` という通知の条件に当てはまらないため、
     * そこだけを見ていると**タグの変更が一覧に出ない**。
     * 実装で一度これを踏んだので、検査で固定する。
     */
    test('⚠️ タグを変えると、キャッシュにも反映される（入れ子の変更）', () => {
      const { meta } = makeMeta();
      meta.addDocMeta({ id: 'a', title: 'あ', tags: ['x'], createDate: 0 });

      meta.setDocMeta('a', { tags: ['x', 'z'] });
      expect(meta.getDocMeta('a')?.tags).toEqual(['x', 'z']);

      meta.setDocMeta('a', { tags: [] });
      expect(meta.getDocMeta('a')?.tags).toEqual([]);
    });

    /**
     * ⚠️ 返す値は**その時点の写し**であること。
     * 以前は proxy への参照が混ざっており、「あとから勝手に変わる」値を
     * 返していた。読み手が同じ配列を握り続けると、いつの状態か分からなくなる。
     */
    test('⚠️ 返した値は、あとからの変更で書き換わらない', () => {
      const { meta } = makeMeta();
      meta.addDocMeta({ id: 'a', title: 'あ', tags: ['x'], createDate: 0 });

      const before = meta.getDocMeta('a');
      meta.setDocMeta('a', { tags: ['x', 'z'] });

      expect(before?.tags).toEqual(['x']);
      expect(meta.getDocMeta('a')?.tags).toEqual(['x', 'z']);
    });

    test('題を変えると、キャッシュにも反映される', () => {
      const { meta } = makeMeta();
      meta.addDocMeta({ id: 'a', title: 'あ', tags: [], createDate: 0 });
      meta.setDocMeta('a', { title: '改名後' });

      expect(meta.getDocMeta('a')?.title).toBe('改名後');
    });

    test('他の利用者の変更が同期されると、キャッシュにも反映される', () => {
      const { doc, meta } = makeMeta();
      meta.addDocMeta({ id: 'a', title: 'あ', tags: [], createDate: 0 });

      // 別クライアントで題を変えて同期させる
      const other = new Y.Doc();
      Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
      const otherMeta = new WorkspaceMetaImpl(other);
      otherMeta.setDocMeta('a', { title: '他人が変えた題' });
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));

      expect(meta.getDocMeta('a')?.title).toBe('他人が変えた題');
    });

    /**
     * ⚠️ この段階（PR2a）では、**まだサーバー台帳が正ではない**。
     * 値は Yjs 目次が駆動しており、キャッシュはその写し。
     * サーバーを正にするのは write-through を入れる次の段階（7.5.2）。
     */
    test('初期化時に、目次の既存内容を取り込む', () => {
      const doc = new Y.Doc();
      const first = new WorkspaceMetaImpl(doc);
      first.initialize();
      first.addDocMeta({ id: 'a', title: 'あ', tags: [], createDate: 0 });

      // あとから同じ Y.Doc に対して作り直しても読める
      const second = new WorkspaceMetaImpl(doc);
      expect(second.getDocMeta('a')?.title).toBe('あ');
    });
  });
});

import { beforeEach, describe, expect, test, vi } from 'vitest';

import { IndexerSyncImpl } from '../index';

// ⚠️ 本文の解析は BlockSuite を丸ごと引き込む（vitest が起動しない）。
// ここで試すのは「どれを索引の対象にするか」なので、解析は差し替える
vi.mock('../crawler', () => ({
  crawlingDocData: async () => ({ addedBlocks: [], deletedBlockIds: [] }),
}));

/**
 * #199: **索引の対象を「認可済み台帳」に合わせる。**
 *
 * ⚠️ ここで守っているのは、**壊れてもエラーが出ない**性質のもの。
 *
 * 索引の対象は共有目次から取られていたが、#151 段階3 で目次を空にしたため
 * 対象が0件になり、`@` メニューが**常に0件**になっていた。
 *
 * ⚠️ そして本件の急所は**削除側**。対象だけ台帳に替えて削除条件を目次のまま
 * 残すと、**権限を剥奪したページが手元の索引に残って検索に出る**。
 *
 * 詳細は docs/client-indexer.md
 */
describe('索引の対象は認可済み台帳（#199）', () => {
  const WS = 'ws-1';

  /** 索引に入っているものを、素朴な Map で持つ偽の索引 */
  const makeIndexer = () => {
    const docs = new Map<string, { title: string | undefined }>();
    const blocks = new Set<string>();
    return {
      docs,
      blocks,
      isReadonly: false,
      connection: { waitForConnected: async () => {} },
      indexVersion: async () => 1,
      refreshIfNeed: async () => {},
      recommendRefreshInterval: 0,
      insert: async (table: string, doc: any) => {
        if (table !== 'doc') return;
        docs.set(doc.id, { title: doc.get('title') });
      },
      update: async (table: string, doc: any) => {
        if (table !== 'doc') return;
        docs.set(doc.id, { title: doc.get('title') });
      },
      delete: async (_table: string, id: string) => {
        docs.delete(id);
      },
      deleteByQuery: async (_table: string, query: any) => {
        blocks.delete(query.match);
      },
      search: async () => ({
        nodes: [...docs.entries()].map(([id, { title }]) => ({
          id,
          fields: { docId: id, title },
        })),
      }),
    };
  };

  const make = () => {
    const indexer = makeIndexer();

    const doc: any = {
      spaceId: WS,
      connection: { waitForConnected: async () => {} },
      subscribeDocUpdate: () => () => {},
      // ⚠️ 本文は空。ここで試すのは「どれを索引の対象にするか」だけ
      getDoc: async () => null,
      getDocTimestamp: vi.fn(async () => null),
    };

    const indexerSync: any = {
      connection: { waitForConnected: async () => {} },
      getDocIndexedClock: async () => null,
      setDocIndexedClock: async () => {},
      clearDocIndexedClock: vi.fn(async () => {}),
    };

    const sync = new IndexerSyncImpl(
      doc,
      { local: indexer as any, remotes: {} } as any,
      indexerSync
    );
    return { sync, indexer, indexerSync, doc };
  };

  /** 索引が落ち着くまで待つ（job は非同期に流れる） */
  const settle = async () => {
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  };

  let ctx: ReturnType<typeof make>;

  beforeEach(() => {
    ctx = make();
  });

  /**
   * ⚠️ **これが #199 の症状そのもの。** 一覧が来ないうちに
   * 共有目次を見に行くと0件になる。だから**何もしない**のが正しい。
   */
  test('⚠️ 一覧が渡されるまで、何も索引しない', async () => {
    ctx.sync.start();
    await settle();

    expect(ctx.indexer.docs.size).toBe(0);

    ctx.sync.stop();
  });

  test('一覧に載っているページを索引する', async () => {
    ctx.sync.start();
    ctx.sync.setDocList([
      { docId: 'doc-1', title: 'はじめに' },
      { docId: 'doc-2', title: '議事録' },
    ]);
    await settle();

    expect([...ctx.indexer.docs.keys()].sort()).toEqual(['doc-1', 'doc-2']);
    expect(ctx.indexer.docs.get('doc-1')?.title).toBe('はじめに');

    ctx.sync.stop();
  });

  /**
   * ⚠️ **本件の急所。** 台帳から消えたら索引からも消す。
   * 「削除された」と「権限を剥奪された」を区別しない——
   * どちらも検索の対象から外すのが安全側。
   */
  test('⚠️ 一覧から消えたページは、索引からも消える（権限剥奪）', async () => {
    ctx.sync.start();
    ctx.sync.setDocList([
      { docId: 'doc-1', title: 'はじめに' },
      { docId: 'secret', title: '人事評価' },
    ]);
    await settle();
    expect(ctx.indexer.docs.has('secret')).toBe(true);

    // 権限を剥奪された → 台帳から消える
    ctx.sync.setDocList([{ docId: 'doc-1', title: 'はじめに' }]);
    await settle();

    expect(ctx.indexer.docs.has('secret')).toBe(false);
    // ⚠️ 本文（ブロック）と索引済みの記録も消すこと。
    // 残すと題は消えても**本文が検索に出る**
    expect(ctx.indexerSync.clearDocIndexedClock).toHaveBeenCalledWith('secret');

    ctx.sync.stop();
  });

  /**
   * ⚠️ 題は本文より先に要る。索引側は**題の変化で再索引を判断する**ため、
   * 一覧に題が無いと題だけ変えたページが検索に反映されない。
   */
  test('題が変わったら索引の題も変わる', async () => {
    ctx.sync.start();
    ctx.sync.setDocList([{ docId: 'doc-1', title: '旧題' }]);
    await settle();

    ctx.sync.setDocList([{ docId: 'doc-1', title: '新題' }]);
    await settle();

    expect(ctx.indexer.docs.get('doc-1')?.title).toBe('新題');

    ctx.sync.stop();
  });

  /**
   * ⚠️ 一覧は台帳を取り直すたびに届き、取り直しは**誰かが題を打つたびに**起きる。
   * 毎回すべて積むと、**ページ数 × 接続人数**の空振りが打鍵ごとに走る。
   */
  test('⚠️ 変わっていないページは、積み直さない', async () => {
    ctx.sync.start();
    ctx.sync.setDocList([
      { docId: 'doc-1', title: 'はじめに' },
      { docId: 'doc-2', title: '議事録' },
    ]);
    await settle();

    ctx.doc.getDocTimestamp.mockClear();

    // 同じ一覧がもう一度届く（題を打った誰かのせいで台帳を取り直した）
    ctx.sync.setDocList([
      { docId: 'doc-1', title: 'はじめに' },
      { docId: 'doc-2', title: '議事録' },
    ]);
    await settle();

    expect(ctx.doc.getDocTimestamp).not.toHaveBeenCalled();

    // ⚠️ 1件だけ題が変われば、その1件だけ積む
    ctx.sync.setDocList([
      { docId: 'doc-1', title: '新題' },
      { docId: 'doc-2', title: '議事録' },
    ]);
    await settle();

    const crawled = ctx.doc.getDocTimestamp.mock.calls.map((c: any[]) => c[0]);
    expect(crawled).toEqual(['doc-1']);

    ctx.sync.stop();
  });

  test('空の一覧は「1件も認可されていない」として扱う', async () => {
    ctx.sync.start();
    ctx.sync.setDocList([{ docId: 'doc-1', title: 'はじめに' }]);
    await settle();

    ctx.sync.setDocList([]);
    await settle();

    expect(ctx.indexer.docs.size).toBe(0);

    ctx.sync.stop();
  });
});

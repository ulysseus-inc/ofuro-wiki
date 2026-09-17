import * as Y from 'yjs';
import { IndexReaderService } from '../../../src/modules/discovery/index-reader.service';
import type { PrismaService } from '../../../src/prisma.service';

/**
 * #151: **共有目次を読む。**
 *
 * ⚠️ ここで守っているのは、**壊れ方が無言**な性質のもの。
 * 読み損ねたページは例外にならず、ただ**点検の対象から静かに消える**。
 *
 * `DocMetaSyncService`（目次を台帳へ写していた）を撤去したとき、
 * 読み取りの検査だけをこちらへ移した（7.7.5）。
 */
describe('共有目次の読み取り', () => {
  const WS = 'ws-1';

  /** 目次（rootYDoc）を作り、更新バイト列にして返す。 */
  const makeIndex = (
    entries: Array<{
      id: string;
      title?: string;
      tags?: string[];
      trash?: boolean;
      createDate?: number;
      updatedDate?: number;
    }>,
  ): Uint8Array => {
    const doc = new Y.Doc();
    const pages = new Y.Array<Y.Map<unknown>>();
    doc.getMap('meta').set('pages', pages);
    for (const e of entries) {
      const m = new Y.Map<unknown>();
      m.set('id', e.id);
      if (e.title !== undefined) m.set('title', e.title);
      if (e.tags !== undefined) m.set('tags', e.tags);
      if (e.trash !== undefined) m.set('trash', e.trash);
      if (e.createDate !== undefined) m.set('createDate', e.createDate);
      if (e.updatedDate !== undefined) m.set('updatedDate', e.updatedDate);
      pages.push([m]);
    }
    return Y.encodeStateAsUpdate(doc);
  };

  const makeService = (index: Uint8Array | null) => {
    const prisma = {
      docSnapshot: {
        findUnique: jest
          .fn()
          .mockResolvedValue(index ? { blob: Buffer.from(index) } : null),
      },
      docUpdate: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return new IndexReaderService(prisma as unknown as PrismaService);
  };

  test('目次の項目を読み出す', async () => {
    const service = makeService(
      makeIndex([{ id: 'a', title: 'あ', tags: ['t1', 't2'], trash: true }]),
    );

    const pages = await service.readIndex(WS);

    expect(pages).toHaveLength(1);
    expect(pages![0]).toMatchObject({
      id: 'a',
      title: 'あ',
      tags: ['t1', 't2'],
      trash: true,
    });
  });

  /**
   * ⚠️ Yjs の配列には `Y.Map` 以外も入る。`entry.get(...)` だけで読むと
   * id を取れず、**そのページが黙って読み飛ばされる**。
   */
  test('⚠️ 素のオブジェクトの項目も読む（読み飛ばすとページが黙って消える）', async () => {
    const doc = new Y.Doc();
    const pages = new Y.Array<unknown>();
    doc.getMap('meta').set('pages', pages);
    pages.push([{ id: 'plain', title: '素のオブジェクト', tags: ['t1'] }]);
    const service = makeService(Y.encodeStateAsUpdate(doc));

    const out = await service.readIndex(WS);

    expect(out).toHaveLength(1);
    expect(out![0]).toMatchObject({
      id: 'plain',
      title: '素のオブジェクト',
      tags: ['t1'],
    });
  });

  test('id の無い項目は読み飛ばす（壊れた目次で落ちない）', async () => {
    const service = makeService(makeIndex([{ id: '' }, { id: 'a', title: 'あ' }]));

    const out = await service.readIndex(WS);

    expect(out).toHaveLength(1);
    expect(out![0].id).toBe('a');
  });

  test('題が無ければ null（空文字と区別する）', async () => {
    const service = makeService(makeIndex([{ id: 'a' }]));

    const out = await service.readIndex(WS);

    expect(out![0].title).toBeNull();
  });

  /**
   * ⚠️ タグは `Y.Array` のことも素の配列のこともある。
   * 取り違えると、点検が**常に「食い違い」と数える**（7.8 の `sameTags`）。
   */
  test('⚠️ タグが Y.Array でも読める', async () => {
    const doc = new Y.Doc();
    const pages = new Y.Array<Y.Map<unknown>>();
    doc.getMap('meta').set('pages', pages);
    const m = new Y.Map<unknown>();
    m.set('id', 'a');
    const tags = new Y.Array<string>();
    tags.push(['t1', 't2']);
    m.set('tags', tags);
    pages.push([m]);
    const service = makeService(Y.encodeStateAsUpdate(doc));

    const out = await service.readIndex(WS);

    expect(out![0].tags).toEqual(['t1', 't2']);
  });

  test('目次が無いワークスペースでは null を返す', async () => {
    const service = makeService(null);

    expect(await service.readIndex(WS)).toBeNull();
  });

  /** ⚠️ 段階3 のあとの本番がこの形。**空と「無い」を区別する** */
  test('⚠️ 目次が空なら、空の配列を返す（null ではない）', async () => {
    const service = makeService(makeIndex([]));

    expect(await service.readIndex(WS)).toEqual([]);
  });
});

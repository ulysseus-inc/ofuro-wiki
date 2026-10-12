import * as Y from 'yjs';
import { IndexerService } from '../../../src/modules/search/indexer.service';
import type { PrismaService } from '../../../src/prisma.service';

/**
 * #256: ⚠️ **ページの骨組み（affine:page）が無いページを、ログで知らせる。**
 *
 * 骨組みが消えるとページが開けなくなる。本文は更新履歴に残っていて復旧できるが、
 * 誰も気づかなければ復旧もされない（テレメトリは無効）。
 * 索引の作り直しでページを組み立て直すので、そこで骨組みの有無を見る。
 *
 * ⚠️ 条件は「骨組みが無い」に限る。本文が空なのは正常な操作でも起きる。
 */
describe('骨組みの無いページの検知（#256）', () => {
  const WS = 'ws-1';

  /** ブロックを組み立てて、Yjs の更新にする。 */
  const buildUpdate = (build: (blocks: Y.Map<Y.Map<unknown>>) => void) => {
    const doc = new Y.Doc();
    build(doc.getMap<Y.Map<unknown>>('blocks'));
    return Buffer.from(Y.encodeStateAsUpdate(doc));
  };

  const addBlock = (
    blocks: Y.Map<Y.Map<unknown>>,
    id: string,
    flavour: string,
    props: Record<string, unknown> = {},
  ) => {
    const block = new Y.Map<unknown>();
    blocks.set(id, block);
    block.set('sys:id', id);
    block.set('sys:flavour', flavour);
    block.set('sys:children', new Y.Array<string>());
    for (const [key, value] of Object.entries(props)) {
      block.set(key, value);
    }
  };

  const make = (blobs: Buffer[]) => {
    const prisma = {
      docSnapshot: { findUnique: jest.fn().mockResolvedValue(null) },
      docUpdate: {
        findMany: jest.fn().mockResolvedValue(blobs.map(blob => ({ blob }))),
      },
      searchIndex: {
        deleteMany: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new IndexerService(prisma as unknown as PrismaService);
    const warn = jest
      .spyOn((service as unknown as { logger: { warn: () => void } }).logger, 'warn')
      .mockImplementation(() => undefined);
    return { service, warn };
  };

  const rootlessWarnings = (warn: jest.SpyInstance) =>
    warn.mock.calls.filter(([message]) => String(message).includes('affine:page'));

  it('⚠️ 骨組みが無いページは警告する（ID だけを書く）', async () => {
    const { service, warn } = make([
      buildUpdate(blocks => {
        addBlock(blocks, 'note', 'affine:note');
        addBlock(blocks, 'p', 'affine:paragraph', {
          'prop:text': new Y.Text('本文の秘密'),
        });
      }),
    ]);

    await service.indexDocument(WS, 'doc-a');

    const calls = rootlessWarnings(warn);
    expect(calls).toHaveLength(1);
    expect(String(calls[0][0])).toContain(`${WS}/doc-a`);
    // 本文はログに書かない
    expect(String(calls[0][0])).not.toContain('本文の秘密');
  });

  it('⚠️ 骨組みが後から消されたページも警告する', async () => {
    const doc = new Y.Doc();
    const blocks = doc.getMap<Y.Map<unknown>>('blocks');
    addBlock(blocks, 'page', 'affine:page', { 'prop:title': new Y.Text('題') });
    const created = Buffer.from(Y.encodeStateAsUpdate(doc));
    const before = Y.encodeStateVector(doc);
    blocks.delete('page');
    const deleted = Buffer.from(Y.encodeStateAsUpdate(doc, before));

    const { service, warn } = make([created, deleted]);

    await service.indexDocument(WS, 'doc-b');

    expect(rootlessWarnings(warn)).toHaveLength(1);
  });

  it('本文が空でも、骨組みがあれば警告しない', async () => {
    const { service, warn } = make([
      buildUpdate(blocks => {
        addBlock(blocks, 'page', 'affine:page', { 'prop:title': new Y.Text('') });
        addBlock(blocks, 'note', 'affine:note');
      }),
    ]);

    await service.indexDocument(WS, 'doc-c');

    expect(rootlessWarnings(warn)).toHaveLength(0);
  });

  it('利用者のページでないもの（目次・フォルダ）は対象外', async () => {
    const notPage = buildUpdate(blocks => {
      addBlock(blocks, 'x', 'affine:note');
    });

    for (const docId of [WS, `db$${WS}$folders`]) {
      const { service, warn } = make([notPage]);
      await service.indexDocument(WS, docId);
      expect(rootlessWarnings(warn)).toHaveLength(0);
    }
  });

  it('ブロックに触れていない更新だけのページは警告しない', async () => {
    const doc = new Y.Doc();
    doc.getMap('meta').set('note', 'ブロック以外の更新');
    const { service, warn } = make([Buffer.from(Y.encodeStateAsUpdate(doc))]);

    await service.indexDocument(WS, 'doc-e');

    expect(rootlessWarnings(warn)).toHaveLength(0);
  });

  it('⚠️ ブロックが全部消えたページは警告する（2026-06-21 本番の実例）', async () => {
    const doc = new Y.Doc();
    const blocks = doc.getMap<Y.Map<unknown>>('blocks');
    addBlock(blocks, 'page', 'affine:page', { 'prop:title': new Y.Text('題') });
    addBlock(blocks, 'note', 'affine:note');
    const created = Buffer.from(Y.encodeStateAsUpdate(doc));
    const before = Y.encodeStateVector(doc);
    blocks.delete('page');
    blocks.delete('note');
    const deleted = Buffer.from(Y.encodeStateAsUpdate(doc, before));

    const { service, warn } = make([created, deleted]);

    await service.indexDocument(WS, 'doc-f');

    expect(rootlessWarnings(warn)).toHaveLength(1);
  });

  it('同じページは、何度作り直しても1回だけ警告する', async () => {
    const { service, warn } = make([
      buildUpdate(blocks => {
        addBlock(blocks, 'note', 'affine:note');
      }),
    ]);

    await service.indexDocument(WS, 'doc-g');
    await service.indexDocument(WS, 'doc-g');
    await service.indexDocument(WS, 'doc-g');

    expect(rootlessWarnings(warn)).toHaveLength(1);
  });

  it('保存された中身が無いページは警告しない', async () => {
    const { service, warn } = make([]);

    await service.indexDocument(WS, 'doc-d');

    expect(rootlessWarnings(warn)).toHaveLength(0);
  });
});

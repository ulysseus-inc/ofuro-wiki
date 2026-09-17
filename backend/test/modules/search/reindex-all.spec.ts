import { IndexerService } from '../../../src/modules/search/indexer.service';
import type { PrismaService } from '../../../src/prisma.service';

/**
 * #101: ⚠️ **作り直しは、スナップショットの無いページも対象にする。**
 *
 * スナップショットは更新50回ごとにしか作られない。
 * スナップショットだけを見ると、**それ未満のページが丸ごと漏れる**
 * （開発DB実測: スナップショットあり37 / 更新ログのみ644・2026-09-17）。
 */
describe('ワークスペースの索引の作り直し（#101）', () => {
  const WS = 'ws-1';

  const make = (opts: { snapshots: string[]; updates: string[] }) => {
    const indexed: string[] = [];
    const prisma = {
      docSnapshot: {
        findMany: jest
          .fn()
          .mockResolvedValue(opts.snapshots.map(docId => ({ docId }))),
      },
      docUpdate: {
        findMany: jest
          .fn()
          .mockResolvedValue(opts.updates.map(docId => ({ docId }))),
      },
    };
    const service = new IndexerService(prisma as unknown as PrismaService);
    jest
      .spyOn(service, 'indexDocument')
      .mockImplementation(async (_ws: string, docId: string) => {
        indexed.push(docId);
      });
    return { service, indexed, prisma };
  };

  it('⚠️ スナップショットの無いページも作り直す', async () => {
    const { service, indexed } = make({
      snapshots: ['doc-a'],
      updates: ['doc-b', 'doc-c'],
    });

    await service.indexAllDocuments(WS);

    expect(indexed.sort()).toEqual(['doc-a', 'doc-b', 'doc-c']);
  });

  it('両方にあるページは1回だけ作り直す', async () => {
    const { service, indexed } = make({
      snapshots: ['doc-a'],
      updates: ['doc-a', 'doc-b'],
    });

    await service.indexAllDocuments(WS);

    expect(indexed.filter(id => id === 'doc-a')).toHaveLength(1);
    expect(indexed.sort()).toEqual(['doc-a', 'doc-b']);
  });

  it('1件失敗しても、残りは作り直す', async () => {
    const { service, indexed } = make({
      snapshots: ['doc-a', 'doc-b'],
      updates: [],
    });
    jest
      .spyOn(service, 'indexDocument')
      .mockImplementation(async (_ws: string, docId: string) => {
        if (docId === 'doc-a') throw new Error('壊れたページ');
        indexed.push(docId);
      });

    await service.indexAllDocuments(WS);

    expect(indexed).toEqual(['doc-b']);
  });
});

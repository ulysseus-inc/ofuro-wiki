import { SearchIndexQueueService } from '../../../src/modules/search/search-index-queue.service';
import type { PrismaService } from '../../../src/prisma.service';
import type { IndexerService } from '../../../src/modules/search/indexer.service';

/**
 * #101: ⚠️ **索引の作り直しは、取りこぼしてはいけない。**
 *
 * 本文の保存と同一トランザクションで印（pending_generation）を立て、
 * 静まってから作り直す。詳細は docs/search-index.md 5章。
 *
 * | 起きたこと | 期待 |
 * |---|---|
 * | 作り直しが失敗 | 印が残る（次の巡回で再試行） |
 * | 作り直しの最中に編集 | 印が残る（控えた世代までしか進めない） |
 * | 連続編集の最中 | まだ作り直さない |
 */
const WS = 'ws-1';
const DOC = 'doc-1';

function makeService(opts: {
  rows: Array<{
    workspaceId: string;
    docId: string;
    pendingGeneration: bigint;
    indexedGeneration: bigint;
  }>;
  onIndex?: () => Promise<void> | void;
  /** 作り直しの最中に編集が来たことにする */
  editDuringIndex?: bigint;
}) {
  const rows = opts.rows.map(r => ({ ...r }));
  const updates: any[] = [];

  const prisma = {
    searchIndexQueue: {
      // 実物と同じく、列同士の比較に使える目印を持たせる
      fields: { indexedGeneration: Symbol('indexedGeneration') },
      findMany: jest.fn().mockImplementation(() => Promise.resolve(rows)),
      updateMany: jest.fn().mockImplementation((args: any) => {
        updates.push(args);
        const row = rows.find(
          r => r.workspaceId === args.where.workspaceId && r.docId === args.where.docId
        );
        if (!row) return Promise.resolve({ count: 0 });
        const lt = args.where.indexedGeneration?.lt;
        if (lt !== undefined && !(row.indexedGeneration < lt)) {
          return Promise.resolve({ count: 0 });
        }
        row.indexedGeneration = args.data.indexedGeneration;
        return Promise.resolve({ count: 1 });
      }),
    },
  };

  const indexer = {
    indexDocument: jest.fn().mockImplementation(async () => {
      if (opts.editDuringIndex !== undefined) {
        // 作り直しの最中に編集が届いた
        rows[0].pendingGeneration = opts.editDuringIndex;
      }
      await opts.onIndex?.();
    }),
  };

  const service = new SearchIndexQueueService(
    prisma as unknown as PrismaService,
    indexer as unknown as IndexerService
  );
  return { service, prisma, indexer, rows, updates };
}

describe('索引の作り直し待ち（#101）', () => {
  it('作り直しに成功したら、控えた世代まで印を進める', async () => {
    const { service, indexer, rows } = makeService({
      rows: [{ workspaceId: WS, docId: DOC, pendingGeneration: 5n, indexedGeneration: 2n }],
    });

    await service.processPending();

    expect(indexer.indexDocument).toHaveBeenCalledWith(WS, DOC);
    expect(rows[0].indexedGeneration).toBe(5n);
  });

  it('⚠️ 作り直しに失敗したら、印を残す（次の巡回で再試行）', async () => {
    const { service, rows } = makeService({
      rows: [{ workspaceId: WS, docId: DOC, pendingGeneration: 5n, indexedGeneration: 2n }],
      onIndex: () => {
        throw new Error('索引の作成に失敗');
      },
    });

    await service.processPending();

    expect(rows[0].indexedGeneration).toBe(2n);
    expect(rows[0].pendingGeneration).toBe(5n);
  });

  it('⚠️ 作り直しの最中に編集が来たら、印は残る', async () => {
    const { service, rows } = makeService({
      rows: [{ workspaceId: WS, docId: DOC, pendingGeneration: 5n, indexedGeneration: 2n }],
      editDuringIndex: 9n,
    });

    await service.processPending();

    // 控えた 5 までしか進めない。9 > 5 なので「作り直しが要る」が続く
    expect(rows[0].indexedGeneration).toBe(5n);
    expect(rows[0].pendingGeneration).toBe(9n);
  });

  it('⚠️ 静まっていない行は対象にしない（連続編集の最中）', async () => {
    const { service, prisma } = makeService({ rows: [] });

    await service.processPending();

    const where = prisma.searchIndexQueue.findMany.mock.calls[0][0].where;
    expect(where.pendingAt.lte).toBeInstanceOf(Date);
    expect(Date.now() - where.pendingAt.lte.getTime()).toBeGreaterThan(0);
  });

  it('作り直しが要らない行（pending <= indexed）は取り出さない', async () => {
    const { service, prisma } = makeService({ rows: [] });

    await service.processPending();

    const where = prisma.searchIndexQueue.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('pendingGeneration');
  });

  it('1件失敗しても、残りは処理する', async () => {
    let calls = 0;
    const { service, rows } = makeService({
      rows: [
        { workspaceId: WS, docId: 'doc-a', pendingGeneration: 3n, indexedGeneration: 0n },
        { workspaceId: WS, docId: 'doc-b', pendingGeneration: 4n, indexedGeneration: 0n },
      ],
      onIndex: () => {
        calls += 1;
        if (calls === 1) throw new Error('1件目で失敗');
      },
    });

    await service.processPending();

    expect(rows[0].indexedGeneration).toBe(0n);
    expect(rows[1].indexedGeneration).toBe(4n);
  });
});

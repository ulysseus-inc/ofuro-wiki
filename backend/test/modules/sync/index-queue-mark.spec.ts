import { SyncService } from '../../../src/modules/sync/sync.service';

/**
 * #101: ⚠️ **索引の作り直しの印は、本文の保存と同じトランザクションで立てる。**
 *
 * 分けると「本文は保存されたのに印が立たない」が起き、
 * **その編集は検索にもバックリンクにも永久に出ない**（docs/search-index.md 5章）。
 */
describe('索引の印と本文の保存（#101）', () => {
  const WS = '11111111-1111-4111-8111-111111111111';
  const DOC = 'doc-1';

  const make = (opts: { createThrows?: Error } = {}) => {
    const calls: string[] = [];

    const tx = {
      docUpdate: {
        create: jest.fn().mockImplementation(() => {
          calls.push('docUpdate.create');
          if (opts.createThrows) return Promise.reject(opts.createThrows);
          return Promise.resolve({ id: 1n });
        }),
      },
      docMeta: {
        updateMany: jest.fn().mockImplementation(() => {
          calls.push('docMeta.updateMany');
          return Promise.resolve({ count: 1 });
        }),
      },
      searchIndexQueue: {
        upsert: jest.fn().mockImplementation((args: any) => {
          calls.push('searchIndexQueue.upsert');
          return Promise.resolve(args);
        }),
      },
    };

    const prisma: any = {
      workspace: { findUnique: jest.fn().mockResolvedValue({ id: WS }) },
      docUpdate: { count: jest.fn().mockResolvedValue(1) },
      $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
    };
    const discovery: any = { bump: jest.fn(), current: jest.fn() };
    return { prisma, tx, calls, service: new SyncService(prisma, discovery) };
  };

  const someUpdate = () => new Uint8Array([1, 2, 3]);

  test('⚠️ 本文の保存と同じトランザクションで、印が立つ', async () => {
    const { service, tx, prisma, calls } = make();

    await service.pushUpdate(WS, DOC, someUpdate(), 'user-1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(calls).toContain('searchIndexQueue.upsert');
    expect(tx.searchIndexQueue.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId_docId: { workspaceId: WS, docId: DOC } },
      })
    );
  });

  test('印は世代を1つ進める（連続編集でも取りこぼさない）', async () => {
    const { service, tx } = make();

    await service.pushUpdate(WS, DOC, someUpdate(), 'user-1');

    const args = tx.searchIndexQueue.upsert.mock.calls[0][0];
    expect(args.update.pendingGeneration).toEqual({ increment: 1 });
    expect(args.create.pendingGeneration).toBe(1n);
  });

  test('⚠️ 本文の保存が失敗したら、印も残らない', async () => {
    const { service, tx } = make({ createThrows: new Error('保存に失敗') });

    await expect(
      service.pushUpdate(WS, DOC, someUpdate(), 'user-1')
    ).rejects.toThrow('保存に失敗');

    expect(tx.searchIndexQueue.upsert).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ **内部用のドキュメントには印を立てない。**
   * ワークスペース自身（docId === workspaceId）や、`$` を含む内部データ
   * （利用者ごとの設定など）は索引に載らない。印だけ立てても、
   * 巡回が毎回むだに作り直しにいく（レビュー指摘・2026-09-17）。
   */
  test('⚠️ ワークスペース自身のドキュメントには印を立てない', async () => {
    const { service, tx } = make();

    await service.pushUpdate(WS, WS, someUpdate(), 'user-1');

    expect(tx.docUpdate.create).toHaveBeenCalled();
    expect(tx.searchIndexQueue.upsert).not.toHaveBeenCalled();
  });

  test('⚠️ 内部データ（$ を含む）には印を立てない', async () => {
    const { service, tx } = make();

    await service.pushUpdate(WS, 'db$abc$docProperties', someUpdate(), 'user-1');

    expect(tx.docUpdate.create).toHaveBeenCalled();
    expect(tx.searchIndexQueue.upsert).not.toHaveBeenCalled();
  });
});

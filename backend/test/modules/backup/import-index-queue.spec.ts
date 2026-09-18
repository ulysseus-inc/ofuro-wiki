import { BackupService } from '../../../src/modules/backup/backup.service';

/**
 * #241: ⚠️ **取り込んだページを、検索の索引に載せる。**
 *
 * 取り込み（`importWorkspace`）は `doc_snapshots` と `doc_meta` しか書いておらず、
 * 索引には何も入らなかった。そのため**マニュアルもデモも検索に出ない**
 * （2026-09-18 に開発環境とデモの両方で確認）。
 *
 * 直し方は #101 の仕組みに乗せる。「作り直し待ち」の印を立てれば、
 * 巡回が静まってから索引を作る。取り込みの最中に重い索引付けをしない。
 */
describe('取り込んだページを索引に載せる（#241）', () => {
  const WS = 'ws-1';

  const make = () => {
    const upserts: Array<{ workspaceId: string; docId: string }> = [];
    const prisma = {
      searchIndexQueue: {
        upsert: jest.fn().mockImplementation((args: any) => {
          upserts.push(args.where.workspaceId_docId);
          return Promise.resolve({});
        }),
      },
    };
    const service = new BackupService(prisma as any, {} as any, {} as any);
    return { service, prisma, upserts };
  };

  test('⚠️ 取り込んだページすべてに、作り直しの印を立てる', async () => {
    const { service, upserts } = make();

    await (service as any).enqueueForIndexing(WS, ['doc-1', 'doc-2', 'doc-3']);

    expect(upserts).toEqual([
      { workspaceId: WS, docId: 'doc-1' },
      { workspaceId: WS, docId: 'doc-2' },
      { workspaceId: WS, docId: 'doc-3' },
    ]);
  });

  /**
   * ⚠️ **印を立てられなくても取り込みは失敗させない。**
   * 索引は後から作り直せるが、取り込みの巻き戻しは高くつく。
   */
  test('印を立てられなくても、例外にしない', async () => {
    const { service, prisma } = make();
    prisma.searchIndexQueue.upsert.mockRejectedValue(new Error('DB down'));

    await expect(
      (service as any).enqueueForIndexing(WS, ['doc-1']),
    ).resolves.toBeUndefined();
  });

  /**
   * ⚠️ 内部データ（ワークスペース自身の doc・`$` を含む doc）は索引に載らない。
   * 印を立てると、巡回が毎回むだに拾う（#101 と同じ理由）。
   */
  test('内部データには印を立てない', async () => {
    const { service, upserts } = make();

    await (service as any).enqueueForIndexing(WS, [
      WS,
      `db$${WS}$docProperties`,
      'doc-1',
    ]);

    expect(upserts).toEqual([{ workspaceId: WS, docId: 'doc-1' }]);
  });
});

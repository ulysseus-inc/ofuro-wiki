import { DocGcService } from '../../../src/modules/discovery/doc-gc.service';
import type { PrismaService } from '../../../src/prisma.service';

/**
 * #45: 完全削除。
 *
 * ⚠️ ここで守るのは「**消し残しが無いこと**」。
 * 消し残すと容量が増えるだけでなく、索引が残った doc は
 * 権限を引けずに「ワークスペースのメンバーなら読める」に落ち、
 * **消したページの本文が検索結果に出る**（docs/permanent-delete.md 4章）。
 */
describe('ページの完全削除（#45）', () => {
  const WS = 'ws-1';
  const DOC = 'doc-1';

  /** 削除で触った表の名前を、消した件数つきで記録する */
  const make = (metaCount = 1) => {
    const touched: string[] = [];
    const bumps: string[] = [];

    const deleter = (table: string, count: number) => ({
      deleteMany: jest.fn().mockImplementation((args: any) => {
        expect(args.where).toEqual({ workspaceId: WS, docId: DOC });
        touched.push(table);
        return { __table: table, count };
      }),
    });

    const prisma = {
      docUpdate: deleter('doc_updates', 3),
      docSnapshot: deleter('doc_snapshots', 1),
      docMeta: deleter('doc_meta', metaCount),
      // ⚠️ 履歴も本文そのもの（#45・レビュー指摘 2026-09-17）
      docHistory: deleter('doc_histories', 2),
      searchIndex: deleter('search_index', 7),
      searchIndexQueue: deleter('search_index_queue', 1),
      // ⚠️ **1つのトランザクションで消すこと。** 途中で落ちて
      // 「台帳だけ消えて本文が残る」状態を作らない
      $transaction: jest.fn().mockImplementation((ops: any[]) => {
        touched.push('$transaction');
        return Promise.resolve(ops);
      }),
    };

    const discovery = {
      bump: jest.fn().mockImplementation((_ws: string, reason: string) => {
        bumps.push(reason);
        return Promise.resolve();
      }),
    };

    return {
      service: new DocGcService(
        prisma as unknown as PrismaService,
        discovery as any,
      ),
      prisma,
      touched,
      bumps,
    };
  };

  test('⚠️ 本文・台帳・索引・作り直しの印を、すべて消す', async () => {
    const { service, touched } = make();

    await service.purge(WS, DOC);

    expect(touched).toEqual(
      expect.arrayContaining([
        'doc_updates',
        'doc_snapshots',
        'doc_histories',
        'doc_meta',
        'search_index',
        'search_index_queue',
      ]),
    );
  });

  /**
   * ⚠️ **履歴も本文そのもの。**
   * `doc_histories` を残すと、台帳が無いぶん権限が
   * 「ワークスペースのメンバーなら読める」に落ち、
   * **消したページの過去の版を履歴APIから読めてしまう**
   * （`doc.resolver.ts` の listHistory / getHistoryByTimestamp）。
   */
  test('⚠️ 履歴（doc_histories）も消す', async () => {
    const { service, touched } = make();

    await service.purge(WS, DOC);

    expect(touched).toContain('doc_histories');
  });

  test('1つのトランザクションで消す', async () => {
    const { service, prisma } = make();

    await service.purge(WS, DOC);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(6);
  });

  test('消したあとに版数を上げる', async () => {
    const { service, bumps } = make();

    const { deleted } = await service.purge(WS, DOC);

    expect(deleted).toBe(true);
    expect(bumps).toEqual(['doc-delete']);
  });

  /**
   * ⚠️ 版数を上げると、**全員の一覧のキャッシュが失効する**。
   * 何も消していないのに上げない。
   */
  test('台帳に無いページでは版数を上げない', async () => {
    const { service, bumps } = make(0);

    const { deleted } = await service.purge(WS, DOC);

    expect(deleted).toBe(false);
    expect(bumps).toEqual([]);
  });
});

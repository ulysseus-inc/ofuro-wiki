import { purgeIfStillOrphan } from '../../src/scripts/purge-orphan-docs';
import type { PrismaService } from '../../src/prisma.service';

/**
 * #45: 孤児の掃除（一回限り）。
 *
 * ⚠️ ここで守るのは「**今は有効なページを消さないこと**」。
 * 下見から削除までの間に同じ doc が作り直されることがあり、
 * 見たときの結果のまま消すと**利用者の本文を消す**
 * （レビュー指摘 2026-09-17）。
 */
describe('孤児の掃除（#45）', () => {
  const WS = 'ws-1';
  const DOC = 'doc-1';

  const make = (metaInTx: { docId: string } | null) => {
    const deleted: string[] = [];
    const tx = {
      docMeta: { findUnique: jest.fn().mockResolvedValue(metaInTx) },
      docUpdate: { deleteMany: jest.fn(() => deleted.push('doc_updates')) },
      docSnapshot: { deleteMany: jest.fn(() => deleted.push('doc_snapshots')) },
      docHistory: { deleteMany: jest.fn(() => deleted.push('doc_histories')) },
      searchIndex: { deleteMany: jest.fn(() => deleted.push('search_index')) },
      searchIndexQueue: {
        deleteMany: jest.fn(() => deleted.push('search_index_queue')),
      },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
    };
    return { prisma: prisma as unknown as PrismaService, deleted };
  };

  test('台帳に無いままなら消す', async () => {
    const { prisma, deleted } = make(null);

    await expect(purgeIfStillOrphan(prisma, WS, DOC)).resolves.toBe(true);

    expect(deleted).toEqual([
      'doc_updates',
      'doc_snapshots',
      'doc_histories',
      'search_index',
      'search_index_queue',
    ]);
  });

  test('⚠️ 途中で台帳に戻っていたら、何も消さない', async () => {
    const { prisma, deleted } = make({ docId: DOC });

    await expect(purgeIfStillOrphan(prisma, WS, DOC)).resolves.toBe(false);

    expect(deleted).toEqual([]);
  });
});

import { SyncService } from '../../../src/modules/sync/sync.service';

/**
 * #90: ドキュメントはブラウザ側で作られ、サーバーに作成の通知が来ない。
 * 「保存済みデータが無ければ新規作成」とみなす判定。
 */
describe('isNewDoc (#90)', () => {
  const make = (snapshot: unknown, update: unknown) => {
    const prisma: any = {
      docSnapshot: { findFirst: jest.fn().mockResolvedValue(snapshot) },
      docUpdate: { findFirst: jest.fn().mockResolvedValue(update) },
    };
    // #151: 版数の更新は本テストの関心事ではないため何もしないものを渡す
    const discovery: any = { bump: jest.fn(), current: jest.fn() };
    return { prisma, service: new SyncService(prisma, discovery) };
  };

  it('スナップショットも更新も無ければ新規', async () => {
    const { service } = make(null, null);
    await expect(service.isNewDoc('ws', 'doc')).resolves.toBe(true);
  });

  it('スナップショットがあれば新規ではない', async () => {
    const { service } = make({ docId: 'doc' }, null);
    await expect(service.isNewDoc('ws', 'doc')).resolves.toBe(false);
  });

  // 既存ドキュメントを開いて編集しただけで「作成」と記録すると、監査ログが嘘になる
  it('更新履歴があれば新規ではない', async () => {
    const { service } = make(null, { id: 1 });
    await expect(service.isNewDoc('ws', 'doc')).resolves.toBe(false);
  });
});

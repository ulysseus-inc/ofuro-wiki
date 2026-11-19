import { ManualRemovalService } from '../../../src/modules/manual-removal/manual-removal.service';

/**
 * #324: 📖 Manual ワークスペースをやめる（docs/docs-site.md 7 章）。
 * デプロイして起動したときに、残っていれば消す。無ければ何もしない
 */
describe('マニュアルのワークスペースを消す (#324)', () => {
  let prisma: {
    workspace: { deleteMany: jest.Mock };
    user: { deleteMany: jest.Mock };
    serverSetting: { deleteMany: jest.Mock };
  };
  let service: ManualRemovalService;

  beforeEach(() => {
    prisma = {
      workspace: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      user: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      serverSetting: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    service = new ManualRemovalService(prisma as any);
  });

  it('マニュアルの ID のワークスペースを消す（参加の行・ページはカスケードで消える）', async () => {
    await service.remove();

    expect(prisma.workspace.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            id: {
              gte: 'ffffffff-ffff-4fff-bfff-000000000000',
              lte: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
            },
          },
          { owner: { email: 'manual-system@ofuro-wiki.local', isSystem: true } },
        ],
      },
    });
  });

  it('【重要】同じメールアドレスで登録した一般のユーザーのワークスペースは消さない', async () => {
    // システムアカウントを消した後は、このアドレスが空く。持ち主はシステムアカウント（isSystem）に限る
    await service.remove();

    const { where } = prisma.workspace.deleteMany.mock.calls[0][0];
    expect(where.OR[1].owner.isSystem).toBe(true);
  });

  it('マニュアルのシステムアカウントと、版の記録も消す', async () => {
    await service.remove();

    expect(prisma.user.deleteMany).toHaveBeenCalledWith({
      where: { email: 'manual-system@ofuro-wiki.local', isSystem: true },
    });
    expect(prisma.serverSetting.deleteMany).toHaveBeenCalledWith({
      where: { key: 'manual_seed_version' },
    });
  });

  it('【重要】ワークスペースを先に消す（持ち主を先に消すと、外部キーで失敗しうる）', async () => {
    const order: string[] = [];
    prisma.workspace.deleteMany.mockImplementation(async () => {
      order.push('workspace');
      return { count: 1 };
    });
    prisma.user.deleteMany.mockImplementation(async () => {
      order.push('user');
      return { count: 1 };
    });

    await service.remove();

    expect(order).toEqual(['workspace', 'user']);
  });

  it('無ければ何もしないで終わる（2 回目の起動）', async () => {
    prisma.workspace.deleteMany.mockResolvedValue({ count: 0 });
    prisma.user.deleteMany.mockResolvedValue({ count: 0 });
    prisma.serverSetting.deleteMany.mockResolvedValue({ count: 0 });

    await expect(service.remove()).resolves.toBe(0);
  });

  it('消したワークスペースの数を返す', async () => {
    await expect(service.remove()).resolves.toBe(1);
  });
});

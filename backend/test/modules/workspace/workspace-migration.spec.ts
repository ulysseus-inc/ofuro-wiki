import {
  MigrationDecision,
  WorkspaceMigrationService,
} from '../../../src/modules/workspace/workspace-migration.service';

/**
 * #297: 一回限りの移行ツール（docs/workspace-model.md 12.9）。
 * 既存のワークスペースを、プライベートと共有に振り分ける。
 */
describe('ワークスペースの移行（#297）', () => {
  const ROOT_EMAIL = 'root@example.com';
  const savedEnv = process.env.ADMIN_EMAIL;

  /** ワークスペース（参加済みのメンバーの userId 一覧つき） */
  const ws = (id: string, ownerId: string, memberIds: string[], kind = 'private') => ({
    id,
    name: id,
    kind,
    ownerId,
    owner: { email: `${ownerId}@example.com` },
    members: [ownerId, ...memberIds].map((userId) => ({ userId })),
  });

  let prisma: any;
  let admin: any;
  let audit: any;
  let service: WorkspaceMigrationService;

  beforeEach(() => {
    process.env.ADMIN_EMAIL = ROOT_EMAIL;
    prisma = {
      workspace: { findMany: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'root', email: ROOT_EMAIL }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
    };
    admin = { reassignSharedOwner: jest.fn() };
    audit = { record: jest.fn() };
    service = new WorkspaceMigrationService(prisma, admin, audit, {
      // #319: 名前は DB の値をそのまま返す（ルート文書の読み取りは workspace-name.spec で確かめる）
      workspaceName: async (w: { name: string | null }) => w.name,
    });
  });
  afterEach(() => {
    process.env.ADMIN_EMAIL = savedEnv;
  });

  describe('下見（plan）', () => {
    it('ほかに参加者が居れば共有、持ち主だけならプライベート', async () => {
      prisma.workspace.findMany.mockResolvedValue([
        ws('team', 'alice', ['bob']),
        ws('solo', 'carol', []),
      ]);

      const plan = await service.plan();
      const decisionOf = (id: string) => plan.find((p) => p.id === id)?.decision;
      expect(decisionOf('team')).toBe(MigrationDecision.Shared);
      expect(decisionOf('solo')).toBe(MigrationDecision.Private);
    });

    it('1 人が「持ち主だけ」のものを 2 つ以上持つなら要判断', async () => {
      prisma.workspace.findMany.mockResolvedValue([ws('a1', 'alice', []), ws('a2', 'alice', [])]);

      const plan = await service.plan();
      expect(plan.map((p) => p.decision)).toEqual([MigrationDecision.Review, MigrationDecision.Review]);
    });

    it('要判断のうち --share で選んだものは共有。残りが 1 つならプライベート', async () => {
      prisma.workspace.findMany.mockResolvedValue([ws('a1', 'alice', []), ws('a2', 'alice', [])]);

      const plan = await service.plan(new Set(['a1']));
      const decisionOf = (id: string) => plan.find((p) => p.id === id)?.decision;
      expect(decisionOf('a1')).toBe(MigrationDecision.Shared);
      expect(decisionOf('a2')).toBe(MigrationDecision.Private);
    });

    it('すでに共有のものは何もしない（2 回目に流しても同じ）', async () => {
      prisma.workspace.findMany.mockResolvedValue([ws('done', 'root', ['bob'], 'shared')]);

      const plan = await service.plan();
      expect(plan.find((p) => p.id === 'done')?.decision).toBe(MigrationDecision.Done);
    });
  });

  describe('--share の検査', () => {
    it.each([
      ['知らない ID', 'nope'],
      ['もともと共有になるもの', 'team'],
    ])('⚠️ %s を --share に渡すと、何も書き換えずに止める', async (_label, id) => {
      prisma.workspace.findMany.mockResolvedValue([
        ws('team', 'alice', ['bob']),
        ws('done', 'root', ['bob'], 'shared'),
        ws('a1', 'carol', []),
        ws('a2', 'carol', []),
      ]);

      await expect(service.apply(new Set([id]))).rejects.toThrow(/--share/);
      expect(prisma.workspace.update).not.toHaveBeenCalled();
      expect(admin.reassignSharedOwner).not.toHaveBeenCalled();
    });
  });

  describe('--share 付きの流し直し', () => {
    // ⚠️ 途中で失敗したあと、同じ引数で流し直せること（PR #316 のレビューで発見）
    it('⚠️ すでに共有になったものを --share に渡しても止めない（何もしない）', async () => {
      prisma.workspace.findMany.mockResolvedValue([ws('a1', 'alice', [], 'shared'), ws('a2', 'alice', [])]);

      const result = await service.apply(new Set(['a1']));
      expect(prisma.workspace.update).not.toHaveBeenCalled();
      expect(admin.reassignSharedOwner).toHaveBeenCalledWith('root');
      expect(result.converted).toBe(0);
    });
  });

  describe('書き換え（apply）', () => {
    it('共有にするものの種類を変え、持ち主を root に付け替え、監査ログに残す', async () => {
      prisma.workspace.findMany.mockResolvedValue([ws('team', 'alice', ['bob']), ws('solo', 'carol', [])]);

      const result = await service.apply();

      expect(prisma.workspace.update).toHaveBeenCalledTimes(1);
      expect(prisma.workspace.update).toHaveBeenCalledWith({
        where: { id: 'team' },
        data: { kind: 'shared' },
      });
      expect(admin.reassignSharedOwner).toHaveBeenCalledWith('root');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'workspace.kind.migrate', targetId: 'team' }),
      );
      expect(result.converted).toBe(1);
    });

    it('⚠️ 監査ログを先に書く（種類を変えた後で落ちても、記録が欠けない）', async () => {
      prisma.workspace.findMany.mockResolvedValue([ws('team', 'alice', ['bob'])]);
      const order: string[] = [];
      audit.record.mockImplementation(() => {
        order.push('audit');
        return Promise.resolve();
      });
      prisma.workspace.update.mockImplementation(() => {
        order.push('update');
        return Promise.resolve();
      });

      await service.apply();
      expect(order).toEqual(['audit', 'update']);
    });

    it('⚠️ 監査ログを書けなければ、種類を変えない', async () => {
      prisma.workspace.findMany.mockResolvedValue([ws('team', 'alice', ['bob'])]);
      audit.record.mockRejectedValue(new Error('audit down'));

      await expect(service.apply()).rejects.toThrow('audit down');
      expect(prisma.workspace.update).not.toHaveBeenCalled();
    });

    // 途中で失敗しても、そのまま流し直せば直る（共有にしたものは「済み」、付け替えは毎回すべてを見直す）
    it('⚠️ 付け替えで失敗したあと流し直すと、付け替えをやり直す', async () => {
      prisma.workspace.findMany.mockResolvedValueOnce([ws('team', 'alice', ['bob'])]);
      admin.reassignSharedOwner.mockRejectedValueOnce(new Error('boom'));
      await expect(service.apply()).rejects.toThrow('boom');

      // 2 回目: 種類はもう共有（済み）。種類は書き換えないが、付け替えはもう一度行う
      prisma.workspace.findMany.mockResolvedValueOnce([ws('team', 'alice', ['bob'], 'shared')]);
      prisma.workspace.update.mockClear();
      const result = await service.apply();
      expect(prisma.workspace.update).not.toHaveBeenCalled();
      expect(admin.reassignSharedOwner).toHaveBeenCalledTimes(2);
      expect(result.converted).toBe(0);
    });

    it('⚠️ root が居なければ、何も書き換えずに止める', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.workspace.findMany.mockResolvedValue([ws('team', 'alice', ['bob'])]);

      await expect(service.apply()).rejects.toThrow(/root/);
      expect(prisma.workspace.update).not.toHaveBeenCalled();
      expect(admin.reassignSharedOwner).not.toHaveBeenCalled();
    });

    it('重複が無ければ、1 人 1 つの一意インデックスを作る', async () => {
      prisma.workspace.findMany.mockResolvedValue([ws('solo', 'carol', [])]);

      const result = await service.apply();
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('workspaces_one_private_per_owner'),
      );
      expect(result.uniqueIndex).toBe('created');
    });

    it('⚠️ 重複（要判断）が残っていれば、一意インデックスは作らない', async () => {
      prisma.workspace.findMany.mockResolvedValue([ws('a1', 'alice', []), ws('a2', 'alice', [])]);
      prisma.$queryRaw.mockResolvedValue([{ owner_id: 'alice' }]);

      const result = await service.apply();
      expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(result.uniqueIndex).toBe('blocked');
      expect(result.review.map((r) => r.id)).toEqual(['a1', 'a2']);
    });
  });
});

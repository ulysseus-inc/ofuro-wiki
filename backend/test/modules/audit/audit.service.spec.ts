import {
  AuditService,
  DEFAULT_RETENTION_DAYS,
} from '../../../src/modules/audit/audit.service';

describe('AuditService (#90)', () => {
  let prisma: any;
  let service: AuditService;

  beforeEach(() => {
    prisma = {
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      serverSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    service = new AuditService(prisma);
  });

  describe('record', () => {
    it('当時の利用者を値で保存する', async () => {
      // actorId は UUID 列。実際の利用者 ID と同じ形にする
      // （形が違うと列に入らず、テストが現実とずれる）
      const actorId = '550e8400-e29b-41d4-a716-446655440000';
      await service.record({
        action: 'user.delete',
        actor: { id: actorId, email: 'admin@example.com', name: '管理 太郎' },
        targetType: 'user',
        targetId: 'u2',
        targetName: 'target@example.com',
      });

      expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({
        action: 'user.delete',
        actorId,
        actorEmail: 'admin@example.com',
        actorName: '管理 太郎',
        targetName: 'target@example.com',
      });
    });

    // サインイン失敗など未認証の操作でも記録は残す
    it('利用者が不明でも記録する', async () => {
      await service.record({ action: 'auth.signin.failed', actor: {} });
      expect(prisma.auditLog.create.mock.calls[0][0].data.actorEmail).toBe(
        'anonymous',
      );
    });

    it('UserAgent は255文字で切る', async () => {
      await service.record({
        action: 'user.create',
        actor: { email: 'a@example.com' },
        userAgent: 'x'.repeat(400),
      });
      expect(
        prisma.auditLog.create.mock.calls[0][0].data.userAgent,
      ).toHaveLength(255);
    });

    // fail-open。監査ログが書けないことで利用者の操作を止めない
    it('記録に失敗しても例外を投げない', async () => {
      prisma.auditLog.create.mockRejectedValue(new Error('DB down'));
      await expect(
        service.record({ action: 'user.create', actor: {} }),
      ).resolves.toBeUndefined();
    });

    it('記録に失敗した事実はアプリログに残す', async () => {
      prisma.auditLog.create.mockRejectedValue(new Error('DB down'));
      const error = jest.spyOn((service as any).logger, 'error');
      await service.record({ action: 'user.create', actor: {} });
      expect(error).toHaveBeenCalled();
    });
  });

  describe('保持期間', () => {
    it('未設定なら3年', async () => {
      await expect(service.retentionDays()).resolves.toBe(
        DEFAULT_RETENTION_DAYS,
      );
    });

    it('設定値を使う', async () => {
      prisma.serverSetting.findUnique.mockResolvedValue({ value: '365' });
      await expect(service.retentionDays()).resolves.toBe(365);
    });

    // 素通しすると NaN から「全件削除」や「1件も消えない」事故になる
    it.each(['abc', '', '0', '-5'])('不正な値 %s は既定にする', async (value) => {
      prisma.serverSetting.findUnique.mockResolvedValue({ value });
      await expect(service.retentionDays()).resolves.toBe(
        DEFAULT_RETENTION_DAYS,
      );
    });

    // 記録が消えた事実が残らないと、元から無かったのか消されたのか分からない
    it('削除したこと自体を記録する', async () => {
      prisma.auditLog.deleteMany.mockResolvedValue({ count: 1234 });
      await service.cleanupOldLogs();

      const recorded = prisma.auditLog.create.mock.calls[0][0].data;
      expect(recorded.action).toBe('audit.cleanup');
      expect(recorded.detail.meta).toMatchObject({ deleted: 1234 });
    });

    it('削除が0件なら記録しない（毎日の空ログを増やさない）', async () => {
      await service.cleanupOldLogs();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('削除に失敗しても例外を投げない', async () => {
      prisma.auditLog.deleteMany.mockRejectedValue(new Error('DB down'));
      await expect(service.cleanupOldLogs()).resolves.toBe(0);
    });
  });
});

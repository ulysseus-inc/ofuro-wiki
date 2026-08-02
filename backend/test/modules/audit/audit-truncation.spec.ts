import { AuditService } from '../../../src/modules/audit/audit.service';

/**
 * #90: 列の上限を超えた値をそのまま書くと INSERT が失敗し、
 * fail-open で黙って捨てられる。**攻撃者が自分の痕跡を消せる**ため、
 * すべて切り詰めてから保存する。
 */
describe('監査ログの値の切り詰め (#90)', () => {
  let prisma: any;
  let service: AuditService;

  beforeEach(() => {
    prisma = {
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      serverSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    service = new AuditService(prisma);
  });

  const saved = () => prisma.auditLog.create.mock.calls[0][0].data;

  // X-Forwarded-For に46文字以上を入れるだけで記録を消せてしまっていた
  it('ip は45文字（IPv6 の最大長）で切る', async () => {
    await service.record({
      action: 'user.create',
      actor: { email: 'a@example.com' },
      ip: 'x'.repeat(200),
    });
    expect(saved().ip).toHaveLength(45);
  });

  it.each([
    ['actorEmail', 255],
    ['actorName', 255],
    ['targetId', 255],
    ['targetName', 255],
    ['userAgent', 255],
  ])('%s は%d文字で切る', async (field, max) => {
    await service.record({
      action: 'user.create',
      actor: {
        email: field === 'actorEmail' ? 'y'.repeat(400) : 'a@example.com',
        name: field === 'actorName' ? 'y'.repeat(400) : undefined,
      },
      targetId: field === 'targetId' ? 'y'.repeat(400) : undefined,
      targetName: field === 'targetName' ? 'y'.repeat(400) : undefined,
      userAgent: field === 'userAgent' ? 'y'.repeat(400) : undefined,
    });
    expect(saved()[field]).toHaveLength(max);
  });

  it('action は64文字で切る', async () => {
    await service.record({ action: 'a'.repeat(100), actor: {} });
    expect(saved().action).toHaveLength(64);
  });

  it('targetType は32文字で切る', async () => {
    await service.record({
      action: 'user.create',
      actor: {},
      targetType: 'b'.repeat(100),
    });
    expect(saved().targetType).toHaveLength(32);
  });

  it('短い値はそのまま', async () => {
    await service.record({
      action: 'user.create',
      actor: { email: 'a@example.com', name: '山田 太郎' },
      ip: '10.0.0.1',
    });
    expect(saved()).toMatchObject({
      action: 'user.create',
      actorEmail: 'a@example.com',
      actorName: '山田 太郎',
      ip: '10.0.0.1',
    });
  });

  it('null / undefined は null のまま', async () => {
    await service.record({ action: 'user.create', actor: {} });
    const data = saved();
    expect(data.actorName).toBeNull();
    expect(data.ip).toBeNull();
  });
});

import { AuditService, asUuid } from '../../../src/modules/audit/audit.service';

/**
 * #90: UUID 列に不正な値を渡すと INSERT が失敗し、fail-open で記録が消える。
 * 列長の切り詰めと同じ失敗経路なので、同じように塞ぐ。
 */
describe('UUID 列の扱い (#90)', () => {
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

  it('正しい UUID はそのまま入る', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    expect(asUuid(id)).toBe(id);
  });

  it.each(['not-a-uuid', '', '550e8400', '../../etc/passwd', 'null'])(
    'UUID でない %j は列に入れない',
    (value) => {
      expect(asUuid(value)).toBeNull();
    },
  );

  it('不正な workspaceId でも記録自体は残す', async () => {
    await service.record({
      action: 'workspace.delete',
      actor: { email: 'a@example.com' },
      workspaceId: 'not-a-uuid',
    });

    expect(prisma.auditLog.create).toHaveBeenCalled();
    expect(saved().workspaceId).toBeNull();
  });

  // 列に入らない値を捨てると、後から追えなくなる
  it('列に入れられなかった値は detail に退避する', async () => {
    await service.record({
      action: 'workspace.delete',
      actor: { id: 'bad-actor-id', email: 'a@example.com' },
      workspaceId: 'not-a-uuid',
    });

    expect(saved().detail.meta.rejected).toEqual({
      actorId: 'bad-actor-id',
      workspaceId: 'not-a-uuid',
    });
  });

  it('正しい値のときは detail を汚さない', async () => {
    await service.record({
      action: 'workspace.delete',
      actor: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        email: 'a@example.com',
      },
      workspaceId: '550e8400-e29b-41d4-a716-446655440001',
      detail: { meta: { reason: 'cleanup' } },
    });

    expect(saved().detail).toEqual({ meta: { reason: 'cleanup' } });
  });
});

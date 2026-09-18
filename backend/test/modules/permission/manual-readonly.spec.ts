import { PermissionService } from '../../../src/modules/permission/permission.service';
import type { PrismaService } from '../../../src/prisma.service';

/**
 * #241: ⚠️ **マニュアルは誰にも編集させない。**
 *
 * マニュアルは出荷物（`backend/seed/manual.zip`）であり、
 * 「本番では誰も編集しない」という前提で作られている（docs/manual-workspace.md）。
 *
 * ところが `getDocRole` はサーバー Admin を Owner としてバイパスするため、
 * **Admin だけは編集できてしまっていた**（2026-09-18 に利用者が発見）。
 * しかも次のマニュアル更新でワークスペースごと作り直されるので、
 * その編集は**黙って消える**。それなら最初から書かせない。
 */
describe('マニュアルは編集できない（#241）', () => {
  /** マニュアルWSの ID は先頭が all-f で固定（内容版ごとに末尾が変わる） */
  const MANUAL = 'ffffffff-ffff-4fff-bfff-36f05627dd2e';
  const NORMAL = '11111111-1111-4111-8111-111111111111';
  const ADMIN = 'admin-1';

  const make = () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ isAdmin: true }) },
      workspaceMember: {
        findUnique: jest.fn().mockResolvedValue({ role: 'Reader' }),
      },
      docPermission: { findUnique: jest.fn().mockResolvedValue(null) },
      docMeta: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    return new PermissionService(prisma as unknown as PrismaService);
  };

  test('⚠️ サーバー Admin でも、マニュアルでは Reader どまり', async () => {
    const role = await make().getDocRole(MANUAL, 'doc-1', ADMIN);
    expect(role).toBe('Reader');
  });

  test('⚠️ サーバー Admin でも、マニュアルは更新できない', async () => {
    await expect(make().canUpdate(MANUAL, 'doc-1', ADMIN)).resolves.toBe(false);
  });

  test('マニュアルでも読むことはできる', async () => {
    await expect(make().canRead(MANUAL, 'doc-1', ADMIN)).resolves.toBe(true);
  });

  /**
   * ⚠️ **Admin の読み取りまで奪わない。**
   * マニュアルWSにまだ参加していない Admin（遅延参加の前や、API から直接触る場合）
   * が読めなくなると、調査や復旧の手段を失う（レビュー指摘・2026-09-18）。
   */
  test('⚠️ マニュアルに未参加の Admin でも、読むことはできる', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ isAdmin: true }) },
      // まだ参加していない
      workspaceMember: { findUnique: jest.fn().mockResolvedValue(null) },
      docPermission: { findUnique: jest.fn().mockResolvedValue(null) },
      docMeta: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new PermissionService(prisma as any);

    expect(await service.getDocRole(MANUAL, 'doc-1', ADMIN)).toBe('Reader');
    expect(await service.canRead(MANUAL, 'doc-1', ADMIN)).toBe(true);
    expect(await service.canUpdate(MANUAL, 'doc-1', ADMIN)).toBe(false);
  });

  test('マニュアルに参加していない一般の利用者は、読めない', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ isAdmin: false }) },
      workspaceMember: { findUnique: jest.fn().mockResolvedValue(null) },
      docPermission: { findUnique: jest.fn().mockResolvedValue(null) },
      docMeta: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new PermissionService(prisma as any);

    expect(await service.getDocRole(MANUAL, 'doc-1', 'user-1')).toBeNull();
  });

  test('ふつうのワークスペースでは、これまでどおり Admin は Owner', async () => {
    const role = await make().getDocRole(NORMAL, 'doc-1', ADMIN);
    expect(role).toBe('Owner');
  });
});

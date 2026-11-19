import { ForbiddenException } from '@nestjs/common';
import { WorkspaceService } from '../../../src/modules/workspace/workspace.service';
import type { PrismaService } from '../../../src/prisma.service';

/**
 * #297: ワークスペース管理者（admin）を下げる・外すのは、持ち主（root）とシステム管理者だけ。
 * 任命と同じ立場に揃える（docs/permission-matrix.md 2.2・2026-10-28 決定）。
 */
describe('ワークスペース管理者の保護（#297）', () => {
  const WS = '11111111-1111-4111-8111-111111111111';
  const ROOT = 'root';
  const MANAGER = 'manager';
  const OTHER_MANAGER = 'other-manager';
  const MEMBER = 'member';
  const SYSADMIN = 'sysadmin';
  /** システム管理者で、しかもこの共有のワークスペース管理者として入っている人 */
  const SYSADMIN_MANAGER = 'sysadmin-manager';
  const SYSTEM_ADMINS = new Set([SYSADMIN, SYSADMIN_MANAGER]);

  const ROLES: Record<string, string> = {
    [ROOT]: 'owner',
    [MANAGER]: 'admin',
    [OTHER_MANAGER]: 'admin',
    [MEMBER]: 'member',
    [SYSADMIN_MANAGER]: 'admin',
  };

  const make = () => {
    const prisma: any = {
      workspaceMember: {
        findUnique: jest.fn(({ where }: any) => {
          const role = ROLES[where.workspaceId_userId.userId];
          return Promise.resolve(role ? { role } : null);
        }),
        delete: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      workspace: {
        findUnique: jest.fn().mockResolvedValue({ ownerId: ROOT, kind: 'shared' }),
      },
      user: {
        findUnique: jest.fn(({ where }: any) =>
          Promise.resolve({ isAdmin: SYSTEM_ADMINS.has(where.id) }),
        ),
      },
    };
    const service = new WorkspaceService(
      prisma as unknown as PrismaService,
      { isEnabled: () => false } as never,
      { record: jest.fn() } as never,
      { bump: jest.fn() } as never,
      { workspaceName: async (w: { name: string | null }) => w.name } as never,
    );
    return { service, prisma };
  };

  describe('外す（revokeMember）', () => {
    it('⚠️ ワークスペース管理者は、別のワークスペース管理者を外せない', async () => {
      const { service, prisma } = make();
      await expect(service.removeMember(WS, OTHER_MANAGER, MANAGER)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.workspaceMember.delete).not.toHaveBeenCalled();
    });

    it('システム管理者は、メンバーでなくてもワークスペース管理者を外せる', async () => {
      const { service, prisma } = make();
      await service.removeMember(WS, MANAGER, SYSADMIN);
      expect(prisma.workspaceMember.delete).toHaveBeenCalled();
    });

    // ⚠️ メンバーの行があっても、システム管理者の素通りが優先する（PR #311 のレビューで発見）
    it('⚠️ システム管理者は、自分がワークスペース管理者として入っていても、別の管理者を外せる', async () => {
      const { service, prisma } = make();
      await service.removeMember(WS, MANAGER, SYSADMIN_MANAGER);
      expect(prisma.workspaceMember.delete).toHaveBeenCalled();
    });

    it('ワークスペース管理者は、メンバーを外せる', async () => {
      const { service, prisma } = make();
      await service.removeMember(WS, MEMBER, MANAGER);
      expect(prisma.workspaceMember.delete).toHaveBeenCalled();
    });

    it('持ち主（root）は誰も外せない', async () => {
      const { service, prisma } = make();
      await expect(service.removeMember(WS, ROOT, SYSADMIN)).rejects.toThrow(ForbiddenException);
      expect(prisma.workspaceMember.delete).not.toHaveBeenCalled();
    });
  });

  describe('役割を変える（grantMember）', () => {
    it('⚠️ ワークスペース管理者は、別のワークスペース管理者を下げられない', async () => {
      const { service, prisma } = make();
      await expect(service.grantMember(WS, OTHER_MANAGER, 'Write', MANAGER)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.workspaceMember.update).not.toHaveBeenCalled();
    });

    it('システム管理者は、メンバーでなくてもワークスペース管理者を下げられる', async () => {
      const { service, prisma } = make();
      await service.grantMember(WS, MANAGER, 'Write', SYSADMIN);
      expect(prisma.workspaceMember.update).toHaveBeenCalled();
    });

    it('⚠️ システム管理者は、自分がワークスペース管理者として入っていても、別の管理者を下げられる', async () => {
      const { service, prisma } = make();
      await service.grantMember(WS, MANAGER, 'Write', SYSADMIN_MANAGER);
      expect(prisma.workspaceMember.update).toHaveBeenCalled();
    });

    it('ワークスペース管理者は、メンバーを閲覧者にできる', async () => {
      const { service, prisma } = make();
      await service.grantMember(WS, MEMBER, 'Read', MANAGER);
      expect(prisma.workspaceMember.update).toHaveBeenCalled();
    });

    it('ワークスペース管理者は、メンバーを管理者に任命できない', async () => {
      const { service, prisma } = make();
      await expect(service.grantMember(WS, MEMBER, 'Admin', MANAGER)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.workspaceMember.update).not.toHaveBeenCalled();
    });
  });

  describe('実効の役割（effectiveRole）', () => {
    it('⚠️ システム管理者は、メンバーの行があっても共有では持ち主と同じ扱い', async () => {
      const { service } = make();
      await expect(service.effectiveRole(WS, SYSADMIN_MANAGER)).resolves.toBe('owner');
    });

    it('一般のワークスペース管理者は、そのまま admin', async () => {
      const { service } = make();
      await expect(service.effectiveRole(WS, MANAGER)).resolves.toBe('admin');
    });
  });

  describe('一覧（getUserWorkspaces）', () => {
    it('⚠️ システム管理者は、メンバーとして入っている共有も、一覧では持ち主と同じ扱い', async () => {
      const { service, prisma } = make();
      prisma.workspaceMember.findMany = jest.fn().mockResolvedValue([
        { workspaceId: WS, role: 'admin', workspace: { id: WS, kind: 'shared', members: [] } },
      ]);
      prisma.workspace.findMany = jest.fn().mockResolvedValue([]);

      const list = await service.getUserWorkspaces(SYSADMIN_MANAGER);
      expect(list.find((w) => w.workspace.id === WS)?.role).toBe('owner');
    });

    it('一般のワークスペース管理者は、一覧でもそのまま admin', async () => {
      const { service, prisma } = make();
      prisma.workspaceMember.findMany = jest.fn().mockResolvedValue([
        { workspaceId: WS, role: 'admin', workspace: { id: WS, kind: 'shared', members: [] } },
      ]);

      const list = await service.getUserWorkspaces(MANAGER);
      expect(list.find((w) => w.workspace.id === WS)?.role).toBe('admin');
    });
  });
});

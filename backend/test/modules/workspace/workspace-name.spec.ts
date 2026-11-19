import * as Y from 'yjs';
import { IndexReaderService } from '../../../src/modules/discovery/index-reader.service';
import { NotificationService } from '../../../src/modules/notification/notification.service';
import { WorkspaceMigrationService } from '../../../src/modules/workspace/workspace-migration.service';
import { WorkspaceService } from '../../../src/modules/workspace/workspace.service';
import { PrismaService } from '../../../src/prisma.service';

/**
 * #319: ワークスペース名の正はルート文書の meta.name。DB の workspaces.name は作った時のまま
 * （docs/workspace-model.md 12.13）。名前が要る所では、ルート文書から読む
 */
describe('ワークスペース名 (#319)', () => {
  const DB_NAME = 'ofuro-wiki';
  const REAL_NAME = '社内Wiki';

  describe('IndexReaderService.workspaceName', () => {
    const readerFor = (rootName: string | null) => {
      const doc = new Y.Doc();
      if (rootName) {
        doc.getMap('meta').set('name', rootName);
      }
      return new IndexReaderService({
        docSnapshot: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ blob: Buffer.from(Y.encodeStateAsUpdate(doc)) }),
        },
        docUpdate: { findMany: jest.fn().mockResolvedValue([]) },
      } as unknown as PrismaService);
    };

    it('ルート文書の名前を返す（DB の名前より優先）', async () => {
      const name = await readerFor(REAL_NAME).workspaceName({ id: 'ws-1', name: DB_NAME });
      expect(name).toBe(REAL_NAME);
    });

    it('ルート文書に名前が無ければ DB の名前', async () => {
      const name = await readerFor(null).workspaceName({ id: 'ws-1', name: DB_NAME });
      expect(name).toBe(DB_NAME);
    });

    it('どちらも無ければ null', async () => {
      expect(await readerFor(null).workspaceName({ id: 'ws-1', name: null })).toBeNull();
    });
  });

  /** 名前の読み手。ルート文書の名前を返す */
  const names = {
    workspaceName: jest.fn(async (w: { id: string; name: string | null }) =>
      w.id === 'ws-1' ? REAL_NAME : w.name,
    ),
  };

  describe('ワークスペースの削除', () => {
    it('監査ログの名前は、消す前のルート文書の名前', async () => {
      const audit = { record: jest.fn() };
      const prisma = {
        workspace: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'ws-1', name: DB_NAME, kind: 'private', ownerId: 'u1' }),
          delete: jest.fn().mockResolvedValue({}),
        },
        user: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'u1', email: 'u1@example.com', name: 'U1', isAdmin: false }),
        },
      };
      const service = new WorkspaceService(
        prisma as unknown as PrismaService,
        { isEnabled: () => false } as never,
        audit as never,
        { bump: jest.fn() } as never,
        names as never,
      );

      await service.deleteWorkspace('ws-1', 'u1');

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'workspace.delete', targetName: REAL_NAME }),
      );
    });
  });

  describe('招待の情報', () => {
    it('招待リンクを開いたときに出る名前は、ルート文書の名前', async () => {
      const prisma = {
        invitation: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'inv-1',
            email: null,
            workspaceId: 'ws-1',
            workspace: { id: 'ws-1', name: DB_NAME, avatarKey: null },
            inviter: { id: 'u1', name: 'U1', avatarUrl: null },
          }),
        },
        user: { findUnique: jest.fn().mockResolvedValue(null) },
        workspaceMember: { findUnique: jest.fn().mockResolvedValue(null) },
      };
      const service = new WorkspaceService(
        prisma as unknown as PrismaService,
        { isEnabled: () => false } as never,
        { record: jest.fn() } as never,
        { bump: jest.fn() } as never,
        names as never,
      );

      const info = await service.getInviteInfo('inv-1');

      expect(info.workspace.name).toBe(REAL_NAME);
    });
  });

  describe('通知', () => {
    it('通知に出るワークスペース名は、ルート文書の名前', async () => {
      const prisma = {
        workspace: {
          findUnique: jest.fn().mockResolvedValue({ id: 'ws-1', name: DB_NAME, avatarKey: null }),
        },
      };
      const service = new NotificationService(
        prisma as never,
        { isEnabled: () => false } as never,
        names as never,
      );

      const info = await (service as any).getWorkspaceInfo('ws-1');

      expect(info.name).toBe(REAL_NAME);
    });
  });

  describe('移行ツール', () => {
    it('下見の一覧と監査ログの名前は、ルート文書の名前', async () => {
      process.env.ROOT_EMAIL = 'root@example.com';
      const audit = { record: jest.fn() };
      const prisma = {
        workspace: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'ws-1',
              name: DB_NAME,
              kind: 'private',
              ownerId: 'alice',
              owner: { email: 'alice@example.com' },
              members: [{ userId: 'alice' }, { userId: 'bob' }],
            },
          ]),
          update: jest.fn().mockResolvedValue({}),
        },
        user: {
          findUnique: jest.fn().mockResolvedValue({ id: 'root', email: 'root@example.com' }),
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
        $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      };
      const service = new WorkspaceMigrationService(
        prisma as never,
        { reassignSharedOwner: jest.fn() },
        audit,
        names,
      );

      const plan = await service.plan();
      expect(plan[0].name).toBe(REAL_NAME);

      await service.apply();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'workspace.kind.migrate', targetName: REAL_NAME }),
      );
      delete process.env.ROOT_EMAIL;
    });
  });
});

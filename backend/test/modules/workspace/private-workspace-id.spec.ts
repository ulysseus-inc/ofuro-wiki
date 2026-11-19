import { WorkspaceKind } from '../../../src/common/workspace-kind';
import { WorkspaceService } from '../../../src/modules/workspace/workspace.service';
import type { PrismaService } from '../../../src/prisma.service';

/**
 * #297: 着地でプライベートを作るかを決める（docs/workspace-model.md 12.3.1）。
 * 共有の持ち主（root）や、共有のメンバーであることに引きずられないよう、
 * 「本人が持ち主」かつ「プライベート」だけで探す。
 */
describe('自分のプライベートの ID（#297）', () => {
  const make = (found: { id: string } | null) => {
    const findFirst = jest.fn().mockResolvedValue(found);
    const prisma: any = { workspace: { findFirst } };
    const service = new WorkspaceService(
      prisma as unknown as PrismaService,
      { isEnabled: () => false } as never,
      { record: jest.fn() } as never,
      { bump: jest.fn() } as never,
      { workspaceName: async (w: { name: string | null }) => w.name } as never,
    );
    return { service, findFirst };
  };

  it('本人が持ち主のプライベートだけを探し、その ID を返す', async () => {
    const { service, findFirst } = make({ id: 'ws-private' });

    await expect(service.findPrivateWorkspaceId('u1')).resolves.toBe('ws-private');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId: 'u1', kind: WorkspaceKind.Private },
      }),
    );
  });

  it('無ければ null（着地で作る）', async () => {
    const { service } = make(null);

    await expect(service.findPrivateWorkspaceId('u1')).resolves.toBeNull();
  });
});

import { ForbiddenException } from '@nestjs/common';
import { WorkspaceService } from '../../../src/modules/workspace/workspace.service';
import type { PrismaService } from '../../../src/prisma.service';

/**
 * #297: 1 人 1 つのプライベートの一意インデックス（workspaces_one_private_per_owner）の違反だけを
 * 「すでにある」として扱う。ほかの一意制約の違反は、そのまま投げる（原因を隠さない）。
 *
 * エラーの形は、開発用の DB で実際に違反させて採った（2026-10-28。Prisma 7 + driver adapter）。
 * `meta.target` は返らず、制約の名前は `meta.driverAdapterError.cause.originalMessage` に入る。
 */
describe('プライベートの同時作成（#297）', () => {
  const p2002 = (originalMessage: string, fields: string[]) =>
    Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: {
        modelName: 'Workspace',
        driverAdapterError: {
          name: 'DriverAdapterError',
          cause: {
            originalCode: '23505',
            originalMessage,
            kind: 'UniqueConstraintViolation',
            constraint: { fields },
          },
        },
      },
    });

  const make = (error: Error) => {
    const prisma: any = {
      workspace: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn().mockRejectedValue(error),
    };
    return new WorkspaceService(
      prisma as unknown as PrismaService,
      { isEnabled: () => false } as never,
      { record: jest.fn() } as never,
      { bump: jest.fn() } as never,
      { workspaceName: async (w: { name: string | null }) => w.name } as never,
    );
  };

  it('⚠️ 同時の要求で 2 つ目を作ろうとしたら「すでにある」', async () => {
    const service = make(
      p2002('duplicate key value violates unique constraint "workspaces_one_private_per_owner"', [
        'owner_id',
      ]),
    );
    await expect(service.createWorkspace('u')).rejects.toThrow(ForbiddenException);
  });

  it('ほかの一意制約の違反は、そのまま投げる（「すでにある」にしない）', async () => {
    const other = p2002(
      'duplicate key value violates unique constraint "workspace_members_workspace_id_user_id_key"',
      ['workspace_id', 'user_id'],
    );
    const service = make(other);
    await expect(service.createWorkspace('u')).rejects.toBe(other);
  });
});

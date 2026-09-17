jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  default: {},
  __esModule: true,
}));

import { WorkspaceResolver } from '../../../src/modules/workspace/workspace.resolver';

/**
 * #210: ⚠️ **メンバーの状態は、列挙 `WorkspaceMemberStatus` に収まる値だけを返す。**
 *
 * `status` は GraphQL の列挙で返す。DB の列（`workspace_members.status`）はただの文字列なので、
 * 列挙に無い値が1行でもあると GraphQL が変換できず、**メンバー一覧が丸ごと失敗する**。
 *
 * 以前は知らない値の頭文字を大文字にしてそのまま返していた（`rejected` → `Rejected`）。
 * 知らない値は `Pending` として返す（参加済みと誤って見せない）。
 *
 * 2026-09-12 時点で書き込む値は `accepted` だけ（コードで確認）。
 */
describe('メンバーの状態（#210）', () => {
  const make = (status: string) => {
    const workspaceService: any = {
      getMembers: jest.fn().mockResolvedValue([
        {
          id: 'm1',
          role: 'member',
          status,
          user: { id: 'u1', email: 'u1@example.com', name: 'U1', avatarUrl: null, emailVerified: true },
        },
      ]),
    };
    const resolver = new WorkspaceResolver(
      {} as any, // permission
      workspaceService,
      {} as any, // prisma
      {} as any, // docHistoryService
      {} as any, // manualWorkspaceService
      {} as any, // discovery
    );
    return { resolver };
  };

  it.each([
    ['accepted', 'Accepted'],
    ['pending', 'Pending'],
  ])('%s → %s', async (dbStatus, expected) => {
    const { resolver } = make(dbStatus);
    const [member] = await resolver.members({ id: 'ws-1' } as any, 0, 20);
    expect(member.status).toBe(expected);
  });

  it('⚠️ 知らない値は Pending として返す（列挙に無い値を返さない）', async () => {
    const { resolver } = make('rejected');
    const [member] = await resolver.members({ id: 'ws-1' } as any, 0, 20);
    expect(member.status).toBe('Pending');
  });
});

import { AuthService } from '../../../src/modules/auth/auth.service';
import type { PrismaService } from '../../../src/prisma.service';

/**
 * #77: ADMIN_EMAIL のユーザーがサインアップしても Admin にならない問題の回帰テスト。
 *
 * 起動時のシード（AdminService.seedAdmin）は「その時点で存在するユーザー」しか
 * 対象にできないため、サインアップ時点でも付与する必要がある。
 */
describe('AuthService — ADMIN_EMAIL の付与 (#77)', () => {
  let service: AuthService;
  let prisma: any;
  const originalAdminEmail = process.env.ADMIN_EMAIL;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: 'new-user',
          ...data,
          tokenVersion: 0,
        })),
      },
      // registration_open 未設定 = 開放
      serverSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    service = new AuthService(prisma as unknown as PrismaService, {
      sign: jest.fn().mockReturnValue('signed-token'),
    } as never, { record: jest.fn() } as never);
  });

  afterEach(() => {
    if (originalAdminEmail === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = originalAdminEmail;
  });

  /** prisma.user.create に渡された data */
  const createdWith = () => prisma.user.create.mock.calls[0][0].data;

  it('ADMIN_EMAIL と一致するとサインアップ時点で Admin になる', async () => {
    process.env.ADMIN_EMAIL = 'admin@example.com';

    await service.signUp('admin@example.com', 'password123');

    expect(createdWith().isAdmin).toBe(true);
  });

  it('【重要】大文字小文字違いのアドレスは Admin にならない（権限昇格の防止）', async () => {
    // 第三者が ADMIN_EMAIL の大文字違いでサインアップしても管理者にならないこと。
    // users.email は大文字小文字を区別するため、重複チェックは素通りしてしまう。
    process.env.ADMIN_EMAIL = 'admin@example.com';

    await service.signUp('ADMIN@example.com', 'password123');

    expect(createdWith().isAdmin).toBe(false);
  });

  it('別のアドレスは Admin にならない', async () => {
    process.env.ADMIN_EMAIL = 'admin@example.com';

    await service.signUp('user@example.com', 'password123');

    expect(createdWith().isAdmin).toBe(false);
  });

  it('サインイン経由の自動作成でも付与される', async () => {
    process.env.ADMIN_EMAIL = 'admin@example.com';

    await service.signInOrSignUp(
      'admin@example.com',
      'password123',
      '203.0.113.20',
    );

    expect(createdWith().isAdmin).toBe(true);
  });

  it('ADMIN_EMAIL 未設定なら誰も Admin にならない', async () => {
    delete process.env.ADMIN_EMAIL;

    await service.signUp('anyone@example.com', 'password123');

    expect(createdWith().isAdmin).toBe(false);
  });
});

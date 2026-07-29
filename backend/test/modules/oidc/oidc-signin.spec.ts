import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../../../src/modules/auth/auth.service';
import type { PrismaService } from '../../../src/prisma.service';

/**
 * #89: OIDC サインインでのアカウント突合。
 *
 * ⚠️ 最重要は「**自動作成が無効なら、未登録の利用者を入れない**」こと。
 * SSO は「その IdP でログインできる人」全員が対象になるため、
 * 社外にも開かれた IdP（Google の一般アカウント等）では、
 * 自動作成が有効だと部外者が入れてしまう。
 */
describe('AuthService — OIDC サインイン (#89)', () => {
  let service: AuthService;
  let prisma: any;
  let existingUser: any;
  /** 大文字小文字違いの重複を作りたいテスト用（既定は existingUser のみ） */
  let extraUsers: any[];
  const originalAdminEmail = process.env.ADMIN_EMAIL;

  beforeEach(() => {
    existingUser = null;
    extraUsers = [];

    prisma = {
      user: {
        findUnique: jest.fn().mockImplementation(async () => existingUser),
        // 実装は大文字小文字を無視して探すため、モックも同じ挙動にする
        findMany: jest.fn().mockImplementation(async ({ where }: any) => {
          const wanted = String(where.email.equals).toLowerCase();
          return [existingUser, ...extraUsers]
            .filter(Boolean)
            .filter((u: any) => String(u.email).toLowerCase() === wanted);
        }),
        update: jest.fn().mockImplementation(async ({ data }) => {
          Object.assign(existingUser, data);
          return existingUser;
        }),
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: 'new-user',
          tokenVersion: 0,
          ...data,
        })),
      },
    };

    service = new AuthService(prisma as unknown as PrismaService, {
      sign: jest.fn().mockReturnValue('signed-token'),
    } as never);
  });

  afterEach(() => {
    if (originalAdminEmail === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = originalAdminEmail;
  });

  const signIn = (overrides: Partial<Parameters<AuthService['signInWithOidc']>[0]> = {}) =>
    service.signInWithOidc({
      email: 'user@example.com',
      autoCreateUser: false,
      ip: '203.0.113.40',
      ...overrides,
    });

  describe('既存アカウントとの突合（大文字小文字）', () => {
    it('【重要】大文字を含む既存アカウントにも紐付く', async () => {
      // パスワード認証で作られたアカウントは入力そのままで保存されるが、
      // OIDC 側のメールは小文字化される。完全一致で探すと既存利用者が
      // 締め出される（自動作成 ON なら重複アカウントができる）。
      existingUser = {
        id: 'existing',
        email: 'User@Example.com',
        tokenVersion: 0,
      };

      const result = await signIn({ email: 'user@example.com' });

      expect(result.user.id).toBe('existing');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('【重要】大文字違いの候補が複数ある場合は選ばずに拒否する', async () => {
      // どれが本人か決められない。取り違えは乗っ取りと同じ結果になる。
      existingUser = { id: 'a', email: 'user@example.com', tokenVersion: 0 };
      extraUsers = [{ id: 'b', email: 'User@example.com', tokenVersion: 0 }];

      await expect(signIn({ email: 'user@example.com' })).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('自動作成が無効（既定）', () => {
    it('【重要】未登録の利用者はサインインできない', async () => {
      await expect(signIn()).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('既存の利用者はサインインできる', async () => {
      existingUser = {
        id: 'user-1',
        email: 'user@example.com',
        failedLoginCount: 0,
        lockedUntil: null,
        tokenVersion: 0,
      };

      await expect(signIn()).resolves.toBeDefined();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('自動作成が有効', () => {
    it('未登録の利用者のアカウントを作成する', async () => {
      await expect(signIn({ autoCreateUser: true })).resolves.toBeDefined();

      const created = prisma.user.create.mock.calls[0][0].data;
      expect(created.email).toBe('user@example.com');
      expect(created.emailVerified).toBe(true);
    });

    it('【重要】作成されるアカウントはパスワードを持たない（パスワード認証では入れない）', async () => {
      await service.signInWithOidc({
        email: 'user@example.com',
        autoCreateUser: true,
      });

      expect(prisma.user.create.mock.calls[0][0].data.passwordHash).toBeNull();
    });

    it('IdP から取得した表示名を使う', async () => {
      await service.signInWithOidc({
        email: 'user@example.com',
        name: 'Taro Yamada',
        autoCreateUser: true,
      });

      expect(prisma.user.create.mock.calls[0][0].data.name).toBe('Taro Yamada');
    });

    it('ADMIN_EMAIL と一致すれば Admin になる（#77 と同じ判定）', async () => {
      process.env.ADMIN_EMAIL = 'user@example.com';

      await signIn({ autoCreateUser: true });

      expect(prisma.user.create.mock.calls[0][0].data.isAdmin).toBe(true);
    });
  });

  describe('サインインを拒否する条件', () => {
    it('システムアカウントではサインインできない', async () => {
      existingUser = {
        id: 'system-1',
        email: 'user@example.com',
        isSystem: true,
        failedLoginCount: 0,
        lockedUntil: null,
      };

      await expect(signIn()).rejects.toThrow(UnauthorizedException);
    });

    it('【重要】ロック中のアカウントは SSO でも入れない（#93 の迂回を防ぐ）', async () => {
      existingUser = {
        id: 'user-1',
        email: 'user@example.com',
        failedLoginCount: 0,
        lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
      };

      await expect(signIn()).rejects.toThrow(UnauthorizedException);
    });

    it('ロックが切れていればサインインできる', async () => {
      existingUser = {
        id: 'user-1',
        email: 'user@example.com',
        failedLoginCount: 3,
        lockedUntil: new Date(Date.now() - 1000),
        tokenVersion: 0,
      };

      await expect(signIn()).resolves.toBeDefined();
      // サインイン成功で失敗カウントがリセットされる
      expect(existingUser.failedLoginCount).toBe(0);
      expect(existingUser.lockedUntil).toBeNull();
    });
  });
});

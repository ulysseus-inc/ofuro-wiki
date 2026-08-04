import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../../../src/modules/auth/auth.service';
import { AttackCounterService } from '../../../src/modules/security/attack-counter.service';
import type { PrismaService } from '../../../src/prisma.service';

/**
 * #93: ログイン試行回数制限・アカウントロックアウトの回帰テスト。
 *
 * 仕様:
 *   - 連続10回失敗でロック、15分で自動解除
 *   - 解除時は失敗カウントを 0 に戻す
 *   - ロック中も応答は通常の失敗と同一（アカウントの存在を漏らさない）
 */
const MAX_ATTEMPTS = 10;
const LOCK_MS = 15 * 60 * 1000;

const PASSWORD = 'correct-horse-battery';

describe('AuthService — ログイン試行回数制限とロックアウト (#93)', () => {
  let service: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
  };
  let passwordHash: string;
  let user: any;

  beforeAll(async () => {
    // bcrypt のコストが高いのでハッシュは1度だけ作る
    passwordHash = await bcrypt.hash(PASSWORD, 4);
  });

  beforeEach(() => {
    user = {
      id: 'user-1',
      email: 'user@example.com',
      passwordHash,
      failedLoginCount: 0,
      lockedUntil: null,
      tokenVersion: 0,
    };

    prisma = {
      user: {
        findUnique: jest.fn().mockImplementation(async () => user),
        update: jest.fn().mockImplementation(async ({ data }) => {
          Object.assign(user, data);
          return user;
        }),
      },
    };

    service = new AuthService(prisma as unknown as PrismaService, {
      sign: jest.fn().mockReturnValue('signed-token'),
    } as never, { record: jest.fn() } as never, new AttackCounterService());
  });

  const signInWrong = (ip = '203.0.113.1') =>
    service.signIn(user.email, 'wrong-password', ip);

  /**
   * 失敗の連射は「IP + メールアドレス」単位で 5回/5分に制限される（#93）。
   * ロックアウト（10回）が本来対象とするのは**多数のIPから1アカウントを狙う攻撃**であり、
   * 1つのIPからの連射はレート制限側が止める。そのため、ここでは毎回IPを変えて
   * 分散攻撃を模す。
   */
  const signInWrongFromDistinctIp = (n: number) =>
    signInWrong(`203.0.113.${n + 10}`);

  describe('失敗カウント', () => {
    it('失敗するたびにカウントが増える', async () => {
      await expect(signInWrong()).rejects.toThrow(UnauthorizedException);
      expect(user.failedLoginCount).toBe(1);

      await expect(signInWrong()).rejects.toThrow(UnauthorizedException);
      expect(user.failedLoginCount).toBe(2);
    });

    it('ログイン成功でカウントがリセットされる', async () => {
      await expect(signInWrong()).rejects.toThrow(UnauthorizedException);
      expect(user.failedLoginCount).toBe(1);

      await service.signIn(user.email, PASSWORD);

      expect(user.failedLoginCount).toBe(0);
      expect(user.lockedUntil).toBeNull();
    });
  });

  describe('ロックアウト', () => {
    it('連続10回失敗でロックされる（多数IPからの分散攻撃を模す）', async () => {
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        await expect(signInWrongFromDistinctIp(i)).rejects.toThrow(
          UnauthorizedException,
        );
      }

      expect(user.lockedUntil).toBeInstanceOf(Date);
      const remaining = user.lockedUntil.getTime() - Date.now();
      expect(remaining).toBeGreaterThan(LOCK_MS - 5000);
      expect(remaining).toBeLessThanOrEqual(LOCK_MS);
    });

    it('9回目まではロックされない', async () => {
      for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
        await expect(signInWrongFromDistinctIp(i)).rejects.toThrow(
          UnauthorizedException,
        );
      }

      expect(user.lockedUntil).toBeNull();
      expect(user.failedLoginCount).toBe(MAX_ATTEMPTS - 1);
    });

    it('ロック中は正しいパスワードでも認証されない', async () => {
      user.lockedUntil = new Date(Date.now() + LOCK_MS);

      await expect(service.signIn(user.email, PASSWORD)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('ロック中の応答は通常の失敗と区別できない（アカウント存在を漏らさない）', async () => {
      user.lockedUntil = new Date(Date.now() + LOCK_MS);

      const locked = await service
        .signIn(user.email, PASSWORD)
        .catch((e: Error) => e.message);

      // 存在しないユーザーの場合
      prisma.user.findUnique.mockResolvedValueOnce(null);
      const unknown = await service
        .signIn('nobody@example.com', PASSWORD)
        .catch((e: Error) => e.message);

      expect(locked).toBe(unknown);
      expect(locked).toBe('Invalid credentials');
    });

    it('ロック期限を過ぎれば正しいパスワードで入れる', async () => {
      user.lockedUntil = new Date(Date.now() - 1000); // 期限切れ

      await expect(service.signIn(user.email, PASSWORD)).resolves.toBeDefined();
      expect(user.lockedUntil).toBeNull();
      expect(user.failedLoginCount).toBe(0);
    });

    it('ロック解除後の失敗は1回目として数え直す', async () => {
      user.lockedUntil = new Date(Date.now() - 1000); // 期限切れ
      user.failedLoginCount = 0;

      await expect(signInWrong()).rejects.toThrow(UnauthorizedException);

      expect(user.failedLoginCount).toBe(1);
      expect(user.lockedUntil).toBeNull();
    });
  });

});

/**
 * #93: サインイン経由のアカウント自動作成で、サインアップのレート制限を
 * 迂回できてしまう問題（レビュー指摘）の回帰テスト。
 */
describe('AuthService — アカウント作成の回数制限 (#93)', () => {
  let service: AuthService;
  let prisma: any;

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
      serverSetting: { findUnique: jest.fn().mockResolvedValue(null) }, // 登録オープン
    };

    service = new AuthService(prisma as unknown as PrismaService, {
      sign: jest.fn().mockReturnValue('signed-token'),
    } as never, { record: jest.fn() } as never, new AttackCounterService());
  });

  it('同一IPからは1時間に10件までしか作成できない', async () => {
    for (let i = 0; i < 10; i++) {
      await expect(
        service.signUp(`user${i}@example.com`, 'password123', undefined, '203.0.113.7'),
      ).resolves.toBeDefined();
    }

    await expect(
      service.signUp('user10@example.com', 'password123', undefined, '203.0.113.7'),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('IPが異なれば影響を受けない', async () => {
    for (let i = 0; i < 10; i++) {
      await service.signUp(`a${i}@example.com`, 'password123', undefined, '203.0.113.8');
    }

    await expect(
      service.signUp('b@example.com', 'password123', undefined, '198.51.100.1'),
    ).resolves.toBeDefined();
  });

  it('サインイン経由の自動作成でも同じ上限が効く（迂回できない）', async () => {
    for (let i = 0; i < 10; i++) {
      await service.signInOrSignUp(`auto${i}@example.com`, 'password123', '203.0.113.9');
    }

    await expect(
      service.signInOrSignUp('auto10@example.com', 'password123', '203.0.113.9'),
    ).rejects.toMatchObject({ status: 429 });
  });
});

import { HttpException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../../../src/modules/auth/auth.service';
import { AttackCounterService } from '../../../src/modules/security/attack-counter.service';
import type { PrismaService } from '../../../src/prisma.service';

/**
 * #117 検知条件C の入口が繋がっていることを確認する。
 *
 * 429 は2箇所から出る。
 *
 * | 出どころ | 何を数えた結果か |
 * |---|---|
 * | GqlThrottlerGuard | リクエスト数（60回/5分・300回/分） |
 * | **AuthService.assertSigninAllowed** | **失敗回数（5回/5分）** |
 *
 * ⚠️ **総当たり攻撃で最も多く出るのは後者。**
 * 攻撃者が速度を落とせばガードの制限には達しないため、
 * ここを数えないと条件Cは永久に発火しない。
 *
 * この 429 はパスワード照合の前に投げられるため、
 * 監査ログ（auth.signin.failed）にも残らない。**数える場所はここしかない。**
 */
describe('サインイン失敗の 429 を数える (#117)', () => {
  const IP = '203.0.113.5';
  const EMAIL = 'victim@example.com';
  /** auth.service の SIGNIN_MAX_FAILURES と一致させること。 */
  const MAX_FAILURES = 5;

  let counter: AttackCounterService;
  let service: AuthService;

  beforeEach(() => {
    counter = new AttackCounterService();
    const user = {
      id: '11111111-1111-4111-8111-111111111111',
      email: EMAIL,
      // bcrypt('correct-password') 相当ではない値。照合は必ず失敗する
      passwordHash:
        '$2b$12$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012',
      failedLoginCount: 0,
      lockedUntil: null,
      tokenVersion: 0,
      name: 'Victim',
    };

    const prisma = {
      user: {
        findUnique: jest.fn().mockImplementation(async () => user),
        update: jest.fn().mockImplementation(async ({ data }) => {
          Object.assign(user, data);
          return user;
        }),
      },
    };

    service = new AuthService(
      prisma as unknown as PrismaService,
      { sign: jest.fn().mockReturnValue('token') } as never,
      { record: jest.fn() } as never,
      counter,
    );
  });

  const wrong = () => service.signIn(EMAIL, 'wrong-password', IP);

  it('制限に達するまでは数えない', async () => {
    for (let i = 0; i < MAX_FAILURES; i++) {
      await expect(wrong()).rejects.toThrow(UnauthorizedException);
    }

    // ここまでは認証失敗であって、レート制限ではない
    expect(counter.summarize('throttled', 60).total).toBe(0);
  });

  it('制限に達したあとの 429 を数える', async () => {
    for (let i = 0; i < MAX_FAILURES; i++) {
      await expect(wrong()).rejects.toThrow(UnauthorizedException);
    }

    // 6回目以降は 429
    await expect(wrong()).rejects.toThrow(HttpException);
    await expect(wrong()).rejects.toMatchObject({ status: 429 });

    expect(counter.summarize('throttled', 60).total).toBe(2);
  });

  it('発信元を記録する', async () => {
    for (let i = 0; i < MAX_FAILURES + 1; i++) {
      await expect(wrong()).rejects.toThrow();
    }

    expect(counter.summarize('throttled', 60).ips).toEqual([
      { ip: IP, count: 1 },
    ]);
  });

  /**
   * ⚠️ ここが本質。攻撃者が速度を落としてガードの制限（60回/5分）に達しなくても、
   * 失敗制限の 429 は出続ける。それを数えていれば条件Cは発火する。
   */
  it('ガードの制限に達しない速度でも数え続ける', async () => {
    for (let i = 0; i < MAX_FAILURES; i++) {
      await expect(wrong()).rejects.toThrow(UnauthorizedException);
    }

    // ガードの 60回/5分 には遠く及ばない回数でも、429 は積み上がる
    for (let i = 0; i < 20; i++) {
      await expect(wrong()).rejects.toMatchObject({ status: 429 });
    }

    expect(counter.summarize('throttled', 60).total).toBe(20);
  });
});

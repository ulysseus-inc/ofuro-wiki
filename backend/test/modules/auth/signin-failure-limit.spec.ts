import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../../../src/modules/auth/auth.service';
import { AttackCounterService } from '../../../src/modules/security/attack-counter.service';
import type { PrismaService } from '../../../src/prisma.service';

/**
 * #93: サインインの回数制限は「失敗だけ」を数える。
 *
 * HTTP 層の @Throttle はリクエスト数（成功を含む）を数えるため、複数端末・複数タブ・CI
 * から正当にサインインしただけで締め出される。攻撃者にだけ厳しくするため、
 * 失敗回数に基づく制限をサービス層に持つ。
 */
const MAX_FAILURES = 5;
const PASSWORD = 'correct-horse-battery';
const IP = '203.0.113.30';

describe('AuthService — サインイン失敗の回数制限 (#93)', () => {
  let service: AuthService;
  let prisma: any;
  let user: any;

  beforeEach(async () => {
    user = {
      id: 'user-1',
      email: 'user@example.com',
      passwordHash: await bcrypt.hash(PASSWORD, 4),
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

  const wrong = (ip = IP) => service.signIn(user.email, 'wrong-password', ip);

  it('失敗が上限に達すると 429 を返す', async () => {
    for (let i = 0; i < MAX_FAILURES; i++) {
      await expect(wrong()).rejects.toThrow(UnauthorizedException);
    }

    await expect(wrong()).rejects.toMatchObject({ status: 429 });
  });

  it('【重要】成功したサインインは枠を消費しない', async () => {
    // 正当な利用者が複数端末・複数タブから何度サインインしても締め出されないこと
    for (let i = 0; i < MAX_FAILURES * 3; i++) {
      await expect(service.signIn(user.email, PASSWORD, IP)).resolves.toBeDefined();
    }

    // その後も通常どおり失敗を許容する（枠が減っていない）
    await expect(wrong()).rejects.toThrow(UnauthorizedException);
  });

  it('サインインに成功すると失敗の記録がクリアされる', async () => {
    for (let i = 0; i < MAX_FAILURES - 1; i++) {
      await expect(wrong()).rejects.toThrow(UnauthorizedException);
    }

    await service.signIn(user.email, PASSWORD, IP);

    // クリアされているので、再び上限まで失敗できる
    for (let i = 0; i < MAX_FAILURES; i++) {
      await expect(wrong()).rejects.toThrow(UnauthorizedException);
    }
    await expect(wrong()).rejects.toMatchObject({ status: 429 });
  });

  it('IP が異なれば影響を受けない', async () => {
    for (let i = 0; i < MAX_FAILURES; i++) {
      await expect(wrong()).rejects.toThrow(UnauthorizedException);
    }
    await expect(wrong()).rejects.toMatchObject({ status: 429 });

    // 別IPからは通常どおり（401）
    await expect(wrong('198.51.100.5')).rejects.toThrow(UnauthorizedException);
  });

  it('存在しないアドレスでも同じように数える（アカウントの有無を漏らさない）', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    for (let i = 0; i < MAX_FAILURES; i++) {
      await expect(
        service.signIn('nobody@example.com', 'whatever', IP),
      ).rejects.toThrow(UnauthorizedException);
    }

    await expect(
      service.signIn('nobody@example.com', 'whatever', IP),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('大文字小文字を変えても制限を回避できない', async () => {
    for (let i = 0; i < MAX_FAILURES; i++) {
      await expect(wrong()).rejects.toThrow(UnauthorizedException);
    }

    await expect(
      service.signIn('USER@example.com', 'wrong-password', IP),
    ).rejects.toMatchObject({ status: 429 });
  });
});

/**
 * #93: サインイン経由の自動作成でも、成功時に失敗の記録をクリアする
 * （signIn 側と挙動を揃える）。
 */
describe('AuthService — 自動作成時の失敗記録クリア (#93)', () => {
  let service: AuthService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null), // 未登録
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: 'new-user',
          ...data,
          tokenVersion: 0,
        })),
      },
      serverSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    service = new AuthService(prisma as unknown as PrismaService, {
      sign: jest.fn().mockReturnValue('signed-token'),
    } as never, { record: jest.fn() } as never, new AttackCounterService());
  });

  it('未登録アドレスへの失敗が残っていても、作成成功後はクリアされる', async () => {
    const email = 'newcomer@example.com';

    // アカウント作成前に何度か失敗している状態を作る
    // （登録がクローズされている間の試行など）
    for (let i = 0; i < 3; i++) {
      await expect(service.signIn(email, 'whatever', IP)).rejects.toThrow(
        UnauthorizedException,
      );
    }

    // 自動作成が成立
    await expect(service.signInOrSignUp(email, 'password123', IP)).resolves.toBeDefined();

    // 記録がクリアされているので、再び上限まで失敗できる
    prisma.user.findUnique.mockResolvedValue(null);
    for (let i = 0; i < MAX_FAILURES; i++) {
      await expect(service.signIn(email, 'whatever', IP)).rejects.toThrow(
        UnauthorizedException,
      );
    }
    await expect(service.signIn(email, 'whatever', IP)).rejects.toMatchObject({
      status: 429,
    });
  });
});

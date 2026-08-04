import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../../../src/modules/auth/auth.service';
import { AttackCounterService } from '../../../src/modules/security/attack-counter.service';
import { PrismaService } from '../../../src/prisma.service';

/**
 * 未登録メールへのサインインが同時に届いたときの扱い。
 * 両方が「利用者が存在しない」と判定して作成に進み、片方が一意制約違反になる。
 */
describe('サインインの競合 (#90 の作業中に発見)', () => {
  let prisma: any;
  let service: AuthService;

  const duplicate = Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
  });

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      serverSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      workspace: { create: jest.fn(), findFirst: jest.fn() },
    };
    service = new AuthService(
      prisma as unknown as PrismaService,
      { sign: jest.fn().mockReturnValue('token') } as never,
      { record: jest.fn() } as never,
      new AttackCounterService(),
    );
  });

  it('作成が一意制約で失敗したら、サインインとしてやり直す', async () => {
    // 1回目の照会では居ない → 作成が競合 → 2回目の照会では居る
    const existing = {
      id: 'u1',
      email: 'race@example.com',
      passwordHash: await require('bcrypt').hash('RacePass123!', 4),
      tokenVersion: 0,
      failedLoginCount: 0,
      lockedUntil: null,
      emailVerified: true,
      name: 'race',
      avatarUrl: null,
      createdAt: new Date(),
      isAdmin: false,
    };
    prisma.user.findUnique
      .mockResolvedValueOnce(null) // signInOrSignUp の照会
      .mockResolvedValueOnce(null) // signUp の重複確認（この間に他方が作る）
      .mockResolvedValue(existing); // 作成失敗後のやり直し
    prisma.user.create.mockRejectedValue(duplicate);

    const result = await service.signInOrSignUp(
      'race@example.com',
      'RacePass123!',
      '10.0.0.1',
    );

    expect(result).toBeDefined();
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
  });

  // 競合の後でもパスワードが違えば通してはいけない
  it('やり直したサインインでパスワードが違えば 401', async () => {
    const existing = {
      id: 'u1',
      email: 'race@example.com',
      passwordHash: await require('bcrypt').hash('OtherPass123!', 4),
      tokenVersion: 0,
      failedLoginCount: 0,
      lockedUntil: null,
      emailVerified: true,
      name: 'race',
      avatarUrl: null,
      createdAt: new Date(),
      isAdmin: false,
    };
    prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(existing);
    prisma.user.create.mockRejectedValue(duplicate);

    await expect(
      service.signInOrSignUp('race@example.com', 'RacePass123!', '10.0.0.1'),
    ).rejects.toThrow(UnauthorizedException);
  });

  // 割り込みが重複確認より前だと 409 になり、利用者の存在も漏れる
  it('重複確認で弾かれた場合も、サインインとしてやり直す', async () => {
    const existing = {
      id: 'u1',
      email: 'race@example.com',
      passwordHash: await require('bcrypt').hash('RacePass123!', 4),
      tokenVersion: 0,
      failedLoginCount: 0,
      lockedUntil: null,
      emailVerified: true,
      name: 'race',
      avatarUrl: null,
      createdAt: new Date(),
      isAdmin: false,
    };
    // signInOrSignUp の照会では居ないが、signUp の重複確認では居る
    prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue(existing);

    const result = await service.signInOrSignUp(
      'race@example.com',
      'RacePass123!',
      '10.0.0.1',
    );

    expect(result).toBeDefined();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  // 一意制約以外の失敗を握りつぶすと、本当の障害が見えなくなる
  it('一意制約以外の例外はそのまま投げる', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockRejectedValue(new Error('DB down'));

    await expect(
      service.signInOrSignUp('x@example.com', 'RacePass123!', '10.0.0.1'),
    ).rejects.toThrow('DB down');
  });
});

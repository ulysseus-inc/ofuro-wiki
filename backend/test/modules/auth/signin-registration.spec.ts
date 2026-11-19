import { HttpException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../../../src/modules/auth/auth.service';
import { AttackCounterService } from '../../../src/modules/security/attack-counter.service';
import { INVITE_LINK_EMAIL } from '../../../src/modules/workspace/invitation-rule';
import type { PrismaService } from '../../../src/prisma.service';

/** M3: アカウントが無い人を作るか（docs/signin-registration.md 3・4 章） */
describe('サインインと登録 (#293・#294・#195)', () => {
  let service: AuthService;
  let prisma: any;
  const original = {
    root: process.env.ROOT_EMAIL,
    legacy: process.env.ADMIN_EMAIL,
    autoCreate: process.env.AUTH_SIGNIN_AUTOCREATE,
  };

  const PASSWORD = 'Passw0rd!x';
  const INVITE_ID = '11111111-1111-4111-8111-111111111111';
  const HOUR = 60 * 60 * 1000;

  /** 未定義は消す（undefined を代入すると文字列 "undefined" になる） */
  function setEnv(name: string, value: string | undefined) {
    if (value === undefined) {
      delete process.env[name];
      return;
    }
    process.env[name] = value;
  }

  /** 新規登録を閉じる（管理画面の registration_open=false） */
  function closeRegistration() {
    prisma.serverSetting.findUnique.mockResolvedValue({ value: 'false' });
  }

  function emailInvite(email: string, expireTime: Date | null = null) {
    return { id: INVITE_ID, workspaceId: 'ws1', email, role: 'member', expireTime };
  }

  /** 例外の name（画面はこれで「登録されていません」を見分ける） */
  async function errorOf(p: Promise<unknown>) {
    try {
      await p;
    } catch (e) {
      return e as HttpException;
    }
    throw new Error('例外が出なかった');
  }

  beforeEach(() => {
    setEnv('ROOT_EMAIL', 'root@example.com');
    setEnv('ADMIN_EMAIL', undefined);
    setEnv('AUTH_SIGNIN_AUTOCREATE', undefined);
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: 'new-user',
          ...data,
          tokenVersion: 0,
        })),
      },
      serverSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      invitation: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    service = new AuthService(
      prisma as unknown as PrismaService,
      { sign: jest.fn().mockReturnValue('signed-token') } as never,
      { record: jest.fn() } as never,
      new AttackCounterService(),
    );
  });

  afterEach(() => {
    setEnv('ROOT_EMAIL', original.root);
    setEnv('ADMIN_EMAIL', original.legacy);
    setEnv('AUTH_SIGNIN_AUTOCREATE', original.autoCreate);
    jest.useRealTimers();
  });

  describe('作る前に確認する (#293)', () => {
    it('【重要】create が無ければ作らず、USER_NOT_FOUND を返す', async () => {
      const e = await errorOf(
        service.signInOrSignUp('new@example.com', PASSWORD, '10.0.0.1'),
      );

      expect(e).toBeInstanceOf(UnauthorizedException);
      expect((e.getResponse() as any).name).toBe('USER_NOT_FOUND');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('create: true なら作ってサインインする', async () => {
      const result = await service.signInOrSignUp(
        'new@example.com',
        PASSWORD,
        '10.0.0.1',
        { create: true },
      );

      expect(result.user.email).toBe('new@example.com');
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
    });

    it('【重要】作れない環境では、未登録も誤パスワードと同じ 401（存在を漏らさない）', async () => {
      closeRegistration();

      const e = await errorOf(
        service.signInOrSignUp('new@example.com', PASSWORD, '10.0.0.1', {
          create: true,
        }),
      );

      expect(e).toBeInstanceOf(UnauthorizedException);
      expect((e.getResponse() as any).name).toBeUndefined();
      expect(e.message).toBe('Invalid credentials');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('AUTH_SIGNIN_AUTOCREATE=false でも同じ 401', async () => {
      setEnv('AUTH_SIGNIN_AUTOCREATE', 'false');

      const e = await errorOf(
        service.signInOrSignUp('new@example.com', PASSWORD, '10.0.0.1'),
      );

      expect(e.message).toBe('Invalid credentials');
    });

    it('【重要】「登録されていません」は IP あたり 1 時間 10 件まで。超えたら 429', async () => {
      for (let i = 0; i < 10; i++) {
        const e = await errorOf(
          service.signInOrSignUp(`probe${i}@example.com`, PASSWORD, '10.0.0.9'),
        );
        expect((e.getResponse() as any).name).toBe('USER_NOT_FOUND');
      }

      const e = await errorOf(
        service.signInOrSignUp('probe10@example.com', PASSWORD, '10.0.0.9'),
      );
      expect(e.getStatus()).toBe(429);

      // 別の IP は数えない
      const other = await errorOf(
        service.signInOrSignUp('probe11@example.com', PASSWORD, '10.0.0.10'),
      );
      expect((other.getResponse() as any).name).toBe('USER_NOT_FOUND');
    });

    it('1 時間たてば、また答える', async () => {
      jest.useFakeTimers({ now: new Date('2026-11-06T00:00:00Z') });
      for (let i = 0; i < 10; i++) {
        await errorOf(
          service.signInOrSignUp(`probe${i}@example.com`, PASSWORD, '10.0.0.9'),
        );
      }

      jest.setSystemTime(new Date(Date.now() + HOUR + 1));

      const e = await errorOf(
        service.signInOrSignUp('later@example.com', PASSWORD, '10.0.0.9'),
      );
      expect((e.getResponse() as any).name).toBe('USER_NOT_FOUND');
    });
  });

  describe('root は閉じた環境でも作れる (#294)', () => {
    it('新規登録が閉でも、root は確認のあと作れて、システム管理者になる', async () => {
      closeRegistration();
      setEnv('AUTH_SIGNIN_AUTOCREATE', 'false');

      const e = await errorOf(
        service.signInOrSignUp('root@example.com', PASSWORD, '10.0.0.1'),
      );
      expect((e.getResponse() as any).name).toBe('USER_NOT_FOUND');

      await service.signInOrSignUp('root@example.com', PASSWORD, '10.0.0.1', {
        create: true,
      });
      expect(prisma.user.create.mock.calls[0][0].data.isAdmin).toBe(true);
    });

    it('【重要】大文字小文字違いは root として扱わない（閉じた環境では作れない）', async () => {
      closeRegistration();

      const e = await errorOf(
        service.signInOrSignUp('ROOT@example.com', PASSWORD, '10.0.0.1', {
          create: true,
        }),
      );

      expect(e.message).toBe('Invalid credentials');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('招待された未登録の人 (#195)', () => {
    beforeEach(() => closeRegistration());

    it('閉じた環境でも、本人宛てのメール招待があれば作れる', async () => {
      prisma.invitation.findUnique.mockResolvedValue(emailInvite('guest@example.com'));

      await service.signInOrSignUp('guest@example.com', PASSWORD, '10.0.0.1', {
        create: true,
        inviteId: INVITE_ID,
      });

      expect(prisma.user.create).toHaveBeenCalledTimes(1);
    });

    it('大文字小文字が違っても宛先は一致とみなす（judgeInvitation と同じ）', async () => {
      prisma.invitation.findUnique.mockResolvedValue(emailInvite('Guest@Example.com'));

      await service.signInOrSignUp('guest@example.com', PASSWORD, '10.0.0.1', {
        create: true,
        inviteId: INVITE_ID,
      });

      expect(prisma.user.create).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['【重要】招待リンク（誰でも使える）', emailInvite(INVITE_LINK_EMAIL)],
      ['【重要】宛先が違う', emailInvite('other@example.com')],
      ['期限切れ', emailInvite('guest@example.com', new Date('2020-01-01'))],
      ['招待が無い', null],
    ])('%s では作れない', async (_label, invitation) => {
      prisma.invitation.findUnique.mockResolvedValue(invitation);

      const e = await errorOf(
        service.signInOrSignUp('guest@example.com', PASSWORD, '10.0.0.1', {
          create: true,
          inviteId: INVITE_ID,
        }),
      );

      expect(e.message).toBe('Invalid credentials');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });
});

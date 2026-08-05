import { AuthService } from '../../../src/modules/auth/auth.service';
import { AttackCounterService } from '../../../src/modules/security/attack-counter.service';
import type { PrismaService } from '../../../src/prisma.service';

/**
 * #90: **アカウントが増えたら、経路によらず必ず監査ログに残る。**
 *
 * ⚠️ この観点が抜けていたため、**パスワードによるサインアップだけ記録が無かった**
 * （2026-08-05・公開本番で発覚）。
 *
 * 作成経路は3つあり、記録の実装場所がそれぞれ違う。
 *
 * | 経路 | 記録する場所 |
 * |---|---|
 * | Admin が管理画面から作成 | Interceptor（GraphQL mutation） |
 * | SSO の自動作成 | AuthService に明示 |
 * | **パスワードのサインアップ** | **AuthService に明示**（← 抜けていた） |
 *
 * REST（`/api/auth/sign-up`・`/api/auth/sign-in`）は GraphQL の mutation 名で引く
 * Interceptor では拾えない。**実装場所が分かれている以上、横断で確認する必要がある。**
 *
 * サインアップを開放した公開サーバーでは**誰でもアカウントを作れる**。
 * そこで痕跡が残らないのは、監査ログとして成立していない。
 */
describe('アカウント作成が経路によらず記録される (#90)', () => {
  const IP = '198.51.100.7';
  let audit: { record: jest.Mock };
  let service: AuthService;
  let created: any;

  beforeEach(() => {
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    created = null;

    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          created = {
            id: '22222222-2222-4222-8222-222222222222',
            ...data,
          };
          return created;
        }),
      },
      serverSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      workspace: { create: jest.fn(), findFirst: jest.fn() },
    };

    service = new AuthService(
      prisma as unknown as PrismaService,
      { sign: jest.fn().mockReturnValue('token') } as never,
      audit as never,
      new AttackCounterService(),
    );
  });

  /** 記録された action の一覧。 */
  const actions = () => audit.record.mock.calls.map((c) => c[0].action);
  /** 指定 action の記録を取り出す。 */
  const entryOf = (action: string) =>
    audit.record.mock.calls.map((c) => c[0]).find((e) => e.action === action);

  describe('サインアップ画面からの登録', () => {
    it('user.create を記録する', async () => {
      await service.signUp('new@example.com', 'StrongPass123!', undefined, IP);

      expect(actions()).toContain('user.create');
      const entry = entryOf('user.create');
      expect(entry.targetName).toBe('new@example.com');
      expect(entry.ip).toBe(IP);
      expect(entry.detail.meta.method).toBe('password');
      // 本人が明示的に登録した
      expect(entry.detail.meta.autoCreated).toBe(false);
    });

    it('最初のサインインも記録する', async () => {
      await service.signUp('new2@example.com', 'StrongPass123!', undefined, IP);

      expect(actions()).toContain('auth.signin');
      expect(entryOf('auth.signin').detail.meta.firstSignin).toBe(true);
    });

    // #77: Admin として作られたなら、その事実が後から追えること
    it('Admin として作られたことを残す', async () => {
      const original = process.env.ADMIN_EMAIL;
      process.env.ADMIN_EMAIL = 'boss@example.com';

      await service.signUp('boss@example.com', 'StrongPass123!', undefined, IP);

      expect(entryOf('user.create').detail.meta.isAdmin).toBe(true);
      process.env.ADMIN_EMAIL = original;
    });
  });

  /**
   * ⚠️ ここが実運用で最も踏まれる。
   * 自動作成が有効だと、**サインインを1回試みるだけでアカウントが増える。**
   * 「意図した登録」と区別できるよう、入口を残す必要がある。
   */
  describe('サインイン経由の自動作成', () => {
    it('自動作成であることを区別して記録する', async () => {
      await service.signInOrSignUp('auto@example.com', 'StrongPass123!', IP);

      const entry = entryOf('user.create');
      expect(entry).toBeDefined();
      expect(entry.detail.meta.method).toBe('password');
      // サインアップ画面からの登録と区別する
      expect(entry.detail.meta.autoCreated).toBe(true);
    });
  });
});

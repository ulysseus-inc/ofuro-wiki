import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../../../src/modules/auth/auth.service';
import { AttackCounterService } from '../../../src/modules/security/attack-counter.service';
import type { PrismaService } from '../../../src/prisma.service';

/**
 * #117: **実際の入口（signInOrSignUp）**を通して、検知の材料が残ることを確認する。
 *
 * ⚠️ **この観点のテストが無かったために、本番構成で条件Dが完全に死んでいた。**
 *
 * サインインの入口は `signInOrSignUp` であり、`signIn` ではない。
 * 未登録アドレスは **`AUTH_SIGNIN_AUTOCREATE=false` または登録クローズ時に
 * `signIn` へ到達しないまま終わる**。記録をそちらにだけ置いていたため、
 * 「入口が繋がっているか」を確かめたつもりで**別の関数を見ていた**。
 *
 * 開発環境は自動作成が有効でこの経路を通らず、**デモ環境へ出すまで気づけなかった。**
 *
 * したがって、ここでは必ず `signInOrSignUp` を呼ぶ。
 */
describe('サインインの入口から検知の材料が残る (#117)', () => {
  // ⚠️ 監査ログの重複抑止（60秒・`IP + 理由`）はモジュール全体で共有される。
  // 同じ IP を使い回すと、先に走ったテストが窓を消費して後続の記録が消える。
  // テストごとに別の IP を使う。
  let ipSeq = 0;
  const nextIp = () => `203.0.113.${++ipSeq}`;
  let counter: AttackCounterService;
  let audit: { record: jest.Mock };

  /** 利用者が存在しない状態のサービスを作る。 */
  const makeService = (env: Record<string, string | undefined>) => {
    counter = new AttackCounterService();
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      serverSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }

    return new AuthService(
      prisma as unknown as PrismaService,
      { sign: jest.fn() } as never,
      audit as never,
      counter,
    );
  };

  afterEach(() => {
    delete process.env.AUTH_SIGNIN_AUTOCREATE;
  });

  /**
   * ⚠️ ここが本番の推奨構成（デモ・公開本番はこれ）。
   * 自動作成を切ると、未登録アドレスは signIn へ到達せずに 401 で終わる。
   */
  describe('AUTH_SIGNIN_AUTOCREATE=false（本番の推奨構成）', () => {
    it('未登録アドレスへの試行をカウンタに数える（条件D）', async () => {
      const service = makeService({ AUTH_SIGNIN_AUTOCREATE: 'false' });

      await expect(
        service.signInOrSignUp('ghost@example.com', 'wrong', nextIp()),
      ).rejects.toThrow(UnauthorizedException);

      expect(counter.summarize('unknownEmail', 60).total).toBe(1);
    });

    it('未登録アドレスへの試行を監査ログに記録する', async () => {
      const service = makeService({ AUTH_SIGNIN_AUTOCREATE: 'false' });

      await expect(
        service.signInOrSignUp('ghost2@example.com', 'wrong', nextIp()),
      ).rejects.toThrow(UnauthorizedException);

      const entry = audit.record.mock.calls[0]?.[0];
      expect(entry?.action).toBe('auth.signin.failed');
      expect(entry?.detail?.meta?.reason).toBe('unknown_email');
      // 誰を騙ろうとしたかを残す（存在しないアドレスでも）
      expect(entry?.actor?.email).toBe('ghost2@example.com');
    });

    it('アドレスを変えた連続試行を全件数える（列挙の検知）', async () => {
      const service = makeService({ AUTH_SIGNIN_AUTOCREATE: 'false' });

      const ip = nextIp();
      for (let i = 0; i < 8; i++) {
        await expect(
          service.signInOrSignUp(`enum${i}@example.com`, 'wrong', ip),
        ).rejects.toThrow(UnauthorizedException);
      }

      // 監査ログは重複抑止で減るが、カウンタは全件でなければならない
      expect(counter.summarize('unknownEmail', 60).total).toBe(8);
    }, 30_000);

    it('発信元ごとに数える', async () => {
      const service = makeService({ AUTH_SIGNIN_AUTOCREATE: 'false' });

      await expect(
        service.signInOrSignUp('a@example.com', 'x', '203.0.113.200'),
      ).rejects.toThrow();
      await expect(
        service.signInOrSignUp('b@example.com', 'x', '198.51.100.9'),
      ).rejects.toThrow();

      expect(counter.summarize('unknownEmail', 60).ips).toEqual(
        expect.arrayContaining([
          { ip: '203.0.113.200', count: 1 },
          { ip: '198.51.100.9', count: 1 },
        ]),
      );
    }, 15_000);
  });
});

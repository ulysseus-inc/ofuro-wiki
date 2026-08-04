import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../../../src/modules/auth/auth.service';
import { AttackCounterService } from '../../../src/modules/security/attack-counter.service';
import type { PrismaService } from '../../../src/prisma.service';

/**
 * #117 検知条件D の入口が繋がっていることを確認する。
 *
 * ⚠️ **ここが切れると条件Dは永久に発火しない。** しかも
 * 「攻撃が無かった」のと区別がつかず、誰も気づかないまま運用が続く。
 *
 * 背景（docs/intrusion-detection.md 2.2）:
 * 存在しないアドレスへの試行は、監査ログ側で `IP + 理由` の重複抑止が
 * かかっており、**1つの IP から1分に1件しか残らない**。
 * そのため監査ログを数えても列挙は検知できず、カウンタで全件数える必要がある。
 */
describe('存在しないアドレスへの試行を数える (#117)', () => {
  let counter: AttackCounterService;
  let service: AuthService;

  const IP = '203.0.113.5';

  beforeEach(() => {
    counter = new AttackCounterService();
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    service = new AuthService(
      prisma as unknown as PrismaService,
      { sign: jest.fn() } as never,
      { record: jest.fn() } as never,
      counter,
    );
  });

  const attempt = (email: string, ip = IP) =>
    expect(service.signIn(email, 'whatever', ip)).rejects.toThrow(
      UnauthorizedException,
    );

  it('未登録アドレスへの試行を1件ずつ数える', async () => {
    await attempt('nobody@example.com');
    await attempt('ghost@example.com');

    expect(counter.summarize('unknownEmail', 60).total).toBe(2);
  });

  /**
   * ⚠️ ここが本質。監査ログの重複抑止は `IP + 理由` を鍵にしており、
   * **同じ IP から1分以内なら、アドレスが違っても1件しか記録されない。**
   * カウンタは抑止の外にあるため、全件数えられていなければならない。
   */
  // 未登録アドレスでもタイミング攻撃対策のダミー照合(bcrypt)が走るため、
  // 1回あたり数百ミリ秒かかる。既定の5秒では足りない
  it(
    '同一IPから短時間に多数のアドレスを試されても全件数える',
    async () => {
      for (let i = 0; i < 10; i++) {
        await attempt(`user${i}@example.com`);
      }

      const summary = counter.summarize('unknownEmail', 60);
      // 監査ログ側の抑止が効いていれば、そちらには1件しか残らない。
      // カウンタは全件でなければならない
      expect(summary.total).toBe(10);
      expect(summary.ips).toEqual([{ ip: IP, count: 10 }]);
    },
    30_000,
  );

  it('発信元ごとに内訳を持つ', async () => {
    await attempt('a@example.com', '203.0.113.5');
    await attempt('b@example.com', '203.0.113.5');
    await attempt('c@example.com', '198.51.100.9');

    expect(counter.summarize('unknownEmail', 60).ips).toEqual([
      { ip: '203.0.113.5', count: 2 },
      { ip: '198.51.100.9', count: 1 },
    ]);
  });
});

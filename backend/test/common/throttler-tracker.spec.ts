import { GqlThrottlerGuard } from '../../src/common/guards/throttler.guard';

/**
 * #93: レート制限の集計単位（トラッカー）の回帰テスト。
 *
 * サインインだけは「IP + メールアドレス」で数える。IP だけで数えると、
 * NAT 配下の会社（全社員が同一のグローバルIP）で1人の打ち間違いが
 * 全員を締め出してしまうため。
 *
 * getTracker は `this` を使わないため、prototype から直接呼び出して検証する。
 */
const getTracker = (req: Record<string, unknown>): Promise<string> =>
  (GqlThrottlerGuard.prototype as any).getTracker.call(null, req);

describe('GqlThrottlerGuard.getTracker (#93)', () => {
  it('サインインは IP + メールアドレスで数える', async () => {
    await expect(
      getTracker({
        ip: '203.0.113.1',
        originalUrl: '/api/auth/sign-in',
        body: { email: 'user@example.com' },
      }),
    ).resolves.toBe('203.0.113.1:user@example.com');
  });

  it('メールアドレスの大文字小文字で枠を分けない（回避防止）', async () => {
    await expect(
      getTracker({
        ip: '203.0.113.1',
        originalUrl: '/api/auth/sign-in',
        body: { email: 'USER@Example.com' },
      }),
    ).resolves.toBe('203.0.113.1:user@example.com');
  });

  it('サインイン以外は IP のみで数える', async () => {
    await expect(
      getTracker({
        ip: '203.0.113.1',
        originalUrl: '/api/auth/sign-up',
        body: { email: 'user@example.com' },
      }),
    ).resolves.toBe('203.0.113.1');
  });

  it('メールアドレスが無い場合は IP のみ', async () => {
    await expect(
      getTracker({ ip: '203.0.113.1', originalUrl: '/api/auth/sign-in', body: {} }),
    ).resolves.toBe('203.0.113.1');
  });

  it('req.ip が無い経路（GraphQL / WebSocket）でも落ちない', async () => {
    await expect(getTracker({})).resolves.toBe('0.0.0.0');
  });
});

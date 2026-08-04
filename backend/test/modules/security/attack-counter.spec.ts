import { AttackCounterService } from '../../../src/modules/security/attack-counter.service';

/**
 * #117: 検知条件C・D のカウンタ（docs/intrusion-detection.md 2.1）。
 */
describe('AttackCounterService (#117)', () => {
  let counter: AttackCounterService;

  beforeEach(() => {
    counter = new AttackCounterService();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-04T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('件数と発信元を集計する', () => {
    counter.recordThrottled('203.0.113.5');
    counter.recordThrottled('203.0.113.5');
    counter.recordThrottled('198.51.100.9');

    const s = counter.summarize('throttled', 60);
    expect(s.total).toBe(3);
    // 件数の多い順
    expect(s.ips).toEqual([
      { ip: '203.0.113.5', count: 2 },
      { ip: '198.51.100.9', count: 1 },
    ]);
  });

  it('種別ごとに独立して数える', () => {
    counter.recordThrottled('203.0.113.5');
    counter.recordUnknownEmail('203.0.113.5');
    counter.recordUnknownEmail('203.0.113.5');

    expect(counter.summarize('throttled', 60).total).toBe(1);
    expect(counter.summarize('unknownEmail', 60).total).toBe(2);
  });

  it('一度も計上が無ければ 0 件', () => {
    const s = counter.summarize('throttled', 60);
    expect(s.total).toBe(0);
    expect(s.ips).toEqual([]);
    expect(s.lastEventAt).toBeNull();
  });

  // ⚠️ 窓から外れた事象を数え続けると、攻撃が止まっても検知が解除されない
  it('窓より古い事象は数えない', () => {
    counter.recordThrottled('203.0.113.5');

    jest.setSystemTime(new Date('2026-08-04T13:30:00.000Z')); // 90分後
    expect(counter.summarize('throttled', 60).total).toBe(0);
  });

  it('窓の内側は数える', () => {
    counter.recordThrottled('203.0.113.5');

    jest.setSystemTime(new Date('2026-08-04T12:30:00.000Z')); // 30分後
    expect(counter.summarize('throttled', 60).total).toBe(1);
  });

  // 終息判定（4.0）はこの値で「直近N分に事象が無い」を判断する
  it('最後に計上した時刻を返す', () => {
    counter.recordThrottled('203.0.113.5');
    jest.setSystemTime(new Date('2026-08-04T12:20:00.000Z'));
    counter.recordThrottled('203.0.113.5');

    const s = counter.summarize('throttled', 60);
    // 分単位に丸められる
    expect(s.lastEventAt?.toISOString()).toBe('2026-08-04T12:20:00.000Z');
  });

  it('静穏時間を過ぎると、その窓では 0 件になる', () => {
    counter.recordUnknownEmail('203.0.113.5');

    jest.setSystemTime(new Date('2026-08-04T12:40:00.000Z')); // 40分後
    expect(counter.summarize('unknownEmail', 30).total).toBe(0);
    // 60分窓ではまだ見える（検知は続いている）
    expect(counter.summarize('unknownEmail', 60).total).toBe(1);
  });

  it('IP 不明でも数える', () => {
    counter.recordThrottled(undefined);
    counter.recordThrottled('');

    const s = counter.summarize('throttled', 60);
    expect(s.total).toBe(2);
    expect(s.ips).toEqual([{ ip: 'unknown', count: 2 }]);
  });

  /**
   * ⚠️ 攻撃者が送るリクエスト量に比例してメモリが増えてはいけない。
   * IP を無限に変えられても、合計は正しく保ちつつ内訳だけを落とす。
   */
  it('IP を大量に変えられても合計は正しい', () => {
    for (let i = 0; i < 1500; i++) {
      counter.recordThrottled(`10.0.${Math.floor(i / 256)}.${i % 256}`);
    }

    const s = counter.summarize('throttled', 60);
    expect(s.total).toBe(1500);
    // 内訳は上限まで
    expect(s.ips.length).toBeLessThanOrEqual(1000);
  });

  it('保持期間は窓と静穏時間の長い方に合わせる', () => {
    counter.setRetention(60, 120);
    counter.recordThrottled('203.0.113.5');

    jest.setSystemTime(new Date('2026-08-04T13:30:00.000Z')); // 90分後
    // 保持は 125 分なので、まだ捨てられていない
    expect(counter.summarize('throttled', 120).total).toBe(1);
  });
});

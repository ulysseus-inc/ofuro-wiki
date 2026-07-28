import { parseTrustProxy } from '../../src/common/trust-proxy';

/**
 * #93: `TRUST_PROXY=true` のような自然な指定で起動時にクラッシュしていた
 * （express が文字列を IP/サブネットのリストとして解釈するため）回帰テスト。
 */
describe('parseTrustProxy (#93)', () => {
  it('真偽値らしき指定は 1 段として扱う', () => {
    // express の `true`（すべてのプロキシを信頼）は X-Forwarded-For を
    // 無条件に信用するため使わない
    for (const v of ['true', 'TRUE', 'yes', 'on', ' true ']) {
      expect(parseTrustProxy(v)).toBe(1);
    }
  });

  it('無効化を意図した指定は false になる', () => {
    for (const v of ['false', 'no', 'off', '0']) {
      expect(parseTrustProxy(v)).toBe(false);
    }
  });

  it('段数はそのまま数値になる', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('2')).toBe(2);
  });

  it('express の指定子や IP リストはそのまま渡す', () => {
    expect(parseTrustProxy('loopback')).toBe('loopback');
    expect(parseTrustProxy('10.0.0.0/8, 192.168.0.0/16')).toBe(
      '10.0.0.0/8, 192.168.0.0/16',
    );
  });
});

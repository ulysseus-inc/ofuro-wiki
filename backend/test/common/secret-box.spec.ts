import { decryptSecret, encryptSecret } from '../../src/common/secret-box';

/**
 * #89: 管理画面から保存する秘密情報（OIDC クライアントシークレット等）の暗号化。
 *
 * DB 単体（バックアップZIP・pg_dump）が漏れても復号できないことが目的。
 */
describe('secret-box (#89)', () => {
  const original = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-jwt-secret-value-for-unit-test-0123456789';
  });

  afterEach(() => {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  });

  it('暗号化して復号すると元に戻る', () => {
    const plain = 'super-secret-client-value';
    const encrypted = encryptSecret(plain);

    expect(encrypted).not.toBe(plain);
    expect(decryptSecret(encrypted)).toBe(plain);
  });

  it('【重要】暗号文に平文が現れない', () => {
    const plain = 'GOCSPX-abcdefghijklmnop';
    const encrypted = encryptSecret(plain);

    expect(encrypted).not.toContain(plain);
    expect(encrypted).not.toContain('GOCSPX');
  });

  it('同じ値でも毎回異なる暗号文になる（IV がランダム）', () => {
    const plain = 'same-value';
    expect(encryptSecret(plain)).not.toBe(encryptSecret(plain));
  });

  it('空文字はそのまま（未設定を維持する）', () => {
    expect(encryptSecret('')).toBe('');
    expect(decryptSecret('')).toBeNull();
    expect(decryptSecret(null)).toBeNull();
  });

  it('暗号化されていない値はそのまま返す（旧データ・手動投入との互換）', () => {
    expect(decryptSecret('plain-legacy-value')).toBe('plain-legacy-value');
  });

  it('【重要】JWT_SECRET が変わると復号できず null になる（未設定扱い）', () => {
    const encrypted = encryptSecret('secret-value');

    process.env.JWT_SECRET = 'a-completely-different-secret-0123456789abcd';

    expect(decryptSecret(encrypted)).toBeNull();
  });

  it('改ざんされた暗号文は復号できない（GCM の認証タグ）', () => {
    const encrypted = encryptSecret('secret-value');
    // 末尾を書き換える
    const tampered = encrypted.slice(0, -4) + 'AAAA';

    expect(decryptSecret(tampered)).toBeNull();
  });

  it('JWT_SECRET 未設定では暗号化できない（起動時に検出される）', () => {
    delete process.env.JWT_SECRET;
    expect(() => encryptSecret('value')).toThrow(/JWT_SECRET/);
  });
});

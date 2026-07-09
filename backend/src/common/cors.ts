/**
 * ALLOWED_ORIGINS 環境変数から CORS の origin 設定を導出する共通ヘルパー。
 * - 未設定 or "*"     → true（リクエストオリジンを反射。主に同一オリジン配信/開発向け）
 * - "https://a.com"  → 明示オリジンのみ許可
 * - "a.com,b.com"    → カンマ区切りで複数許可
 *
 * 反射(true) + credentials はブラウザ側で資格情報の読み取りを許すため、
 * 本番では ALLOWED_ORIGINS を明示指定することを推奨する（起動時に警告を出す）。
 */
export function parseAllowedOrigins(): true | string[] {
  const raw = (process.env.ALLOWED_ORIGINS ?? '*').trim();
  if (raw === '*' || raw === '') {
    return true;
  }
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/** 本番でワイルドカード(反射)になっている場合に true を返す（警告用）。 */
export function isWildcardOriginInProduction(): boolean {
  return (
    process.env.NODE_ENV === 'production' && parseAllowedOrigins() === true
  );
}

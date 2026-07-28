/**
 * #93: `TRUST_PROXY` 環境変数を express の `trust proxy` 設定値に変換する。
 *
 * express は文字列を「IP / サブネットのカンマ区切りリスト」として解釈するため、
 * `TRUST_PROXY=true` のような自然な指定をそのまま渡すと
 * `invalid IP address: true` で**起動時にクラッシュする**。
 * 真偽値らしき文字列を明示的に吸収する。
 */
export function parseTrustProxy(raw: string): boolean | number | string {
  const value = raw.trim();
  const lower = value.toLowerCase();

  // 無効化を意図した指定
  if (['false', 'no', 'off', '0'].includes(lower)) return false;

  // 有効化を意図した指定。express の `true`（すべてのプロキシを信頼）ではなく
  // 1 段として扱う。`true` は X-Forwarded-For を無条件に信用するため危険。
  if (['true', 'yes', 'on'].includes(lower)) return 1;

  // 段数指定
  const hops = Number(value);
  if (Number.isFinite(hops)) return hops;

  // 'loopback' 等の指定子、または IP / CIDR のリスト
  return value;
}

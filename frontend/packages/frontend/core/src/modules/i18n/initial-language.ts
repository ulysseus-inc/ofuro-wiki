/**
 * #245: 最初に見せる言語を決める。
 *
 * ⚠️ **重い依存を持ち込まないこと。** ここだけを検査できるように、
 * i18n の実体（lit / component を引き込む）から切り離してある。
 */

/**
 * @param stored これまでに保存された設定（`i18n_lng`）。初回は undefined
 * @param preferred ブラウザの希望する言語（`navigator.languages`）
 * @param supported 対応している言語の一覧
 *
 * ⚠️ **保存された設定が最優先。** 一度でも選んだ人の画面を、
 * こちらの都合で変えない。
 */
export function pickInitialLanguage(
  stored: string | undefined,
  preferred: readonly string[],
  supported: readonly string[]
): string {
  if (stored && supported.includes(stored)) return stored;

  for (const want of preferred) {
    // 完全一致（ja / zh-Hans）
    const exact = supported.find(s => s.toLowerCase() === want.toLowerCase());
    if (exact) return exact;

    // 地域つき（ja-JP → ja、zh-Hans-CN → zh-Hans）。
    // ⚠️ 長いものから見る。zh-Hans-CN を zh に落とさないため
    const byPrefix = [...supported]
      .sort((a, b) => b.length - a.length)
      .find(s => want.toLowerCase().startsWith(`${s.toLowerCase()}-`));
    if (byPrefix) return byPrefix;
  }

  // ⚠️ 分からなければ英語。日本語にすると、日本語を読めない人が
  // 「読めない画面」から始まることになる（#245）
  return 'en';
}

/** #324: 本体が配るガイドの場所（docs/docs-site.md 5.1。backend の DOCS_ROUTE と同じ） */
const DOCS_ROOT = '/docs/';
const ENGLISH = 'en/';
const JAPANESE = 'ja';

/**
 * 画面の言語に合うガイドの URL。日本語は既定の /docs/、それ以外は英語版。
 *
 * 例: userGuideUrl('ja', 'user/') → '/docs/user/'、userGuideUrl('en') → '/docs/en/'
 */
export function userGuideUrl(language: string, page = ''): string {
  const locale = language.startsWith(JAPANESE) ? '' : ENGLISH;
  return `${DOCS_ROOT}${locale}${page}`;
}

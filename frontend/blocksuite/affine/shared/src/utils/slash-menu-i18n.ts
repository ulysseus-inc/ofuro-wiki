/**
 * Slash menu i18n helper for ofuro-wiki.
 * Translates slash menu item names/descriptions based on the current UI language.
 * Language is detected from `document.documentElement.lang`, which is set by
 * the i18n service (I18nService.changeLanguage).
 */

type ItemTranslation = {
  name: string;
  description?: string;
};

const JA: Record<string, ItemTranslation> = {
  // テキストブロック
  Text: { name: 'テキスト', description: 'プレーンテキストを入力する。' },
  'Heading 1': { name: '見出し 1', description: '最も大きなフォントの見出し。' },
  'Heading 2': { name: '見出し 2', description: '2番目のフォントサイズの見出し。' },
  'Heading 3': { name: '見出し 3', description: '3番目のフォントサイズの見出し。' },
  'Heading 4': { name: '見出し 4', description: '4番目のフォントサイズの見出し。' },
  'Heading 5': { name: '見出し 5', description: '5番目のフォントサイズの見出し。' },
  'Heading 6': { name: '見出し 6', description: '6番目のフォントサイズの見出し。' },
  'Other Headings': { name: 'その他の見出し' },
  'Bulleted List': { name: '箇条書きリスト', description: '箇条書きリストを作成する。' },
  'Numbered List': { name: '番号付きリスト', description: '番号付きリストを作成する。' },
  'To-do List': { name: 'ToDoリスト', description: 'ToDoリストにタスクを追加する。' },
  'Code Block': { name: 'コードブロック', description: 'コードスニペットを挿入する。' },
  Quote: { name: '引用', description: '強調のためのブロック引用を追加する。' },
  Divider: { name: '区切り線', description: 'コンテンツを視覚的に区切る。' },
  // 配置
  'Align left': { name: '左揃え' },
  'Align center': { name: '中央揃え' },
  'Align right': { name: '右揃え' },
  // テキスト書式
  Bold: { name: '太字' },
  Italic: { name: '斜体' },
  Underline: { name: '下線' },
  Strikethrough: { name: '取り消し線' },
  // メディア・コンテンツ
  Image: { name: '画像', description: '画像を挿入する。' },
  Table: { name: 'テーブル', description: 'シンプルなテーブルを作成する。' },
  'Table View': { name: 'テーブルビュー', description: 'テーブル形式でアイテムを表示する。' },
  'Kanban View': { name: 'カンバンビュー', description: 'データをダッシュボードで可視化する。' },
  Attachment: { name: '添付ファイル', description: 'ファイルをドキュメントに添付する。' },
  PDF: { name: 'PDF', description: 'PDFをドキュメントにアップロードする。' },
  Link: { name: 'リンク', description: '参照用のブックマークを追加する。' },
  Callout: { name: 'コールアウト', description: 'テキストを目立たせる。' },
  Equation: { name: '数式ブロック', description: '数式ブロックを作成する。' },
  'Inline equation': { name: 'インライン数式', description: 'インライン数式を作成する。' },
  'Mind Map': { name: 'マインドマップ', description: 'マインドマップを挿入する。' },
  // ページ
  'New Doc': { name: '新規ドキュメント', description: '新しいドキュメントを作成する。' },
  'Linked Doc': { name: 'リンクドドキュメント', description: '別のドキュメントをリンクする。' },
  // エッジレス要素
  Frame: { name: 'フレーム', description: '空白のフレームを挿入する。' },
  // 日付
  Today: { name: '今日' },
  Tomorrow: { name: '明日' },
  Yesterday: { name: '昨日' },
  Now: { name: '現在時刻' },
  // 操作
  'Move Up': { name: '上に移動', description: 'この行を上に移動する。' },
  'Move Down': { name: '下に移動', description: 'この行を下に移動する。' },
  Copy: { name: 'コピー', description: 'この行をクリップボードにコピーする。' },
  Duplicate: { name: '複製', description: 'この行の複製を作成する。' },
  Delete: { name: '削除', description: 'この行を完全に削除する。' },
  // フォーマットバー
  'Turn into': { name: '変換' },
  Align: { name: '揃え' },
  'Create Table': { name: 'テーブルを作成' },
  'Create Linked Doc': { name: 'リンクドドキュメントを作成' },
  'Copied to clipboard': { name: 'クリップボードにコピーしました' },
  'Copy link to block': { name: 'ブロックへのリンクをコピー' },
  'Copy as Image': { name: '画像としてコピー' },
  // カラーピッカー
  Highlight: { name: 'ハイライト' },
  Color: { name: 'カラー' },
  Background: { name: '背景色' },
  'default color': { name: 'デフォルト' },
  'default background': { name: 'デフォルト' },
  red: { name: '赤' },
  orange: { name: 'オレンジ' },
  yellow: { name: '黄色' },
  green: { name: '緑' },
  teal: { name: 'ティール' },
  blue: { name: '青' },
  purple: { name: '紫' },
  grey: { name: 'グレー' },
};

const JA_GROUPS: Record<string, string> = {
  Basic: '基本',
  List: 'リスト',
  Align: '揃え',
  Style: 'スタイル',
  'Content & Media': 'コンテンツ・メディア',
  Date: '日付',
  Actions: '操作',
  Database: 'データベース',
  'Edgeless Element': 'エッジレス要素',
  Page: 'ページ',
};

/** Get the current UI language from the HTML lang attribute. */
export function getSlashMenuLang(): string {
  if (typeof document === 'undefined') return 'en';
  return document.documentElement.lang || 'en';
}

/**
 * Translate a slash menu item name and description.
 * Returns translated values plus the original English name as a search alias
 * so users can still type English to find items.
 */
export function translateSlashItem(
  name: string,
  description?: string
): { name: string; description?: string; englishAlias: string } {
  if (getSlashMenuLang() === 'ja') {
    const t = JA[name];
    if (t) {
      return {
        name: t.name,
        description: t.description ?? description,
        englishAlias: name,
      };
    }
  }
  return { name, description, englishAlias: '' };
}

/**
 * Translate a group format string (e.g. "0_Basic@0" → "0_基本@0").
 */
export function translateGroupStr(
  group: string | undefined
): string | undefined {
  if (!group || getSlashMenuLang() !== 'ja') return group;
  return group.replace(/_([^@]+)@/, (_, groupName: string) => {
    return `_${JA_GROUPS[groupName] ?? groupName}@`;
  });
}

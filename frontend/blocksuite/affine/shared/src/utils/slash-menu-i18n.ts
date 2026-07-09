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
  // 埋め込み系（プロバイダ名は固有名詞なので name は原文、説明のみ日本語化）
  YouTube: { name: 'YouTube', description: 'YouTube 動画を埋め込む。' },
  GitHub: { name: 'GitHub', description: 'GitHub リポジトリをリンクする。' },
  Figma: { name: 'Figma', description: 'Figma ドキュメントを埋め込む。' },
  Embed: { name: '埋め込み', description: 'Google Drive などを埋め込む。' },
  Image: { name: '画像', description: '画像を挿入する。' },
  Table: { name: 'テーブル', description: 'シンプルなテーブルを作成する。' },
  'Table View': { name: 'テーブルビュー', description: 'テーブル形式でアイテムを表示する。' },
  'Kanban View': { name: 'カンバンビュー', description: 'データをダッシュボードで可視化する。' },
  Attachment: { name: '添付ファイル', description: 'ファイルをドキュメントに添付する。' },
  PDF: { name: 'PDF', description: 'PDFをドキュメントにアップロードする。' },
  Link: { name: 'リンク', description: '参照用のブックマークを追加する。' },
  Callout: { name: 'コールアウト', description: 'テキストを目立たせる。' },
  '2 Columns': { name: '2列', description: '2列のレイアウトを作成します。' },
  '3 Columns': { name: '3列', description: '3列のレイアウトを作成します。' },
  Todo: { name: 'Todo', description: 'ToDo リストを表示する。' },
  Equation: { name: '数式ブロック', description: '数式ブロックを作成する。' },
  'Inline equation': { name: 'インライン数式', description: 'インライン数式を作成する。' },
  'Mind Map': { name: 'マインドマップ', description: 'マインドマップを挿入する。' },
  // ページ
  'New Doc': { name: '新規ドキュメント', description: '新しいドキュメントを作成する。' },
  'Linked Doc': { name: 'リンクドドキュメント', description: '別のドキュメントをリンクする。' },
  // エッジレス要素
  Frame: { name: 'フレーム', description: '空白のフレームを挿入する。' },
  Group: { name: 'グループ' },
  // ツールチップのキャプション（ホバー時プレビュー内の見出し）
  'YouTube Video': { name: 'YouTube 動画' },
  'GitHub Repo': { name: 'GitHub リポジトリ' },
  Photo: { name: '画像' },
  'Link Doc': { name: 'リンクドドキュメント' },
  Edgeless: { name: 'エッジレス' },
  // 埋め込みブロックのツールバー（ビュー切替・カードスタイル・More メニュー）
  'Inline view': { name: 'インラインビュー' },
  'Card view': { name: 'カードビュー' },
  'Embed view': { name: '埋め込みビュー' },
  'Switch view': { name: 'ビューを切替' },
  'Card style': { name: 'カードスタイル' },
  'Large horizontal style': { name: '大きい横型' },
  'Small horizontal style': { name: '小さい横型' },
  'Large vertical style': { name: '大きい縦型' },
  'Small vertical style': { name: '小さい縦型' },
  Reload: { name: '再読み込み' },
  Caption: { name: 'キャプション' },
  More: { name: 'その他' },
  // データベース（テーブルビュー）: 列プロパティの型名
  'Plain-Text': { name: 'テキスト' },
  Select: { name: '選択' },
  'Multi-select': { name: '複数選択' },
  Checkbox: { name: 'チェックボックス' },
  Number: { name: '数値' },
  Progress: { name: '進捗' },
  image: { name: '画像' },
  'Created By': { name: '作成者' },
  Member: { name: 'メンバー' },
  // データベース（テーブルビュー）: 列プロパティメニュー
  'Property name': { name: 'プロパティ名' },
  Type: { name: 'タイプ' },
  'Property type': { name: 'プロパティタイプ' },
  // データベース（テーブルビュー）: ビュー設定メニュー（Filter/Sort/Group/Properties）
  Properties: { name: 'プロパティ' },
  ' shown': { name: '件表示' },
  Filter: { name: 'フィルター' },
  ' filters': { name: '件のフィルター' },
  Sort: { name: 'ソート' },
  ' sorts': { name: '件のソート' },
  'View settings': { name: 'ビュー設定' },
  'New Record': { name: '新規レコード' },
  New: { name: '新規' },
  // データベース（テーブルビュー）: 列ヘッダーの右クリックメニュー
  'Number Format': { name: '数値フォーマット' },
  'Hide In View': { name: 'このビューで非表示' },
  'Sort Ascending': { name: '昇順に並べ替え' },
  'Sort Descending': { name: '降順に並べ替え' },
  'Insert Left Column': { name: '左に列を挿入' },
  'Insert Right Column': { name: '右に列を挿入' },
  'Move Left': { name: '左に移動' },
  'Move Right': { name: '右に移動' },
  'Group by': { name: 'グループ化' },
  'Add filter': { name: 'フィルターを追加' },
  'Search...': { name: '検索...' },
  // データベース（テーブルビュー）: フィルター条件（演算子）
  Contains: { name: '含む' },
  'Contains all': { name: 'すべてを含む' },
  'Contains one of': { name: 'いずれかを含む' },
  'Does no contains': { name: '含まない' },
  'Does not contains all': { name: 'すべてを含まない' },
  'Does not contains one of': { name: 'いずれも含まない' },
  'Starts with': { name: 'で始まる' },
  'Ends with': { name: 'で終わる' },
  Is: { name: '次と一致' },
  'Is not': { name: '次と一致しない' },
  'Is empty': { name: '空である' },
  'Is not empty': { name: '空でない' },
  'Is one of': { name: 'いずれかに一致' },
  'Is not one of': { name: 'いずれにも一致しない' },
  'Is checked': { name: 'チェック済み' },
  'Is unchecked': { name: '未チェック' },
  After: { name: '以降' },
  Before: { name: '以前' },
  And: { name: 'かつ' },
  Or: { name: 'または' },
  Filters: { name: 'フィルター' },
  Add: { name: '追加' },
  // データベース（テーブルビュー）: ビュー管理（タブ）
  'Edit View': { name: 'ビューを編集' },
  'View name': { name: 'ビュー名' },
  Create: { name: '作成' },
  // データベース（テーブルビュー）: モバイル版
  'Expand Row': { name: '行を展開' },
  'Delete Row': { name: '行を削除' },
  'Delete Rows': { name: '行を削除' },
  'Insert Before': { name: '前に挿入' },
  'Insert After': { name: '後に挿入' },
  Ungroup: { name: 'グループ解除' },
  'Delete Cards': { name: 'カードを削除' },
  'Property settings': { name: 'プロパティ設定' },
  // データベース（テーブルビュー）: 列フッターの集計（統計）
  None: { name: 'なし' },
  Count: { name: 'カウント' },
  Percent: { name: 'パーセント' },
  'More options': { name: 'その他のオプション' },
  All: { name: 'すべて' },
  Average: { name: '平均' },
  Checked: { name: 'チェック済み' },
  Empty: { name: '空' },
  Max: { name: '最大' },
  Median: { name: '中央値' },
  Min: { name: '最小' },
  'Not Empty': { name: '空でない' },
  Range: { name: '範囲' },
  Sum: { name: '合計' },
  Unchecked: { name: '未チェック' },
  'Unique Values': { name: 'ユニークな値' },
  Values: { name: '値' },
  'Count All': { name: 'すべての件数' },
  'Count Checked': { name: 'チェック済みの件数' },
  'Count Empty': { name: '空の件数' },
  'Count Not Empty': { name: '空でない件数' },
  'Count Unchecked': { name: '未チェックの件数' },
  'Count Unique Values': { name: 'ユニークな値の件数' },
  'Count Values': { name: '値の件数' },
  'Percent Checked': { name: 'チェック済みの割合' },
  'Percent Empty': { name: '空の割合' },
  'Percent Not Empty': { name: '空でない割合' },
  'Percent Unchecked': { name: '未チェックの割合' },
  // データベース（テーブルビュー）: グループ設定パネル
  'Remove Grouping': { name: 'グループ化を解除' },
  'Remove grouping': { name: 'グループ化を解除' },
  'Group By': { name: 'グループ化基準' },
  'Date by': { name: '日付の単位' },
  'Start week on': { name: '週の開始日' },
  'Oldest first': { name: '古い順' },
  'Newest first': { name: '新しい順' },
  'Hide empty groups': { name: '空のグループを非表示' },
  'Add sort': { name: 'ソートを追加' },
  'Add filter group': { name: 'フィルターグループを追加' },
  'Filter group': { name: 'フィルターグループ' },
  'New sort': { name: '新しいソート' },
  'New filter': { name: '新しいフィルター' },
  // データベース（テーブルビュー）: タグの色（Select/Multi-select）
  Red: { name: '赤' },
  Magenta: { name: 'マゼンタ' },
  Orange: { name: 'オレンジ' },
  Yellow: { name: '黄色' },
  Green: { name: '緑' },
  Teal: { name: 'ティール' },
  Blue: { name: '青' },
  Purple: { name: '紫' },
  Grey: { name: 'グレー' },
  White: { name: '白' },
  'Add property': { name: 'プロパティを追加' },
  // データベース（カンバンビュー）
  Status: { name: 'ステータス' },
  'In Progress': { name: '進行中' },
  Done: { name: '完了' },
  'Expand Card': { name: 'カードを展開' },
  'Move To': { name: '移動先' },
  'Delete Card': { name: 'カードを削除' },
  // 埋め込みカード作成モーダル（URL 入力ダイアログ）
  'Input in https://...': { name: 'https://... を入力' },
  Confirm: { name: '確定' },
  Links: { name: 'リンク' },
  'The added YouTube video link will be displayed as an embed view.': {
    name: '追加した YouTube 動画のリンクは埋め込みビューで表示されます。',
  },
  'The added GitHub issue or pull request link will be displayed as a card view.':
    {
      name: '追加した GitHub の Issue / PR のリンクはカードビューで表示されます。',
    },
  'The added Figma link will be displayed as an embed view.': {
    name: '追加した Figma のリンクは埋め込みビューで表示されます。',
  },
  'The added Loom video link will be displayed as an embed view.': {
    name: '追加した Loom 動画のリンクは埋め込みビューで表示されます。',
  },
  'The added link will be displayed as a card view.': {
    name: '追加したリンクはカードビューで表示されます。',
  },
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

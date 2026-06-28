# ofuro-wiki E2E テスト

## 前提条件

以下のサービスが起動済みであること：

```bash
# 1. PostgreSQL
docker compose up -d

# 2. バックエンド (port 3010)
cd backend && npm run start:dev

# 3. フロントエンド (port 8080)
cd frontend && yarn dev
```

## セットアップ

```bash
cd e2e
npm install
npx playwright install chromium
```

## 実行

```bash
# ヘッドレス実行
npm test

# ブラウザ表示付き実行
npm run test:headed

# Playwright UI モード（デバッグに便利）
npm run test:ui
```

## テスト項目

| カテゴリ | テスト | 内容 |
|---------|--------|------|
| 認証 | サインイン画面表示 | メール入力フォームが表示される |
| 認証 | パスワード画面遷移 | メール入力後にパスワード画面が出る |
| 認証 | サインイン成功 | 正しいパスワードでログインできる |
| ワークスペース | 作成・遷移 | ワークスペースを作成して入れる |
| ワークスペース | GraphQL currentUser | 認証済みユーザー情報を取得できる |
| ドキュメント | 一覧表示 | All docs でドキュメント一覧が出る |
| ドキュメント | ページ表示 | Getting Started ページが描画される |
| エディタ | 新規ページ作成 | + ボタンで新規ページが開く |
| エディタ | テキスト入力 | キーボードでテキスト入力できる |
| エディタ | スラッシュコマンド | `/` でブロックメニューが出る |
| エディタ | Properties パネル | 右サイドバーにプロパティが出る |
| 検索 | 検索ダイアログ | Search でドキュメントを検索できる |
| サイドバー | ナビゲーション | 主要メニュー項目が表示される |
| API | GraphQL | serverConfig が応答する |
| API | セッション | 認証済みユーザーを返す |
| 同期 | Socket.IO | リアルタイム同期接続が確立される |

## テストレポート

```bash
npm run report
```

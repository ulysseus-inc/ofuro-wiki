# ofuro-wiki バックエンド

ofuro-wiki の自作バックエンドです。NestJS + PostgreSQL (PGroonga) で構成されています。

## 技術スタック

| 技術 | 用途 |
|------|------|
| NestJS | APIフレームワーク |
| GraphQL (Apollo) | APIプロトコル |
| Socket.IO | Yjs リアルタイム同期 |
| Prisma | ORM |
| PostgreSQL + PGroonga | DB + 全文検索 |
| JWT | 認証 |
| Nodemailer | メール送信 |

## 主なモジュール

| モジュール | 説明 |
|-----------|------|
| `auth` | 認証（メール+パスワード、JWT） |
| `user` | ユーザー管理 |
| `workspace` | ワークスペース管理 |
| `doc` | ドキュメントCRUD |
| `sync` | Yjs WebSocket 同期サーバー |
| `blob` | 画像・ファイルストレージ |
| `search` | PGroonga 全文検索 |
| `permission` | 権限管理 |
| `admin` | 管理者機能 |
| `backup` | バックアップ・リストア |
| `comment` | コメント機能 |
| `notification` | 通知 |
| `mail` | メール送信 |
| `config` | サーバー設定API |

## 開発環境のセットアップ

```bash
# 依存関係インストール
npm install

# .env 作成
cp .env.example .env
# DATABASE_URL 等を設定

# DB マイグレーション
npx prisma migrate dev

# 開発サーバー起動
npm run start:dev
```

## 環境変数

`.env.example` を参照してください。

## ビルド

```bash
npm run build
npm run start:prod
```

## 本番デプロイ

プロジェクトルートの `docs/deploy/README.md` を参照してください。

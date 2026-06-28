# 開発環境のセットアップ

ofuro-wiki の開発（コントリビュート）を行うための手順です。
本番デプロイは [README](../README.md) と [docs/deploy/README.md](deploy/README.md) を参照してください。

## 前提条件

- Node.js 20+、Yarn（Corepack 経由 / yarn 4.12.0）
- Docker / Docker Compose v2

## 1. 依存関係のインストール

```bash
# バックエンド
cd backend && npm install && cd ..

# フロントエンド
cd frontend && corepack enable && yarn install && cd ..
```

## 2. 環境変数の設定

```bash
cp backend/.env.example backend/.env
```

以下の値を編集してください：

```bash
POSTGRES_PASSWORD="任意のパスワード"
DATABASE_URL="postgresql://ofuro:上と同じパスワード@localhost:5432/ofuro_wiki"
JWT_SECRET="dev-only-secret-32-chars-minimum!!"  # 開発用の仮の値でOK
BASE_URL="http://localhost:8080"

# メール（Mailpit を使う場合）
MAILER_HOST=localhost
MAILER_PORT=1025
MAILER_IGNORE_TLS=true
```

`docker compose` 用にルートにもコピーします：

```bash
cp backend/.env .env
```

## 3. PostgreSQL の起動

`.env` の準備が完了してから起動してください（先に起動すると認証情報が反映されません）。

```bash
docker compose up -d postgres
```

## 4. Prisma Client の生成とマイグレーション

```bash
cd backend && npx prisma generate && npx prisma migrate deploy && cd ..
```

> `migrate dev` ではなく `migrate deploy` を使います。`migrate dev` は内部でシャドウ DB を作成しますが、PGroonga 拡張が存在しないためエラーになります。

## 5. バックエンド・フロントエンドの起動

ターミナルを 2 つ開いて、それぞれ実行します。

```bash
# ターミナル 1: バックエンド（ポート 3010）
cd backend && npm run start:dev
```

```bash
# ターミナル 2: フロントエンド（ポート 8080）
cd frontend && NODE_OPTIONS="--max-old-space-size=4096" yarn dev
```

> フロントエンドのビルドはメモリを多く消費します。`NODE_OPTIONS` を指定しないとビルド中にメモリ不足でクラッシュすることがあります。

ブラウザで **http://localhost:8080** にアクセスしてください。
`/api`・`/graphql`・`/socket.io` は自動的にバックエンドへプロキシされます。

## メール確認（Mailpit）

招待メール・パスワードリセットメールの動作確認には Mailpit を使います。

```bash
docker compose --profile dev up -d mailpit
```

| サービス | URL |
|---|---|
| 受信メール確認 | http://localhost:8025 |
| SMTP（アプリから送信） | localhost:1025 |

## テスト（E2E）

```bash
# フロントエンド(8080)・バックエンド(3010) が起動している状態で
cd e2e && BASE_URL=http://localhost:8080 npx playwright test integration.spec.ts
```

詳細・コントリビューションの流れは [CONTRIBUTING.md](../CONTRIBUTING.md) を参照してください。

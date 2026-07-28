# 開発環境のセットアップ

ofuro-wiki の開発（コントリビュート）を行うための手順です。
本番デプロイは [README](../README.md) と [docs/deploy/README.md](deploy/README.md) を参照してください。

## 前提条件

- Node.js 20+、Yarn（Corepack 経由 / yarn 4.12.0）
- Docker / Docker Compose v2
- **PostgreSQL クライアントツール**（任意・バックアップ機能を開発／テストする場合のみ）
  → [補足: バックアップ機能を扱う場合](#補足-バックアップ機能を扱う場合)

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

# バックアップ・エクスポート系
cd e2e && BASE_URL=http://localhost:8080 npx playwright test backup.spec.ts
```

## 補足: バックアップ機能を扱う場合

バックアップ／リストアは **`pg_dump` / `pg_restore` を子プロセスとして実行**します。

- **Docker で動かす場合**: イメージに同梱済みのため、追加作業は不要です
- **ホスト上で `npm run start:dev` する場合**: PostgreSQL クライアントツールが必要です

未インストールのまま実行すると、バックアップ作成が次のエラーになります。

```
PG_TOOL_UNAVAILABLE: pg_dump を実行できません（ENOENT）。
```

E2E（`backup.spec.ts`）は、この場合**失敗ではなく skip** になります（理由が表示されます）。

### インストール（Ubuntu / Debian）

⚠️ **サーバーと同じメジャーバージョンが必要です。** 古い `pg_dump` で新しいサーバーを
ダンプすると `server version mismatch` で失敗します。
ofuro-wiki の Docker 構成は **PostgreSQL 17** を使います。

```bash
# PGDG リポジトリを追加してから 17 系を入れる
sudo apt install -y curl ca-certificates
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
  https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  | sudo tee /etc/apt/sources.list.d/pgdg.list
sudo apt update && sudo apt install -y postgresql-client-17

pg_dump --version   # PostgreSQL 17.x であることを確認
```

### 代替: Docker コンテナ内で実行する

ホストを汚したくない場合は、バックエンドも Docker で動かせば `pg_dump` は同梱されています。

```bash
docker compose up -d
```

詳細・コントリビューションの流れは [CONTRIBUTING.md](../CONTRIBUTING.md) を参照してください。

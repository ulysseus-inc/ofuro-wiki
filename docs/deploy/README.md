# ofuro-wiki デプロイガイド

## デプロイパターンの選択

まず、サーバーの環境に合ったパターンを選んでください。

| | [パターン A](./pattern-A.md) | [パターン B](./pattern-B.md) | [パターン C](./pattern-C.md) |
|---|---|---|---|
| **ひとこと** | 本番運用 | 社内・閉域LAN | お試し・開発 |
| **ドメイン** | 必要 | 不要（IPアドレスのみ可） | 不要 |
| **インターネット接続** | 必要（証明書取得） | 不要（完全オフライン可） | 不要 |
| **HTTPS** | ✅ Let's Encrypt（自動・無料） | ✅ mkcert 自己署名 | ❌ HTTP |
| **ブラウザ警告** | なし | 初回のみ（クライアント側で要設定） | なし |
| **クリップボード** | ✅ フル機能 | ✅ フル機能 | ⚠️ テキストのみ（リッチ形式は同一タブ内のみ） |
| **リバースプロキシ** | Caddy または Nginx | Nginx（または Caddy） | 不要 |

### どれを選ぶか

```
ドメインがある & インターネット接続あり？
  → パターン A（Let's Encrypt で自動HTTPS）

IPアドレス（192.168.x.x 等）でアクセス、またはオフライン環境？
  → パターン B（mkcert 自己署名証明書）

とにかく手軽に試したい、または HTTPS 不要？
  → パターン C（HTTP のみ、クリップボード制限あり）
```

---

## 共通セットアップ手順

どのパターンでも共通の手順です。

### 1. リポジトリの取得

```bash
git clone <your-repo-url> ofuro-wiki
cd ofuro-wiki
```

> **プライベートリポジトリの場合**
>
> `https://` クローンには認証が必要です。以下のいずれかの方法で認証してください。
>
> **方法①：Personal Access Token (PAT)**
> ```bash
> git clone https://<TOKEN>@github.com/<org>/<repo>.git ofuro-wiki
> ```
> PAT は GitHub → Settings → Developer settings → Personal access tokens で発行。
> 必要スコープ: `repo`（または `read:packages` のみの読み取り専用 PAT）。
>
> **方法②：SSH Deploy Key**
> ```bash
> # Deploy Key を作成
> ssh-keygen -t ed25519 -C "deploy-key" -f ~/.ssh/ofuro_wiki_deploy
> # 公開鍵を GitHub リポジトリの Settings → Deploy keys に登録
> # SSH クローン
> git clone git@github.com:<org>/<repo>.git ofuro-wiki
> ```
>
> PAT はチャット・ログ等に貼り付けた場合、**使用後すぐに失効させる**こと。

### 2. 環境変数の設定

`.env` ファイルを作成します。

```bash
cp backend/.env.example .env
```

以下の値を**必ず**変更してください：

| 変数 | 説明 | 生成コマンド |
|------|------|------------|
| `JWT_SECRET` | JWTの署名キー（32文字以上） | `openssl rand -base64 48` |
| `POSTGRES_PASSWORD` | PostgreSQLパスワード | `openssl rand -base64 24` |
| `BASE_URL` | 公開URL（例: `https://wiki.example.com`） | — |
| `ADMIN_EMAIL` | 初回Admin のメールアドレス | — |

**CORS設定（オプション）:**
```bash
# 全許可（デフォルト）
ALLOWED_ORIGINS=*

# ドメインを絞る場合
ALLOWED_ORIGINS=https://wiki.example.com
```

**メール設定（オプション）:**
未設定の場合、招待メール・パスワードリセットメールは送信されません。
```bash
MAILER_HOST=smtp.example.com
MAILER_PORT=587
MAILER_USER=user@example.com
MAILER_PASSWORD=your_smtp_password
MAILER_SENDER="ofuro-wiki <noreply@example.com>"
```

### 3. ビルドと起動

> **PostgreSQL イメージについて（#26）**: `postgres` サービスは `groonga/pgroonga`
> に pgvector をビルド追加した独自イメージ（`docker/postgres/Dockerfile`）を使用します。
> `docker compose build` / `up --build` 時に**初回のみ** pgvector をソースからビルドします
> （約1分・pgvector の git clone にインターネット接続が必要）。アプリを GHCR pull で
> 運用する場合（方法②）でも、`postgres` は各サーバーでローカルビルドされます。
> pgroonga（全文検索）と pgvector（意味検索）が同一DBに共存します。

#### 方法①：サーバー上でビルドする（標準）

```bash
docker compose build
docker compose up -d
```

> **注意（低スペックサーバー）**: webpack ビルドは RAM 2GB 以上を消費します。
> RAM が 1GB 程度の VPS では OOM でビルドが強制終了します。
> Swap 領域を事前に作成するか、方法②（GHCR Pull）を使用してください。

#### 方法②：GitHub Actions でビルド → サーバーは Pull のみ（推奨）

RAM が少ないサーバーや、CI/CD を整備したい場合は、ビルドを GitHub Actions に任せ、
サーバーでは完成済みイメージを pull するだけにします。

**GitHub Actions ワークフロー（`.github/workflows/build-push.yml`）**

```yaml
name: Build and Push Docker Image

on:
  push:
    branches:
      - master
  workflow_dispatch:

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=raw,value=latest
            type=sha,prefix=sha-

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          build-args: |
            SKIP_MOBILE=true
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

**`docker-compose.yml` の変更**

サーバー上の `docker-compose.yml` で `build:` ディレクティブを `image:` に変更します：

```yaml
services:
  app:
    # build: .   ← 削除
    image: ghcr.io/<org>/<repo>:latest   # ← 追加
    ...
  postgres:
    # build: ...                                ← 削除（サーバーではビルドしない）
    image: ghcr.io/<org>/<repo>-postgres:latest # ← pgroonga + pgvector の配布イメージ
    ...
```

> **postgres イメージ（#26）**: pgroonga + pgvector の独自イメージは GitHub Actions で
> `ghcr.io/<org>/<repo>-postgres:latest` に push されます。本番サーバーでは `build:` を
> 削除して `image:` に差し替えることで、`docker compose pull` で取得できます。

**サーバー上でのデプロイ**

```bash
# GHCR にログイン（初回のみ）
echo <GITHUB_TOKEN> | docker login ghcr.io -u <github_username> --password-stdin

# イメージを pull して再起動
docker compose pull
docker compose up -d
```

> **GHCR の容量**: GitHub Free プランでは Container Registry の容量は **500MB 無料**。
> 超過分は有料（$0.008/GB/月）。プライベートリポジトリの場合は可視性に注意。

### 3-a. Swap 領域の作成（低スペックサーバー向け）

RAM が 2GB 未満のサーバーで方法①（サーバービルド）を選ぶ場合は、ビルド前に Swap を作成してください。
方法②（GHCR Pull）を使う場合でも、サービス稼働中の安定性のために作成を推奨します。

```bash
# 2GB の Swap ファイルを作成
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# 再起動後も有効にする
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Swap の使いすぎを防ぐ（RAM を優先的に使う設定）
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

確認：
```bash
free -h  # Swap 行に 2.0Gi と表示されれば OK
```

### 4. 初回起動の確認

```bash
# ヘルスチェック
curl http://localhost:3010/api/health

# ログ確認
docker compose logs -f app
```

ブラウザで `BASE_URL` にアクセスし、`ADMIN_EMAIL` でサインアップできれば完了です。

> **DB の初期化について**: スキーマ構築は 2 段階で行われます。
> ① **PostgreSQL 拡張**（pgroonga / pgvector）は、DB ボリュームの初回作成時に
> `docker-entrypoint-initdb.d`（`pgroonga-init.sql`）で一度だけ作成されます。
> ② **テーブル・インデックス**は、`app` コンテナ起動時の `prisma migrate deploy`
> で適用されます（冪等。未適用のマイグレーションのみ適用されるため、毎回の起動や
> バージョンアップでも安全です）。手動でのマイグレーション操作は不要です。

その後、パターン別のリバースプロキシ設定へ進んでください。

---

## バージョン管理・リリース手順

| 変数 | 場所 | 説明 |
|------|------|------|
| `APP_VERSION` | プロジェクトルートの `.env` | **ofuro-wiki のリリースバージョン。リリース時に更新する** |
| `AFFINE_API_VERSION` | `backend/src/modules/config/config.service.ts` | AFFiNE フロントエンドとの API 互換バージョン。**絶対に変更しないこと** |

```bash
# 1. .env の APP_VERSION を更新
#    APP_VERSION=1.1.0

# 2. コミット → PR → main にマージ

# 3. タグを打つ
git tag v1.1.0
git push origin v1.1.0

# 4. サーバーに反映
# 方法①（サーバービルド）の場合:
git pull
docker compose build
docker compose up -d

# 方法②（GHCR Pull）の場合:
# GitHub Actions が自動でビルド・push → サーバーでは pull するだけ
docker compose pull
docker compose up -d
```

---

## DBマイグレーション：pgvector の有効化（#26・既存本番向け）

pgvector を追加した版を**既存の本番環境**に適用する場合の一回限りの手順です。
`pgdata` ボリュームは保持されるため**データは消えません**が、`initdb` の初期化SQL
（`CREATE EXTENSION vector`）は初回構築済みのボリュームでは**再実行されない**ため、
拡張の有効化を手動で1回行う必要があります。

```bash
# 0. 念のためバックアップ（管理パネル or pg_dump）
docker compose exec postgres pg_dump -U ofuro -d ofuro_wiki -Fc -f /tmp/pre-pgvector.dump
docker compose cp postgres:/tmp/pre-pgvector.dump ./pre-pgvector.dump

# 1. docker-compose.yml の postgres を新イメージに差し替え（方法②の場合）
#    image: ghcr.io/<org>/<repo>-postgres:latest  / build: は削除

# 2. 新しい postgres イメージを取得して再作成（pgdata は保持される）
docker compose pull postgres
docker compose up -d postgres

# 3. 拡張が利用可能か確認（vector が1行返ればOK）
docker compose exec postgres psql -U ofuro -d ofuro_wiki -c \
  "SELECT name, default_version FROM pg_available_extensions WHERE name='vector';"

# 4. 拡張を有効化（既存DBは initdb 非実行のため手動）
docker compose exec postgres psql -U ofuro -d ofuro_wiki -c \
  "CREATE EXTENSION IF NOT EXISTS vector;"

# 5. 既存の pgroonga と共存していることを確認
docker compose exec postgres psql -U ofuro -d ofuro_wiki -c \
  "SELECT extname, extversion FROM pg_extension ORDER BY extname;"
```

> **ロールバック**: 旧イメージ（`groonga/pgroonga:latest-alpine-17`）に戻して
> `docker compose up -d postgres` で再作成すれば元に戻ります（`vector` 拡張を作成済みでも、
> 旧イメージには拡張バイナリが無いため、戻す前に `DROP EXTENSION vector;` が必要な場合あり）。
> データ自体は `pgdata` に保持されます。

---

## バックアップ

管理パネル（`/admin`）から手動バックアップ・スケジュールバックアップを設定できます。

バックアップデータの保存先：
```bash
BACKUP_HOST_PATH=./backups  # デフォルト
```

---

## トラブルシューティング

### 起動時に `JWT_SECRET must be set` エラー

`.env` の `JWT_SECRET` が設定されていないか弱い値です。
`openssl rand -base64 48` で生成した値を設定してください。

### データベース接続エラー

`POSTGRES_PASSWORD` が `.env` と docker-compose の両方で一致しているか確認してください。

### ログの確認

```bash
docker compose logs app      # アプリログ
docker compose logs postgres # DBログ
```

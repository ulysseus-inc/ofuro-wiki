# ofuro-wiki デプロイガイド

> **対象読者**: ofuro-wiki を自分のサーバーにデプロイして**利用する**方。
> リポジトリを clone せず最小手順で試したい場合は、トップの
> [README クイックスタート](../../README.md#クイックスタート) を参照してください。

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

### 0. Docker のインストール

Docker と Docker Compose (v2) が必要です。未インストールの場合：

```bash
# Ubuntu
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2

# 実行ユーザーを docker グループに追加（sudo なしで docker を使う場合。再ログインで反映）
sudo usermod -aG docker $USER

# 確認
docker --version && docker compose version
```

> **Ubuntu 以外**（Debian ほか）: `docker-compose-v2` パッケージは Ubuntu 独自のため、
> [Docker 公式ドキュメント](https://docs.docker.com/engine/install/) に従い
> `docker-ce` + `docker-compose-plugin` をインストールしてください。

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
SMTP なしでも運用できます（既登録ユーザーの招待は即時メンバー登録、未登録ユーザーは
招待リンクの共有で代替、パスワードリセットは Admin が再設定用 URL を発行して共有）。
```bash
MAILER_HOST=smtp.example.com
MAILER_PORT=587
MAILER_USER=user@example.com
MAILER_PASSWORD=your_smtp_password
MAILER_SENDER="ofuro-wiki <noreply@example.com>"
```

### 3. 起動

#### 方法①：ビルド済み Docker イメージを利用（推奨）

公式のビルド済みイメージ（GHCR で公開）を pull して起動します。ビルド不要のため
低スペックサーバーでも動きます。

```bash
# .env に追記
APP_IMAGE=ghcr.io/ulysseus-inc/ofuro-wiki:latest
POSTGRES_IMAGE=ghcr.io/ulysseus-inc/ofuro-wiki-postgres:latest
```

`docker-compose.yml` は `image: ${APP_IMAGE:-...}` / `image: ${POSTGRES_IMAGE:-...}` を
参照しているため、変数を設定して pull すれば配布イメージで起動します。

```bash
# イメージを pull して起動
# --no-build: pull 忘れ等でローカルビルドが暴発し OOM するのを防ぐ（低スペック環境で重要）
docker compose pull app postgres
docker compose up -d --no-build
```

> **postgres イメージ（#26）**: pgroonga（全文検索）+ pgvector（意味検索）を同梱した
> 独自イメージです。初期化SQLもイメージに含まれます。

#### 方法②：サーバー上でビルドする

ソースからビルドしたい場合はこちら。

```bash
docker compose build
docker compose up -d
```

> **注意（低スペックサーバー）**: webpack ビルドは RAM 2GB 以上を消費します。
> RAM が 1GB 程度の VPS では OOM でビルドが強制終了します。
> Swap 領域を事前に作成するか、方法①（ビルド済みイメージ）を使用してください。
> postgres イメージのビルドには pgvector のソース取得（git clone）のため
> インターネット接続が必要です。

### 3-a. Swap 領域の作成（低スペックサーバー向け）

RAM が 2GB 未満のサーバーで方法②（サーバービルド）を選ぶ場合は、ビルド前に Swap を作成してください。
方法①（ビルド済みイメージ）を使う場合でも、サービス稼働中の安定性のために作成を推奨します。

> **最小構成の実績**: GCE e2-micro（vCPU 2 / RAM 1GB / 無料枠）+ Swap 2GB で、
> 方法①（ビルド済みイメージ）+ パターン A（Caddy）の構成で安定稼働を確認済みです。

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
> `docker-entrypoint-initdb.d`（`pgroonga-init.sql`、postgres イメージに同梱）で一度だけ作成されます。
> ② **テーブル・インデックス**は、`app` コンテナ起動時の `prisma migrate deploy`
> で適用されます（冪等。未適用のマイグレーションのみ適用されるため、毎回の起動や
> バージョンアップでも安全です）。手動でのマイグレーション操作は不要です。
>
> **最小権限化（#34）を行う場合**: `migrate deploy` は DDL を実行するため DDL 権限が
> 必要です。Docker Compose 環境で runtime の接続を非superuser（`ofuro_app`）に絞る場合は、
> `.env` に **`DOCKER_DATABASE_URL`**（非superuser・`@postgres:5432`）と
> **`DOCKER_MIGRATE_DATABASE_URL`**（DDL 権限を持つ `ofuro`）を設定してください。
> 起動時のマイグレーションのみ後者の接続で実行され、アプリ本体は前者（非superuser）で
> 動作します。どちらも未設定なら既定の `postgres` サービス接続にフォールバックします
> （従来どおりの動作）。ホスト側 `.env` の `DATABASE_URL`（`localhost`）は
> コンテナには渡らないため、ホスト実行用とコンテナ用が混在しません。

その後、パターン別のリバースプロキシ設定へ進んでください。

---

## ログイン試行の制限（#93）

パスワードの総当たりを抑止するため、以下が既定で有効です。**設定は不要**です。

| 対象 | 制限 | 何を数えるか |
|------|------|------|
| **サインインの失敗** | **5回 / 5分**（IP + メールアドレス単位） | **失敗のみ** |
| サインイン（連射・DoS 抑制） | 60回 / 5分（IP + メールアドレス単位） | リクエスト数 |
| サインアップ画面からの登録要求 | 10回 / 1時間（IP 単位） | リクエスト数 |
| **アカウント作成（全経路）** | 10回 / 1時間（IP 単位） | **実際に作成された数** |
| メールアドレスの事前確認（preflight） | 30回 / 5分（IP 単位） | リクエスト数 |
| **アカウントロック** | **連続10回失敗で15分**（自動解除） | 失敗のみ（DB に記録） |

- **総当たりへの防御は「失敗だけ」を数えます。** サインインに成功しても枠を消費しないため、
  複数端末・複数タブ・CI から何度サインインしても締め出されません
- 失敗の記録は**サインイン成功時にクリア**されます
- 「アカウント作成（全経路）」は、サインアップ画面だけでなく
  **サインイン時の自動作成**（未登録アドレスでのサインイン）も含めて数えます。
  エンドポイント単位の制限だけでは、アドレスを変えながらの量産を防げないためです
- ⚠️ レート制限のカウントは**アプリのメモリ上**にあり、**再起動でリセットされます**。
  また**複数インスタンスでは共有されません**（ofuro-wiki は単一インスタンス構成が前提）。
  再起動をまたいで有効なのは、DB に記録される**アカウントロックアウト**だけです
- ロック中も応答は通常の認証失敗と同じ（`Invalid credentials`）です。
  「ロックされています」と返すと、そのアカウントが実在することが判明するためです
- **15分で自動的に解除されます。** 管理者の操作は不要です
- しきい値はソースコードで固定しています（誤設定による無効化を防ぐため）

### ⚠️ リバースプロキシ配下では `TRUST_PROXY` の設定が必要です

Nginx / Caddy 等の背後で動かす場合、既定のままでは**全アクセスがプロキシの IP として
扱われます**。実害は3つあります。

| 影響 | 内容 |
|---|---|
| **監査ログ** | 発信元がすべてプロキシの IP になり、**誰がどこから操作したか追えない** |
| **レート制限** | 「利用者ごと」ではなく**全員の合計**で働く。1人の連続失敗で**全員が締め出される** |
| **攻撃の検知（#117）** | 通知が「攻撃元IPを遮断」と案内するのに、**その IP が取れない** |

`.env` に以下を設定してください。

```bash
TRUST_PROXY=1   # プロキシの段数（通常は 1）
```

> **直接インターネットに公開している場合は設定しないでください。**
> `X-Forwarded-For` ヘッダを偽装され、レート制限を回避されます。

#### 設定できたかの確認

**壊れ方が静かです。** IP は記録され続けるため、それが本当の接続元なのか
プロキシの IP なのかは、見ただけでは分かりません。**必ず実際の値を確認してください。**

```bash
# 手元から、存在しないアドレスでサインインを試す（401 が返る）
curl -s -o /dev/null -X POST https://<あなたのドメイン>/api/auth/sign-in \
  -H 'Content-Type: application/json' \
  -d '{"email":"trustproxy-check@example.com","password":"wrong"}'

# 記録された IP を見る
docker compose exec postgres psql -U ofuro -d ofuro_wiki \
  -c "SELECT ip FROM audit_logs ORDER BY created_at DESC LIMIT 1;"
```

自分のグローバル IP（`curl ifconfig.me` で確認）と一致していれば正しく設定できています。
`172.x.x.x` や `127.0.0.1` が出た場合は効いていません。

### ログ

ログイン失敗・アカウントロック・レート制限超過は、いずれも警告ログに記録されます。

```bash
docker compose logs app | grep -E "Failed sign-in|Account locked|ThrottlerException"
```

> ログにはメールアドレス（個人情報）が含まれます。**保持期間と閲覧権限にご注意ください。**

---

## 不審なログイン試行の検知と通知（#117）

**#93 の制限は攻撃を止めますが、それだけでは誰も気づきません。**
5分ごとに直近60分を評価し、条件に当てはまれば**管理者全員にメールで通知**します。

設計の詳細は [`docs/intrusion-detection.md`](../intrusion-detection.md) を参照してください。

### 検知する4パターン

| 種別 | 条件（既定） | 深刻度 | 何が起きているか |
|---|---|:--:|---|
| **A** | 同一アカウントが60分に3回以上ロック | 中 | 特定のアカウントを狙った集中攻撃 |
| **B** | 60分に20アカウント以上でログイン失敗 | **高** | パスワードスプレー |
| **C** | 60分に429が100回以上 | 中 | 総当たり / DoS |
| **D** | 60分に50回以上、存在しないアドレスへの試行 | 低 | アカウント列挙（偵察） |

### 設定

**設定しなくても動きます。** 変えたい場合のみ `.env` に記載してください。

```bash
ALERT_WINDOW_MINUTES=60             # 集計する時間の幅
ALERT_LOCK_THRESHOLD=3              # 種別A
ALERT_SPRAY_ACCOUNT_THRESHOLD=20    # 種別B
ALERT_THROTTLE_THRESHOLD=100        # 種別C
ALERT_UNKNOWN_EMAIL_THRESHOLD=50    # 種別D
ALERT_RESOLVE_QUIET_MINUTES=30      # 何分静かなら「収まった」とみなすか
ALERT_DISABLED=false                # 検知そのものを止める
```

> ⚠️ **`ALERT_DISABLED=true` にしたまま忘れないでください。**
> 攻撃されても何も起きず、**何も起きないこと自体が正常に見えます。**
> 有効化されている限り、起動ログに警告が出ます。

### メールが設定されていない場合

**検知は動き続け、監査ログには必ず記録されます。** メールの送信だけがとばされます。

管理パネル → 監査ログで `不審なログイン試行の検知` を検索してください。
記録には**メール送信の結果**（`success` / `disabled` / `failed`）が含まれるため、
「通知が来なかった＝攻撃が無かった」という誤解を避けられます。

SMTP を設定するには `MAILER_HOST` / `MAILER_PORT` 等を `.env` に記載します。

### 通知が来すぎないための仕組み

- **同じ種別・同じ対象について、60分に1通まで**
- 攻撃が続いている間は再送せず、**30分間静かになってから「収まりました」を1通**

> 攻撃は断続的に続くことがあります。止まった瞬間に「収まりました」を出すと、
> 再開のたびに検知と終息を往復し、**通知そのものが無視されるようになります。**

---

## 攻撃を検知したときの対応

**まず落ち着いてください。** 通知が届いた時点で、いずれの種別も**侵入されたことを意味しません。**
ロックやレート制限が働いた結果として通知されています。

### 共通の手順

1. **メール本文の「緊急度」と「発信元」を見る**
2. 管理パネル → **監査ログ**で経緯を確認する
   - `不審なログイン試行の検知` … いつ・何が起きたか
   - `ログイン失敗` `アカウントロック` … 個々の試行
3. 下の表に従って対処する

### 種別ごとの対処

| 状況 | 対処 |
|---|---|
| **A: 特定アカウントが繰り返しロック** | ① 本人に連絡し、心当たりを確認（**打ち間違いの可能性もあります**）<br>② パスワードを変更してもらう<br>③ 攻撃元 IP が偏っていればプロキシで遮断<br>④ 収まらなければ **SSO に切り替えてパスワード認証を止める** |
| **B: 多数のアカウントで少数回ずつ失敗** | ① **最優先で対処**（ロックが発生しないため気づきにくい攻撃です）<br>② 攻撃元 IP をプロキシ / ファイアウォールで遮断<br>③ 公開範囲を見直す（VPN 内に閉じる・IP 制限）<br>④ **SSO への切り替えを強く推奨** |
| **C: レート制限の多発** | ① 攻撃元 IP を遮断<br>② サーバーの負荷（CPU・レスポンス）を確認<br>③ 継続するならサインアップを閉じる、一時的に公開を停止 |
| **D: 存在しないアドレスへの試行** | ① 攻撃の下調べの可能性。**本番の攻撃が続くことがある**ので、しばらく様子を見る<br>② 攻撃元 IP を遮断<br>③ 公開範囲を見直す |

### IP の遮断はリバースプロキシで行います

**アプリ側では遮断しません。** プロキシ配下では正しい IP が取れない場合があり、
攻撃者は IP を変えてきます。**ネットワーク側で対処するのが本筋です。**

Caddy の例:

```
@blocked remote_ip 203.0.113.5 198.51.100.0/24
respond @blocked 403
```

Nginx の例:

```nginx
deny 203.0.113.5;
deny 198.51.100.0/24;
```

ufw（サーバー本体）の例:

```bash
sudo ufw deny from 203.0.113.5
```

### 最も効く対策は SSO です

検知と通知は「気づいて対処を始める」ための仕組みで、**攻撃を止めるものではありません。**

**パスワード認証を廃止すれば、攻撃面そのものが消えます。**
設定方法は [`docs/sso-setup.md`](../sso-setup.md) を参照してください。

---

## アップグレード時の注意

### アバター画像は「今回のリリースより前」のものが失われます

**これは一度だけ発生します。**

以前は、アバターがコンテナ内（`/app/data/avatars`）に保存されており、
**ボリュームに置かれていませんでした。** コンテナの書き込みレイヤは、
`docker compose up -d` でコンテナを作り直すたびに破棄されます。

> つまり**以前から、デプロイのたびにアバターは消えていました。**
> 今回のリリースで `avatardata` ボリュームに置くよう直したため、
> **これ以降は消えません。**

| | 以前 | 今回以降 |
|---|---|---|
| 保存先 | コンテナ内（非永続） | ボリューム `avatardata` |
| デプロイ後 | **毎回消える** | 残る |

DB の `avatar_url` は残るため、**画像だけが 404 になります。**
利用者に再設定を案内してください（設定 → プロフィール）。

該当者が居るかは、以下で確認できます。

```bash
docker compose exec postgres psql -U ofuro -d ofuro_wiki \
  -c "SELECT count(*) FROM users WHERE avatar_url IS NOT NULL AND avatar_url <> '';"
```

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

### 初回起動に失敗した後、DB を初期状態からやり直す

PostgreSQL 拡張（pgroonga / pgvector）は **DB ボリュームの初回作成時にのみ**セットアップ
されます。初回起動が途中で失敗した場合（パスワード設定ミス等）、中途半端に初期化された
ボリュームが残り、以降の起動も失敗し続けることがあります。データが入る前なら、
ボリュームごと削除して最初からやり直すのが確実です：

```bash
docker compose down -v   # ⚠ DB データを全削除（運用開始後は絶対に実行しないこと）
docker compose up -d
```

### ログの確認

```bash
docker compose logs app      # アプリログ
docker compose logs postgres # DBログ
```

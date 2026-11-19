# クイックスタート

手元の PC で ofuro-wiki を動かし、ブラウザで触ってみます。10 分ほどで終わります。

::: tip この章は「試す」ためのものです
自分の PC からだけ使う前提です。社内の他の PC から使う場合は、[社内サーバーへの導入](./install-server) に進んでください。
:::

## 用意するもの

- **Docker** が動く PC
  - Windows・Mac は [Docker Desktop](https://www.docker.com/products/docker-desktop/) を入れて起動しておきます
- メモリに 2GB ほどの空き
- インターネット接続（イメージの取得に使います）

## 1. フォルダーと設定ファイルを作る

ターミナルを開き、次を実行します。Windows は PowerShell を使います。

フォルダーを作り、構成ファイル（`docker-compose.yml`）を取ってきます。

::: code-group

```powershell [Windows（PowerShell）]
mkdir ofuro-wiki; cd ofuro-wiki
curl.exe -fsSO https://raw.githubusercontent.com/ulysseus-inc/ofuro-wiki/main/docker-compose.yml
```

```bash [Mac・Linux]
mkdir ofuro-wiki && cd ofuro-wiki
curl -fsSO https://raw.githubusercontent.com/ulysseus-inc/ofuro-wiki/main/docker-compose.yml
```

:::

続けて、設定ファイル（`.env`）を作ります。パスワードなどの秘密の文字列は、その場で乱数から作ります。

`admin@example.com` は、**自分のメールアドレス**に書き換えてから実行してください。このアドレスでサインインした人が **root**（最初のシステム管理者）になります。

::: code-group

```powershell [Windows（PowerShell）]
function New-Secret { $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') }) }
@"
APP_IMAGE=ghcr.io/ulysseus-inc/ofuro-wiki:latest
POSTGRES_IMAGE=ghcr.io/ulysseus-inc/ofuro-wiki-postgres:latest
JWT_SECRET=$(New-Secret)
POSTGRES_PASSWORD=$(New-Secret)
BASE_URL=http://localhost:3010
ROOT_EMAIL=admin@example.com
"@ | Set-Content -Encoding ascii .env
```

```bash [Mac・Linux]
cat > .env <<EOF
APP_IMAGE=ghcr.io/ulysseus-inc/ofuro-wiki:latest
POSTGRES_IMAGE=ghcr.io/ulysseus-inc/ofuro-wiki-postgres:latest
JWT_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 32)
BASE_URL=http://localhost:3010
ROOT_EMAIL=admin@example.com
EOF
```

:::

| 項目 | 意味 |
|---|---|
| `APP_IMAGE`・`POSTGRES_IMAGE` | 使うイメージ。`latest` は最新版を指します。版を指定する場合は `ofuro-wiki:0.3.0` のように版数を書きます。版を書いておくと、勝手に新しい版に変わりません（[版を固定する場合](#版を固定する場合)） |
| `JWT_SECRET` | サインインの状態を守る秘密の文字列 |
| `POSTGRES_PASSWORD` | データベースのパスワード |
| `BASE_URL` | ブラウザで開く URL |
| `ROOT_EMAIL` | root（最初のシステム管理者）にするメールアドレス。2 人目からのシステム管理者は、管理画面で追加できます |

生成した `.env` を開くと、`JWT_SECRET=` の後ろに英数字が並んでいます。
自分で決めた文字列を使う場合は、`.env` を直接書き換えてかまいません。英数字だけで 32 文字以上にしてください。

::: warning
`.env` には秘密の文字列が入ります。人に渡したり、公開の場所に置いたりしないでください。
:::

## 2. 起動する

```bash
docker compose pull
docker compose up -d --no-build
```

初回はイメージの取得に数分かかります。取得したあと、起動に 1〜数分かかります。

起動したかは、次で確かめます。`app` の行が `(healthy)` になれば起動しています。

```bash
docker compose ps
```

## 3. ブラウザで開く

**[http://localhost:3010](http://localhost:3010)** を開きます。

1. `.env` の `ROOT_EMAIL` に書いたメールアドレスを入れ、「続行」を押します
2. パスワードを決めて入れ（8 文字以上）、「サインイン」を押します
3. 「アカウントを作成」の画面が出ます。「**アカウントを作成**」を押します

![アカウントを作成の画面](/images/quickstart/signin.png)

アカウントの無いアドレスでサインインすると、作る前に、この確認の画面が出ます。打ち間違えたときは「ログイン画面に戻る」で戻ります。

サインインすると、ワークスペースが作られ、見本のページが並びます。

![最初のワークスペース](/images/quickstart/workspace.png)

「新規ドキュメント」でページを作り、`/` を打つと、入れられるブロックの一覧が出ます。

## 止める・消す

止める（データは残ります。`docker compose up -d --no-build` でまた動きます）:

```bash
docker compose down
```

試し終わって、**データも含めてすべて消す**:

```bash
docker compose down -v
```

## 設定の補足

### 版を固定する場合

`latest` のままだと、`docker compose pull` のたびに、その時点の最新版に変わります。
勝手に版が変わらないようにしたい場合は、`latest` を版数に置き換えます。

```ini
APP_IMAGE=ghcr.io/ulysseus-inc/ofuro-wiki:0.3.0
POSTGRES_IMAGE=ghcr.io/ulysseus-inc/ofuro-wiki-postgres:0.3.0
```

版数は [リリースの一覧](https://github.com/ulysseus-inc/ofuro-wiki/releases) で確かめます（`v0.3.0` の `v` を除いて書きます）。
2 つは同じ版数にしてください。

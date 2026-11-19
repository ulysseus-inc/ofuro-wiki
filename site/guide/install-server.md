# 社内サーバーへの導入

Ubuntu のサーバー 1 台に ofuro-wiki を入れ、社内の他の PC からブラウザで使えるようにします。

```
社内の PC（ブラウザ。認証局を信頼済み）
   │
   │  https://192.168.1.50（社内 LAN）
   ▼
Ubuntu サーバー
   └ Docker Engine
       ├ Caddy ……… HTTPS の受け口
       ├ ofuro-wiki
       └ PostgreSQL … データ
```

サーバーの電源を入れるだけで、Wiki も起動します。誰かがサインインする必要はありません。

## 用意するもの

| 項目 | 中身 |
|---|---|
| サーバー | **Ubuntu Server 24.04 LTS** が入った PC か仮想マシン（64 ビット）。メモリ 4GB 以上、ディスク 20GB 以上の空き |
| ネットワーク | 社内 LAN につながっていること |
| 権限 | `sudo` が使えるユーザー |
| インターネット | 導入のときだけ使います（ソフトとイメージの取得） |

Ubuntu の入れ方は、[Ubuntu Server の公式の手順](https://ubuntu.com/tutorials/install-ubuntu-server) を見てください。
以下のコマンドは、すべてサーバーの上で実行します（画面の前か、SSH でつないで）。

## 0. サーバーの時刻を日本時間にする

サーバーのタイムゾーンを日本時間にします。[運用](./operation.md) の章で、決まった時刻にバックアップを写すときの基準になります。

```bash
sudo timedatectl set-timezone Asia/Tokyo
timedatectl | grep "Time zone"
```

`Time zone: Asia/Tokyo (JST, +0900)` と出れば完了です。
（参考: [Ubuntu Server インストール直後にやるべき日本語環境・タイムゾーン設定](https://zenn.dev/flosslabs/articles/5240a1e0fdc2f7)）

::: info ofuro-wiki の中の時刻は別に設定します
Docker のコンテナは、サーバーのタイムゾーンを引き継ぎません。ofuro-wiki の中の時刻は、手順 4 の設定ファイル（`TZ`）で日本時間にします。
:::

## 1. サーバーの IP アドレスを固定する

社内の他の PC は、サーバーの **IP アドレス**で Wiki を開きます。IP アドレスが変わると、つながらなくなります。

※ この手順書は、サーバーに社内 LAN の固定の IP アドレスが割り当てられていることを前提にしています。まだのときは、次のように固定します。

1. サーバーで `ip -4 addr` を実行し、社内 LAN の IP アドレスを控えます（例: `192.168.1.50`）
2. この IP アドレスが変わらないようにします。社内ネットワークの管理者に頼むか、ルーターの設定で「DHCP の予約（固定割り当て）」をします

以下、`192.168.1.50` は**自分の IP アドレスに読み替えて**ください。

## 2. Docker Engine を入れる

Docker の公式の手順（[Install Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)）のとおりに入れます。

```bash
# Docker の配布元を登録する
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update

# Docker を入れる
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

サーバーの起動時に Docker も起動するようにし、`sudo` なしで `docker` を使えるようにします。

```bash
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

ここで**一度ログアウトして、ログインし直します**（SSH なら `exit` してつなぎ直す）。そのあと、次で確かめます。

```bash
docker compose version
```

`Docker Compose version v2.…` のように出れば使えます。

## 3. 証明書を作る

社内の PC から HTTPS でつなぐための証明書を、[mkcert](https://github.com/FiloSottile/mkcert) で作ります。
mkcert は、この Wiki 専用の小さな認証局を作り、その認証局で証明書に署名します。

::: details なぜ HTTPS にするのか
HTTP のままだと、パスワードが暗号化されずに社内 LAN を流れます。
また、ブラウザが HTTP のページでは一部の機能を止めるため、別のタブからの貼り付けなどが動きません。
:::

```bash
sudo apt install -y mkcert
mkdir -p ~/ofuro-wiki/certs && cd ~/ofuro-wiki
mkcert -cert-file certs/cert.pem -key-file certs/key.pem 192.168.1.50 localhost
```

`certs` フォルダーに `cert.pem` と `key.pem` ができれば完了です。証明書の期限は 2 年 3 か月です（[証明書を更新する](./operation.md#_4-証明書を更新する)）。
初めて実行したときに、認証局（`~/.local/share/mkcert`）も作られます。
「the local CA is not installed in the system trust store」と出ますが、気にしなくてかまいません。認証局を信頼させるのは、サーバーではなく社内の PC です（手順 6）。

## 4. 設定ファイルを作る

`~/ofuro-wiki` で続けます。ファイルを 4 つ用意します。

**構成ファイル**（`docker-compose.yml`）を取ってきます。

```bash
curl -fsSO https://raw.githubusercontent.com/ulysseus-inc/ofuro-wiki/main/docker-compose.yml
```

**設定**（`.env`）を作ります。**先頭の 2 行を書き換えてから**実行します。

```bash
IP=192.168.1.50            # ← 1. で控えたサーバーの IP アドレス
ROOT_EMAIL=admin@example.com  # ← root（最初のシステム管理者）にする自分のメールアドレス
cat > .env <<EOF
APP_IMAGE=ghcr.io/ulysseus-inc/ofuro-wiki:latest
POSTGRES_IMAGE=ghcr.io/ulysseus-inc/ofuro-wiki-postgres:latest
JWT_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 32)
BASE_URL=https://$IP
ALLOWED_ORIGINS=https://$IP
TRUST_PROXY=1
ROOT_EMAIL=$ROOT_EMAIL
EOF
chmod 600 .env
```

| 項目 | 意味 |
|---|---|
| `BASE_URL` | 社内の PC がブラウザで開く URL |
| `ALLOWED_ORIGINS` | 受け付ける接続元。`BASE_URL` と同じにします |
| `TRUST_PROXY` | Caddy を通して受けるための設定。これが無いと、監査ログの接続元がすべて Caddy になります |

そのほかの項目は [クイックスタート](./quickstart.md#_1-フォルダーと設定ファイルを作る) と同じです。
`chmod 600` で、`.env` を自分だけが読めるようにしています。

**HTTPS の受け口の設定**（`Caddyfile`）を作ります。そのまま実行します。

```bash
cat > Caddyfile <<'EOF'
:443 {
	tls /certs/cert.pem /certs/key.pem
	reverse_proxy app:3010
}

http:// {
	redir https://{host}{uri} permanent
}
EOF
```

**構成の追加**（`docker-compose.override.yml`）を作ります。そのまま実行します。

```bash
cat > docker-compose.override.yml <<'EOF'
services:
  app:
    environment:
      TZ: Asia/Tokyo
    ports: !override
      - "127.0.0.1:3010:3010"

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./certs:/certs:ro
      - caddydata:/data
    depends_on:
      - app

volumes:
  caddydata:
EOF
```

- Caddy が HTTPS（443）で受けて、ofuro-wiki に渡します。HTTP（80）で来たら HTTPS に送り直します
- ofuro-wiki のポート（3010）は、サーバーの中からだけ開けるようにします。社内の PC から暗号化なしで入れないようにするためです
- 時刻を日本時間にします（`TZ`）。これが無いと、自動バックアップが日本時間の昼 12:00 に動きます

## 5. 起動する

```bash
docker compose pull
docker compose up -d --no-build
```

`docker compose ps` で、`app` が `(healthy)` になれば起動しています。初回は数分かかります。

```bash
curl -k https://localhost/api/health
```

`{"status":"ok",…}` と出れば、HTTPS の受け口まで動いています。
起動の途中は `502` が返ります。少し待ってからやり直してください。

構成ファイルの設定（`restart: unless-stopped`）により、サーバーを再起動しても、Wiki は自動で起動します。

::: warning 社内で使い始める前に
初期の設定では新規登録が有効になっており、Wiki の URL を開ける人なら誰でも、自分でアカウントを作れます。
root が最初にサインインしたら、必要に応じて [初期設定](./initial-setup.md#_2-新規登録を無効にする) の章で新規登録を無効にしてください。
:::

## 6. 他の PC から開く

社内の PC が、手順 3 で作った認証局を信頼するように設定します。**PC ごとに 1 回**行います。

### 認証局のファイルを配る

配るのは、サーバーの `~/.local/share/mkcert/rootCA.pem` **だけ**です。
社内の PC から、次のように取ってこられます（Windows は PowerShell で実行します。`user` はサーバーのユーザー名です）。

```bash
scp user@192.168.1.50:.local/share/mkcert/rootCA.pem .
```

::: danger rootCA-key.pem は配らない
同じフォルダーの `rootCA-key.pem` は、認証局の鍵です。これがあると、どのサイトの偽の証明書でも作れてしまいます。
サーバーから出さないでください。
:::

### 社内の PC で信頼する（Windows）

1. `rootCA.pem` の名前を `rootCA.crt` に変えます
2. ダブルクリック →「証明書のインストール」
3. 「ローカル コンピューター」を選びます
4. 「証明書をすべて次のストアに配置する」→「信頼されたルート証明機関」を選びます
5. 完了したら、ブラウザを開き直します

Mac の場合は、ターミナルで次を実行します。

```bash
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain rootCA.pem
```

### 開く

社内の PC のブラウザで **https://192.168.1.50** を開きます。鍵のマークが出て、警告が出なければ完了です。

最初のサインインは、`.env` の `ROOT_EMAIL` のアドレスで行います（[クイックスタートの 3.](./quickstart.md#_3-ブラウザで開く) と同じです）。

::: details つながらないとき
サーバーでファイアウォール（ufw）を有効にしている場合は、80 と 443 を開けます。

```bash
sudo ufw allow 80,443/tcp
```

Ubuntu Server の初期の状態では、ufw は無効です（`sudo ufw status` で `inactive`）。
:::

## 7. 動作を確かめる

1. 社内の PC 2 台から、同じページを開きます
2. 片方で文字を打ち、もう片方にすぐ出ることを確かめます
3. サーバーを再起動し（`sudo reboot`）、数分待ちます。誰も触らずに、社内の PC から開けることを確かめます

ここまでできれば、導入は完了です。次は [初期設定](./initial-setup.md) に進みます。

# 付録: Windows PC で導入する

Linux のサーバーを用意できない場合に、Windows PC 1 台を社内 Wiki のサーバーにする手順です。

::: tip できれば Ubuntu を使ってください
Windows では、Docker Desktop を動かし続けるために、自動サインインなどの手当てが要ります。
サーバーを用意できるなら、[社内サーバーへの導入](./install-server)（Ubuntu）を勧めます。
:::

```
社内の PC（ブラウザ。認証局を信頼済み）
   │
   │  https://192.168.1.50（社内 LAN）
   ▼
Wiki 用の Windows PC
   └ Docker Desktop
       ├ Caddy ……… HTTPS の受け口
       ├ ofuro-wiki
       └ PostgreSQL … データ
```

::: danger Docker Desktop が起動していないと、Wiki は動きません
Docker Desktop は、Windows にサインインしたときに起動するアプリです。
Windows Update・停電・再起動のあと、**誰かがサインインするまで Wiki は止まったまま**です。
この章の [7. 再起動に備える](#_7-再起動に備える) で、自動でサインインするように設定します。
:::

## 用意するもの

| 項目 | 中身 |
|---|---|
| PC | Windows 11（64 ビット）。メモリ 8GB 以上 |
| ネットワーク | 社内 LAN に有線でつなぐことを勧めます |
| 管理者の権限 | その PC にソフトを入れられること |
| インターネット | 導入のときだけ使います（ソフトとイメージの取得） |

この PC は、Wiki 専用にすることを勧めます。普段使いの PC だと、電源を切られたり、再起動されたりして Wiki が止まります。

## 1. IP アドレスを固定する

社内の他の PC は、この PC の **IP アドレス**で Wiki を開きます。IP アドレスが変わると、つながらなくなります。

1. PowerShell で `ipconfig` を実行し、社内 LAN の「IPv4 アドレス」を控えます（例: `192.168.1.50`）
   - `vEthernet (WSL)` の行は Docker が使うものです。見ません
2. この IP アドレスが変わらないようにします。社内ネットワークの管理者に頼むか、ルーターの設定で「DHCP の予約（固定割り当て）」をします

以下、`192.168.1.50` は**自分の IP アドレスに読み替えて**ください。

## 2. Docker Desktop を入れる

1. [Docker Desktop](https://www.docker.com/products/docker-desktop/) から Windows 用のインストーラーを取ってきて、実行します
2. 「Use WSL 2 instead of Hyper-V」に印を付けたまま進めます
3. 終わったら、Windows を再起動します
4. Docker Desktop を起動し、利用規約に同意します。Docker のアカウントでのサインインは要りません（飛ばせます）
5. PowerShell を開き直し、次で動いているかを確かめます

```powershell
docker compose version
```

`Docker Compose version v2.…` のように出れば使えます。

::: tip
Docker Desktop のライセンスは [こちら](https://docs.docker.com/subscription/desktop-license/)
:::

## 3. 証明書を作る

社内の PC から HTTPS でつなぐための証明書を、[mkcert](https://github.com/FiloSottile/mkcert) で作ります。
mkcert は、この Wiki 専用の小さな認証局を作り、その認証局で証明書に署名します。

::: details なぜ HTTPS にするのか
HTTP のままだと、パスワードが暗号化されずに社内 LAN を流れます。
また、ブラウザが HTTP のページでは一部の機能を止めるため、別のタブからの貼り付けなどが動きません。
:::

PowerShell で mkcert を入れます。

```powershell
winget install FiloSottile.mkcert
```

入れたら **PowerShell を開き直し**、Wiki 用のフォルダーを作って証明書を作ります。

```powershell
mkdir C:\ofuro-wiki; cd C:\ofuro-wiki
mkcert -install
mkdir certs
mkcert -cert-file certs\cert.pem -key-file certs\key.pem 192.168.1.50 localhost
```

- `mkcert -install` で「証明書をインストールしますか」と聞かれたら「はい」を押します
- `certs` フォルダーに `cert.pem` と `key.pem` ができれば完了です

## 4. 設定ファイルを作る

`C:\ofuro-wiki` で続けます。ファイルを 4 つ用意します。

**構成ファイル**（`docker-compose.yml`）を取ってきます。

```powershell
curl.exe -fsSO https://raw.githubusercontent.com/ulysseus-inc/ofuro-wiki/main/docker-compose.yml
```

**設定**（`.env`）を作ります。**先頭の 2 行を書き換えてから**実行します。

```powershell
$ip = '192.168.1.50'                # ← 1. で控えた PC の IP アドレス
$rootEmail = 'admin@example.com'    # ← root（最初のシステム管理者）にする自分のメールアドレス
function New-Secret { $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') }) }
@"
APP_IMAGE=ghcr.io/ulysseus-inc/ofuro-wiki:latest
POSTGRES_IMAGE=ghcr.io/ulysseus-inc/ofuro-wiki-postgres:latest
JWT_SECRET=$(New-Secret)
POSTGRES_PASSWORD=$(New-Secret)
BASE_URL=https://$ip
ALLOWED_ORIGINS=https://$ip
TRUST_PROXY=1
ROOT_EMAIL=$rootEmail
"@ | Set-Content -Encoding ascii .env
```

| 項目 | 意味 |
|---|---|
| `BASE_URL` | 社内の PC がブラウザで開く URL |
| `ALLOWED_ORIGINS` | 受け付ける接続元。`BASE_URL` と同じにします |
| `TRUST_PROXY` | Caddy を通して受けるための設定。これが無いと、監査ログの接続元がすべて Caddy になります |

そのほかの項目は [クイックスタート](./quickstart#_1-フォルダーと設定ファイルを作る) と同じです。

**HTTPS の受け口の設定**（`Caddyfile`）を作ります。そのまま実行します。

```powershell
@'
:443 {
	tls /certs/cert.pem /certs/key.pem
	reverse_proxy app:3010
}

http:// {
	redir https://{host}{uri} permanent
}
'@ | Set-Content -Encoding ascii Caddyfile
```

**構成の追加**（`docker-compose.override.yml`）を作ります。そのまま実行します。

```powershell
@'
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
'@ | Set-Content -Encoding ascii docker-compose.override.yml
```

- Caddy が HTTPS（443）で受けて、ofuro-wiki に渡します。HTTP（80）で来たら HTTPS に送り直します
- ofuro-wiki のポート（3010）は、この PC の中からだけ開けるようにします。社内の PC から暗号化なしで入れないようにするためです
- 時刻を日本時間にします（`TZ`）。これが無いと、自動バックアップが日本時間の昼 12:00 に動きます

## 5. 起動する

```powershell
docker compose pull
docker compose up -d --no-build
```

`docker compose ps` で、`app` が `(healthy)` になれば起動しています。初回は数分かかります。

この PC のブラウザで **https://192.168.1.50** を開き、サインインの画面が出るかを確かめます。
起動の途中は `502` と出ます。少し待ってから開き直してください。

最初のサインインは、`.env` の `ROOT_EMAIL` のアドレスで行います（[クイックスタートの 3.](./quickstart#_3-ブラウザで開く) と同じです）。

::: warning 社内で使い始める前に
初期の設定では新規登録が有効になっており、Wiki の URL を開ける人なら誰でも、自分でアカウントを作れます。
root が最初にサインインしたら、必要に応じて [初期設定](./initial-setup#_2-新規登録を無効にする) の章で新規登録を無効にしてください。
:::

## 6. 他の PC から開く

社内の PC が、手順 3 で作った認証局を信頼するように設定します。**PC ごとに 1 回**行います。

### 認証局のファイルを配る

Wiki 用の PC で、次を実行すると、認証局のフォルダーが出ます。

```powershell
mkcert -CAROOT
```

その中の **`rootCA.pem` だけ**を、共有フォルダーや USB メモリで社内の PC に配ります。

::: danger rootCA-key.pem は配らない
同じフォルダーの `rootCA-key.pem` は、認証局の鍵です。これがあると、どのサイトの偽の証明書でも作れてしまいます。
Wiki 用の PC から出さないでください。
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

つながらないときは、Wiki 用の PC で次を確かめます。

- 「Windows セキュリティの重要な警告」が出ていたら、プライベート ネットワークでのアクセスを許可します
- 設定 → ネットワークとインターネット → 使っている接続 →「ネットワーク プロファイルの種類」が **プライベート** になっているか

## 7. 再起動に備える

Wiki 用の PC が再起動しても、人の手を借りずに Wiki が戻るようにします。

### Docker Desktop をサインイン時に起動する

Docker Desktop の Settings → General →「**Start Docker Desktop when you sign in to your computer**」に印を付けます。

ofuro-wiki の構成は、Docker が起動すると自動で立ち上がるようになっています。

### Windows に自動でサインインする

Microsoft の [Autologon](https://learn.microsoft.com/ja-jp/sysinternals/downloads/autologon) を使います。

1. Autologon を取ってきて、`Autologon64.exe` を実行します
2. Username・Domain・Password に、この PC にサインインするアカウントを入れます
3. 「Enable」を押します

パスワードは、Windows の中に暗号化して保存されます。

::: warning
自動サインインにすると、PC の前に座った人は誰でも操作できます。
PC は鍵のかかる場所に置いてください。起動したあとは `Windows キー + L` でロックしてかまいません（ロック中も Wiki は動きます）。
:::

### スリープさせない

設定 → システム → 電源 →「画面とスリープ」で、**電源接続時にスリープ** を「なし」にします。
スリープすると Wiki は止まります。

### 更新の再起動を夜間にする

設定 → Windows Update → 詳細オプション →「アクティブ時間」を、業務の時間に合わせます。
この時間には、更新のための再起動が起きません。

## 8. 動作を確かめる

1. 社内の PC 2 台から、同じページを開きます
2. 片方で文字を打ち、もう片方にすぐ出ることを確かめます
3. Wiki 用の PC を再起動し、数分待ちます。誰も触らずに、社内の PC から開けることを確かめます

ここまでできれば、導入は完了です。次は [初期設定](./initial-setup) に進みます。

# パターン A：ドメインあり（Let's Encrypt 自動HTTPS）

## このパターンの特徴

| 項目 | 内容 |
|------|------|
| **条件** | 独自ドメインあり、インターネット接続あり |
| **HTTPS** | Let's Encrypt が自動取得・自動更新 |
| **ブラウザ警告** | なし |
| **クリップボード** | フル機能（Ctrl+C/V、右クリックコピー） |
| **向き不向き** | 本番運用、外部公開、チームWiki |

## 前提

- DNS で `wiki.example.com` → サーバーIPアドレス のAレコードが設定済み
- サーバーの **80番・443番ポート** がインターネットに開放済み（Let's Encrypt の認証に必要）

---

## セットアップ手順

まず [共通セットアップ](./README.md#共通セットアップ手順) を完了させてから、以下のリバースプロキシ設定を行ってください。

`.env` の `BASE_URL` を設定します：
```bash
BASE_URL=https://wiki.example.com
```

---

## オプション 1：Caddy（推奨）

Caddy は Let's Encrypt の証明書取得・更新を完全自動化してくれます。設定が最も簡単です。

### インストール

```bash
# Ubuntu/Debian
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

### Caddyfile の設定

`/etc/caddy/Caddyfile` に書き込みます（[Caddyfile サンプル](./Caddyfile) を参考に）：

```
wiki.example.com {
    @websocket {
        header Connection *Upgrade*
        header Upgrade websocket
    }
    reverse_proxy @websocket localhost:3010

    reverse_proxy localhost:3010 {
        header_up X-Forwarded-Proto {scheme}
    }

    request_body {
        max_size 100MB
    }
}
```

### 起動

```bash
sudo systemctl reload caddy
```

Caddy が自動的に Let's Encrypt から証明書を取得します。

---

## オプション 2：Nginx + Certbot

### インストール

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

### SSL証明書の取得

```bash
sudo certbot --nginx -d wiki.example.com
```

### Nginx 設定

`/etc/nginx/sites-available/ofuro-wiki` に書き込みます（[nginx.conf サンプル](./nginx.conf) を参考に）：

```nginx
server {
    listen 80;
    server_name wiki.example.com;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl http2;
    server_name wiki.example.com;

    ssl_certificate     /etc/letsencrypt/live/wiki.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/wiki.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;

    client_max_body_size 100m;

    location /socket.io/ {
        proxy_pass http://localhost:3010;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    location / {
        proxy_pass http://localhost:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

### 有効化

```bash
sudo ln -s /etc/nginx/sites-available/ofuro-wiki /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

---

## 他サービスと同居する場合（バーチャルホスト追加）

既存の Nginx/Caddy がすでに別サービスを配信している場合、**新しいバーチャルホストとして追加**します。
既存の設定ファイルは絶対に上書きしないでください。

### Nginx の場合

#### 1. SSL 証明書の取得（新ドメイン分のみ）

```bash
# ofuro-wiki のドメインのみ証明書を取得
# Nginx を停止する必要はなく、--nginx プラグインが既存設定を読んで自動で処理する
sudo certbot --nginx -d wiki.example.com
```

#### 2. 新しいバーチャルホスト設定ファイルを作成

**既存の設定ファイルとは別ファイル**（例: `/etc/nginx/sites-available/ofuro-wiki`）に書き込みます：

```nginx
server {
    listen 80;
    server_name wiki.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name wiki.example.com;

    ssl_certificate     /etc/letsencrypt/live/wiki.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/wiki.example.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    client_max_body_size 100m;

    location /socket.io/ {
        proxy_pass http://localhost:3010;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }

    location / {
        proxy_pass http://localhost:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 60s;
    }
}
```

#### 3. 有効化

```bash
sudo ln -s /etc/nginx/sites-available/ofuro-wiki /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

> **ポート競合に注意**: ofuro-wiki アプリは `localhost:3010` で動作します。
> 既存サービスと同じポートを使っていないか確認してください。
> `docker compose` の `ports` 設定でホスト側ポートを変更できます。

---

## 動作確認

ブラウザで `https://wiki.example.com` にアクセスし、鍵マークが表示されれば完了です。

```bash
curl -I https://wiki.example.com/api/health
```

# パターン B：ドメインなし・IPアドレスアクセス（mkcert 自己署名HTTPS）

## このパターンの特徴

| 項目 | 内容 |
|------|------|
| **条件** | IPアドレスでアクセス（ドメイン不要）、完全オフライン可 |
| **HTTPS** | mkcert による自己署名証明書 |
| **ブラウザ警告** | クライアントへの **rootCA 配布が必要**（一度設定すれば警告なし） |
| **クリップボード** | フル機能（Ctrl+C/V、右クリックコピー） |
| **向き不向き** | 社内クローズドLAN、インターネット非接続環境 |

## 仕組み

mkcert はローカル認証局（rootCA）を作成し、その CA で署名した証明書を生成します。
クライアントが rootCA を信頼すれば、ブラウザ警告なしで HTTPS が使えます。

```
[サーバー]
mkcert で rootCA を作成
↓
mkcert で <server-ip> の証明書を発行（rootCA で署名）
↓
Nginx がその証明書を使って HTTPS 接続を提供

[クライアント（各PCのブラウザ）]
rootCA.pem をOSにインストール（一回限り）
→ 警告なしで https://<server-ip> にアクセス可能
```

---

## セットアップ手順

まず [共通セットアップ](./README.md#共通セットアップ手順) を完了させてから、以下を行ってください。

`.env` の `BASE_URL` を設定します：
```bash
BASE_URL=https://<server-ip>  # サーバーのIPアドレスに合わせる
```

---

### ステップ 1：mkcert のインストール（サーバー側）

```bash
# Ubuntu/Debian
sudo apt install -y libnss3-tools
curl -JLO "https://dl.filippo.io/mkcert/latest?for=linux/amd64"
chmod +x mkcert-v*-linux-amd64
sudo mv mkcert-v*-linux-amd64 /usr/local/bin/mkcert
```

### ステップ 2：rootCA の作成（サーバー側）

```bash
mkcert -install
```

rootCA の場所を確認します（後でクライアントに配布します）：
```bash
mkcert -CAROOT
# 例: /root/.local/share/mkcert
```

### ステップ 3：証明書の発行（サーバー側）

```bash
# IPアドレスで証明書を発行（必要に応じてIPを変更）
mkcert -cert-file /etc/ssl/ofuro-wiki/cert.pem \
       -key-file  /etc/ssl/ofuro-wiki/key.pem \
       <server-ip>

sudo mkdir -p /etc/ssl/ofuro-wiki
sudo mkcert -cert-file /etc/ssl/ofuro-wiki/cert.pem \
            -key-file  /etc/ssl/ofuro-wiki/key.pem \
            <server-ip>
```

> **複数のIPやホスト名でアクセスする場合** は、証明書に全て含めます：
> ```bash
> sudo mkcert -cert-file /etc/ssl/ofuro-wiki/cert.pem \
>             -key-file  /etc/ssl/ofuro-wiki/key.pem \
>             <server-ip> ofuro-wiki.local localhost
> ```

---

### ステップ 4：Nginx の設定（サーバー側）

```bash
sudo apt install -y nginx
```

`/etc/nginx/sites-available/ofuro-wiki` を作成：

```nginx
# HTTP → HTTPS リダイレクト
server {
    listen 80;
    server_name <server-ip>;
    return 301 https://$host$request_uri;
}

# HTTPS
server {
    listen 443 ssl http2;
    server_name <server-ip>;

    ssl_certificate     /etc/ssl/ofuro-wiki/cert.pem;
    ssl_certificate_key /etc/ssl/ofuro-wiki/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;

    client_max_body_size 100m;

    # WebSocket（Yjs リアルタイム同期）
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

有効化：
```bash
sudo ln -s /etc/nginx/sites-available/ofuro-wiki /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl enable --now nginx
```

---

### ステップ 5：rootCA をクライアントに配布（クライアント側）

サーバーの rootCA ファイルを各クライアントにコピーします：

```bash
# サーバー側で rootCA のパスを確認
mkcert -CAROOT
# 例: /root/.local/share/mkcert/rootCA.pem
```

#### Windows クライアント

1. `rootCA.pem` をサーバーからコピー（例: USB、共有フォルダ）
2. ファイルを `rootCA.crt` にリネーム
3. ダブルクリック → 「証明書のインストール」→「ローカルコンピューター」→「信頼されたルート証明機関」に保存
4. Chrome/Edge は自動的に認識される

#### macOS クライアント

```bash
# rootCA.pem をコピー後
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain rootCA.pem
```

#### Linux クライアント（Ubuntu/Debian）

```bash
sudo cp rootCA.pem /usr/local/share/ca-certificates/ofuro-wiki-rootCA.crt
sudo update-ca-certificates
# Chrome/Chromiumは追加作業が必要
certutil -d sql:$HOME/.pki/nssdb -A -t "CT,," -n "ofuro-wiki" -i rootCA.pem
```

---

## 動作確認

クライアントで rootCA インストール後、ブラウザで `https://<server-ip>` にアクセスし、鍵マークが表示されれば完了です。

---

## rootCA を配布できない場合（個人利用・簡易確認）

チームメンバー全員への rootCA 配布が困難な場合、ブラウザの警告画面で「詳細設定」→「（サイト）にアクセスする（安全ではありません）」をクリックすることでアクセスできます。

ただし、この方法では **WebSocket（Yjs同期）が動作しない** ことがあります。
複数人での利用が前提の場合は rootCA 配布を推奨します。

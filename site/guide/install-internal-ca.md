# 社内のドメイン名・認証局を使う

[社内サーバーへの導入](./install-server) では、IP アドレスと mkcert で HTTPS にしました。
社内に DNS や認証局がある場合は、次のようにできます。どちらか片方だけでもかまいません。

| | できること |
|---|---|
| [社内のドメイン名で開く](#社内のドメイン名で開く) | `https://wiki.corp.example.com` のような名前で開ける。サーバーの IP アドレスが変わっても、DNS を直すだけで済む |
| [社内の認証局の証明書を使う](#社内の認証局の証明書を使う) | 社内の PC が、すでにその認証局を信頼していれば、`rootCA.pem` を配らなくて済む |

以下、`wiki.corp.example.com` は**自分の社内のドメイン名に読み替えて**ください。

## 社内のドメイン名で開く

### 1. DNS に登録する

社内ネットワークの管理者に頼み、`wiki.corp.example.com` がサーバーの IP アドレス（例: `192.168.1.50`）を指すようにします。

社内の PC で確かめます。

```bash
nslookup wiki.corp.example.com
```

サーバーの IP アドレスが出れば登録できています。

::: tip `.local` は使わない
`wiki.local` のような `.local` の名前は、DNS とは別の仕組み（mDNS）で使われるため、PC によっては引けません。
:::

### 2. 名前の入った証明書を作る

mkcert を使う場合は、名前を足して作り直します。

```bash
cd ~/ofuro-wiki
mkcert -cert-file certs/cert.pem -key-file certs/key.pem wiki.corp.example.com 192.168.1.50 localhost
```

社内の認証局を使う場合は、[下の手順](#社内の認証局の証明書を使う) で、この名前の証明書をもらいます。

### 3. `.env` を直して、起動し直す

`.env` の `BASE_URL` と `ALLOWED_ORIGINS` を、名前に変えます。

```ini
BASE_URL=https://wiki.corp.example.com
ALLOWED_ORIGINS=https://wiki.corp.example.com
```

```bash
docker compose up -d --no-build
docker compose restart caddy
```

社内の PC で `https://wiki.corp.example.com` を開き、警告が出なければ完了です。

- 社員には、新しい URL を知らせてください。古い URL（IP アドレス）のブックマークは、作り直してもらいます
- SSO を使っているなら、IdP 側のリダイレクト URI も直します（[連携](./integration#_1-リダイレクト-uri-を控える)）
- AI 用の CLI を使っている人は、新しい URL で `login` し直します

## 社内の認証局の証明書を使う

Active Directory 証明書サービスなど、社内の認証局がある場合です。社内の PC がその認証局を信頼していれば、mkcert の `rootCA.pem` を配る手間がなくなります。

### 1. 証明書を発行してもらう

認証局の管理者に、次の条件で、サーバーの証明書を頼みます。

| 項目 | 中身 |
|---|---|
| サブジェクトの別名（SAN） | 開くときの名前（`wiki.corp.example.com`）。IP アドレスでも開くなら、IP アドレスも |
| 形式 | PEM。証明書と秘密鍵を別のファイルで |
| 秘密鍵 | パスワードをかけない（Caddy が起動するときに読むため） |

`.pfx` でしか出せない場合は、PEM への変換も、認証局の管理者に相談してください。

### 2. 証明書を置き換える

`~/ofuro-wiki/certs` の 2 つのファイルを置き換えます。

| ファイル | 中身 |
|---|---|
| `cert.pem` | サーバーの証明書。中間の証明書があれば、その後ろに続けて入れる |
| `key.pem` | 秘密鍵 |

```bash
chmod 600 ~/ofuro-wiki/certs/key.pem
docker compose restart caddy
```

社内の PC で開き、警告が出なければ完了です。mkcert の `rootCA.pem` を配っていた PC からは、消してかまいません。

### 3. 期限が来たら更新する

社内の認証局の証明書には、期限があります（1〜2 年が多い）。期限の前に発行し直してもらい、2. と同じく置き換えて `docker compose restart caddy` します。

::: warning AI 用の CLI は、社内の認証局も見ません
Node.js は、PC の信頼している認証局を見ません。社内の認証局でも、`NODE_EXTRA_CA_CERTS` に、その認証局の証明書（PEM）の場所を設定します（[連携](./integration#ai-エージェント側-使う人の-pc)）。
:::

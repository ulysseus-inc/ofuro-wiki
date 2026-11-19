# 困ったとき

よくある症状と、直し方です。コマンドは、サーバーの `~/ofuro-wiki` で実行します。

## まず見るところ

```bash
docker compose ps                  # 動いているか
docker compose logs app --tail 50  # ofuro-wiki の記録（最後の 50 行）
```

| `docker compose ps` の `app` | 状態 |
|---|---|
| `Up … (healthy)` | 動いています |
| `Up … (health: starting)` | 起動の途中です。数分待ちます |
| `Restarting` | 起動に失敗し、やり直し続けています。記録を見ます（[起動しない](#起動しない)） |

## 起動しない

### 記録に `JWT_SECRET must be at least 32 characters long` と出る

`.env` の `JWT_SECRET` が短すぎます。英数字だけで 32 文字以上にして、`docker compose up -d --no-build` で起動し直します。

::: warning 動いている Wiki の `JWT_SECRET` は変えない
変えると、全員のサインインが切れます。SSO のシークレットも入れ直しになります（[連携](./integration#sso-の注意)）。
:::

### 記録に `P1000: Authentication failed against database server` と出る

`.env` の `POSTGRES_PASSWORD` が、**最初に起動したときの値**と違います。
DB のパスワードは、最初の起動のときに決まり、後から `.env` を変えても変わりません。

`.env` の `POSTGRES_PASSWORD` を、控えておいた元の値に戻して、起動し直します。

### `address already in use` と出て起動しない

ポート（80・443・3010）を、ほかのソフトが使っています。どのソフトかを調べます。

```bash
sudo ss -ltnp | grep -E ':(80|443|3010) '
```

そのソフトを止めるか、別のサーバーに入れます。

### ブラウザで開くと `502` が出る

ofuro-wiki が起動の途中です。`docker compose ps` で `app` が `(healthy)` になるまで待ちます。
ずっと `502` のままなら、`app` が起動に失敗しています。上の記録を見ます。

## ブラウザで開けない

### 「この接続ではプライバシーが保護されません」と出る

警告の画面に出る文字で、原因が分かります。

| 出る文字 | 原因 | 直し方 |
|---|---|---|
| `NET::ERR_CERT_AUTHORITY_INVALID` | その PC が、認証局を信頼していない | [他の PC から開く](./install-server#_6-他の-pc-から開く) の手順で信頼させる。ブラウザを開き直す |
| `NET::ERR_CERT_COMMON_NAME_INVALID` | 開いたアドレスが、証明書に入っていない | 下の「サーバーの IP アドレスが変わった」 |
| `NET::ERR_CERT_DATE_INVALID` | 証明書の期限が切れた | [証明書を更新する](./operation#_4-証明書を更新する) |

警告を無視して進むのはやめてください。パスワードを盗み見られても気付けません。

### サーバーの IP アドレスが変わった

証明書と `.env` に、古い IP アドレスが入っています。新しい IP アドレス（例: `192.168.1.60`）で作り直します。

```bash
cd ~/ofuro-wiki
mkcert -cert-file certs/cert.pem -key-file certs/key.pem 192.168.1.60 localhost
```

`.env` の `BASE_URL` と `ALLOWED_ORIGINS` を `https://192.168.1.60` に直してから、起動し直します。

```bash
docker compose up -d --no-build
docker compose restart caddy
```

- 認証局は同じなので、社内の PC に配り直す必要はありません
- SSO を使っているなら、IdP 側のリダイレクト URI も直します
- また変わらないよう、IP アドレスを固定してください（[サーバーの IP アドレスを固定する](./install-server#_1-サーバーの-ip-アドレスを固定する)）

### 何も表示されず、時間切れになる

- サーバーの電源が入っているか、`docker compose ps` で動いているか
- 開いている IP アドレスが正しいか
- サーバーのファイアウォール（ufw）で、80 と 443 を開けているか（[他の PC から開く](./install-server#_6-他の-pc-から開く) の「つながらないとき」）

## サインインできない

### 「このパスワードは無効です」と出る

次のどれかです。画面ではどれか区別できません（攻撃者に手がかりを与えないため）。

| 原因 | 直し方 |
|---|---|
| パスワードの間違い | システム管理者が、パスワード変更 URL を発行する（[パスワードを忘れた](./users-and-access#_5-パスワードを忘れた・端末をなくした)） |
| アカウントが無い（新規登録を無効にしている） | システム管理者がアカウントを作るか、ワークスペースに招待する（[ユーザーを追加する](./users-and-access#_1-ユーザーを追加する)） |
| 続けて 10 回間違えて、ロックされた | 15 分待つ |

### root のパスワードを忘れた・システム管理者が全員パスワードを忘れた

root のパスワードは、ほかのシステム管理者にも変えられません。`ROOT_EMAIL` を使って、別のユーザーを一時的に root にします。パスワードが分かっているユーザーが 1 人いれば戻せます。

1. `.env` の `ROOT_EMAIL` を、そのユーザーのメールアドレスに書き換えます
2. `docker compose up -d --no-build` で起動し直します。そのユーザーが root になります（元の root はシステム管理者になります）
3. そのユーザーでサインインし、設定 →「ユーザー管理」で元の root のパスワードを再設定します
4. `.env` の `ROOT_EMAIL` を元に戻し、もう一度起動し直します
5. 一時的に root にしたユーザーは、システム管理者のまま残ります。管理者にしておかない人なら、設定 →「ユーザー管理」でその人のスイッチをオフにします

共有ワークスペースの持ち主も、そのたびに今の root に移ります。4. で元に戻ります。

### SSO で `redirect_uri_mismatch` と出る

IdP 側に登録したリダイレクト URI が、管理画面に出ている値と違います。`http` と `https`、末尾の `/` まで同じにします。
ほかの症状は [SSO の設定（詳細）の「うまくいかないときは」](https://github.com/ulysseus-inc/ofuro-wiki/blob/main/docs/sso-setup.md#うまくいかないときは) を見てください。

## 使っているとき

| 症状 | 原因 | 直し方 |
|---|---|---|
| 別のタブからの貼り付けが効かない | `http://` で開いている | `https://` で開く（[社内サーバーへの導入](./install-server)） |
| 自動バックアップが昼の 12:00 に動く | ofuro-wiki の中の時刻が日本時間でない | `docker-compose.override.yml` に `TZ: Asia/Tokyo` を足す（[設定ファイルを作る](./install-server#_4-設定ファイルを作る)）。起動し直す |
| 監査ログの接続元が、全員同じアドレスになる | `.env` に `TRUST_PROXY=1` が無い | 足して、起動し直す |
| URL は正しいのに、AI が「サーバーに接続できない」で失敗する | Node.js が、認証局を見ていない | `NODE_EXTRA_CA_CERTS` を設定する（[連携](./integration#ai-エージェント側-使う人の-pc)） |
| 始業時など、サインインが集中すると遅い | パスワードの照合は、わざと重くしてある | [デプロイガイドの「同時ログインが集中すると遅い」](https://github.com/ulysseus-inc/ofuro-wiki/blob/main/docs/deploy/README.md#始業時など同時ログインが集中すると遅いタイムアウトする) |

## それでも直らないとき

次の 3 つを添えて、開発元に相談してください。

1. 版（設定 →「ofuro-wikiについて」）
2. `docker compose ps` の結果
3. `docker compose logs app --tail 200` の結果

記録には、メールアドレスなどが入っていることがあります。渡す前に確かめてください。

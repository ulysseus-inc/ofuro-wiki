# 連携

ほかの仕組みとつなぐ設定です。どちらも必要なときだけ行います。

| 連携 | できること |
|---|---|
| [シングルサインオン（SSO）](#シングルサインオン-sso) | 社内の Google Workspace・Microsoft Entra ID・Keycloak などのアカウントでサインインする |
| [AI エージェント](#ai-エージェント) | Claude Code などの AI に、ページを検索・閲覧・編集させる |

## シングルサインオン（SSO）

ofuro-wiki は OpenID Connect（OIDC）に対応しています。設定は管理画面だけで済み、`.env` の編集や再起動は要りません。

| IdP | 状態 |
|---|---|
| Google Workspace（「内部」で公開したアプリ）・Keycloak | 動作を確かめています |
| Microsoft Entra ID・Okta ほか | 対応する見込みです（確かめていません） |

### 1. リダイレクト URI を控える

設定 →「**サーバー設定**」→「**シングルサインオン（OIDC）**」の「**リダイレクト URI**」を、「コピー」で控えます。

```
https://192.168.1.50/oauth/callback
```

この値は `.env` の `BASE_URL` から作られます。IdP 側には、1 文字も違えずに登録します。

### 2. IdP 側にアプリを登録する

**Google Workspace**

1. [Google Cloud Console](https://console.cloud.google.com/) で、プロジェクトを選ぶ（または作る）
2. 「API とサービス」→「OAuth 同意画面」で、ユーザーの種類を「**内部**」にする
3. 「認証情報」→「認証情報を作成」→「OAuth クライアント ID」。種類は「ウェブ アプリケーション」、「承認済みのリダイレクト URI」に 1. の値を入れる
4. クライアント ID とクライアント シークレットを控える。発行者 URL は `https://accounts.google.com`
   - クライアント ID は `….apps.googleusercontent.com` で終わり、シークレットは `GOCSPX-` で始まる 35 文字ほどの文字列です

**Keycloak**

1. realm →「Clients」→「Create client」（OpenID Connect）
2. `Client authentication` をオン、`Standard flow` をオン
3. `Valid redirect URIs` に 1. の値を入れる
4. 「Credentials」タブの Client secret を控える。発行者 URL は `https://<Keycloak のホスト>/realms/<realm 名>`

**Microsoft Entra ID**

1. 「アプリの登録」→「新規登録」。リダイレクト URI は「Web」で 1. の値
2. 「証明書とシークレット」でシークレットを作り、値を控える（作った直後しか見られません）
3. 発行者 URL は `https://login.microsoftonline.com/<テナント ID>/v2.0`（`common` は使えません）
4. 「メールアドレスのクレーム名」に `upn` を足します（例: `email,upn`）

### 3. ofuro-wiki 側で設定する

設定 →「サーバー設定」→「シングルサインオン（OIDC）」に入れます。入れた値は、その場で保存されます。

| 項目 | 入れるもの |
|---|---|
| 発行者 URL（Issuer） | 2. の発行者 URL |
| クライアント ID・クライアントシークレット | 2. で控えた値（シークレットは保存後は表示されません。発行者 URL を別の値に変えると消えるので、入れ直します） |
| ボタンの表示名 | サインイン画面のボタンの文字（例: `社内アカウントでサインイン`） |
| 未登録の利用者を SSO サインイン時に自動作成する | 下の表で決める |

「**接続をテスト**」で、発行者 URL と、保存したクライアント ID・シークレットの組み合わせが正しいかを確かめてから、「**シングルサインオンを有効にする**」をオンにします。
リダイレクト URI の誤りは接続のテストでは分からないので、最後に実際にサインインして確かめてください。

![SSO の設定](/images/integration/sso-settings.png)

サインイン画面にボタンが出ます。押すと新しいタブで IdP の画面が開き、サインインすると ofuro-wiki に入れます。

![SSO のボタン](/images/integration/sso-signin.png)

### 自動作成をオンにするか

| IdP | 自動作成 | 理由 |
|---|:-:|---|
| 社内の人だけが使える（Workspace の「内部」・Entra ID・Keycloak） | オン | 入社した人が、すぐ使える |
| 社外の人も使える（一般の Google アカウントなど） | **オフ** | オンにすると、その IdP にサインインできる人が**誰でも**使えてしまう |

オフのときは、管理者が先にアカウントを作っておきます（[ユーザーとアクセス制限](./users-and-access)）。メールアドレスが一致すれば、SSO で同じアカウントに入れます。

### SSO の注意

- SSO で自動作成したアカウントは、**パスワードを持ちません**。パスワードではサインインできません
- SSO のボタンを押すと、毎回 IdP のアカウントを選ぶ画面が出ます。共有の PC で前の人のアカウントのまま入ってしまうことはありません
- `.env` の `JWT_SECRET` を変えると、保存したシークレットが読めなくなります。シークレットを入れ直してください
- 「メールアドレスのクレーム名」に、利用者が自分で書き換えられる項目（`preferred_username` など）を足さないでください。他人のアドレスを名乗ってサインインされる恐れがあります

### うまくいかないとき

| 表示 | 原因と直し方 |
|---|---|
| サインイン画面に SSO のボタンが出ない | 発行者 URL・クライアント ID・シークレットのどれかが空です。3. の項目を見直してください |
| 「IdP との認証に失敗しました」 | IdP がクライアント ID とシークレットの組み合わせを受け付けていません。**まずシークレットを疑ってください。** IdP の画面からコピーし直して入れ直します（Google なら `GOCSPX-` で始まるもの） |
| IdP の画面で `redirect_uri_mismatch` | IdP に登録したリダイレクト URI が、1. の値と 1 文字でも違います（[困ったとき](./troubleshooting#sso-で-redirect-uri-mismatch-と出る)） |

詳しくは [SSO の設定（詳細）](https://github.com/ulysseus-inc/ofuro-wiki/blob/main/docs/sso-setup.md) を見てください。

## AI エージェント

Claude Code などの AI エージェントが、ofuro-wiki のページを**読み・直し・書く**ための設定です。

AI は、ofuro-wiki から見て**普通の利用者の一人**です。人と同じ権限で、同じ経路で編集します。
開いているブラウザには、AI の編集がすぐに出ます。誰が編集したかは、監査ログと履歴に残ります。

### ofuro-wiki 側（管理者）

1. AI 用のアカウントを作ります（[ユーザーを追加する](./users-and-access#_1-ユーザーを追加する)）
   - **使う人ごとに 1 つ**作ります（例: `taro+ai@example.com`）。誰の AI が編集したかが分かり、その人の AI だけを止められます
   - **パスワードを設定**します。AI はパスワードでサインインします。SSO を使っている場合も、AI 用のアカウントはパスワード付きで別に作ってください（SSO で作ったアカウントにはパスワードが無く、AI はサインインできません）
   - 管理者にはしません
2. ワークスペースに招待し、役割を決めます。書かせるならメンバー、読ませるだけなら閲覧者です。触らせたくないページは、[ページごとに絞れます](./users-and-access#_4-ページごとに見られる人を絞る)

AI を止めたいときは、そのアカウントのパスワードを変えるか、削除します。

### AI エージェント側（使う人の PC）

用意するもの: Node.js 20 以上、AI 用アカウントのメールアドレスとパスワード、ofuro-wiki の URL

**Claude Code の場合**、Claude Code の中で次の 2 つを実行します。

```
/plugin marketplace add ulysseus-inc/ofuro-wiki
/plugin install ofuro-wiki@ofuro-wiki
```

続けて、**自分の端末で**接続の情報を保存します。サーバーの URL・メールアドレス・パスワードを聞かれます。

```bash
node ~/.claude/plugins/marketplaces/ofuro-wiki/skills/ofuro-wiki-cli/scripts/ofuro.mjs login
```

- 保存するのは URL・メールアドレス・トークンだけで、**パスワードは保存しません**。トークンは 30 日で切れるので、切れたらやり直します
- **パスワードを AI のチャットに書かないでください。** 会話の記録に残ります

最後に、AI に「ofuro-wiki のページ一覧を見せて」と頼み、一覧が出れば完了です。

::: warning mkcert の証明書を使っている場合
AI 用の CLI は Node.js で動きます。**Node.js は、PC に入れた認証局を見ません。**
そのままだと「サーバーに接続できない」で失敗します。

AI を動かす PC で、環境変数 `NODE_EXTRA_CA_CERTS` に認証局（[社内サーバーへの導入](./install-server#_6-他の-pc-から開く) で配った `rootCA.pem`）の場所を設定してから、`login` と Claude Code を起動します。

```bash
# Mac・Linux（~/.bashrc や ~/.zshrc に書いておく）
export NODE_EXTRA_CA_CERTS="$HOME/rootCA.pem"
```

```powershell
# Windows（一度だけ。設定後に PowerShell・Claude Code を開き直す）
setx NODE_EXTRA_CA_CERTS "$HOME\rootCA.pem"
```
:::

Codex CLI など、ほかの AI エージェントでの設定や、使い方の例は [AI エージェント連携の設定（詳細）](https://github.com/ulysseus-inc/ofuro-wiki/blob/main/docs/ai-agent-setup.md) を見てください。

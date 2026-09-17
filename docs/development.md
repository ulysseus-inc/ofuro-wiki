# 開発環境のセットアップ

ofuro-wiki の開発（コントリビュート）を行うための手順です。
本番デプロイは [README](../README.md) と [docs/deploy/README.md](deploy/README.md) を参照してください。

## 前提条件

- Node.js 20+、Yarn（Corepack 経由 / yarn 4.12.0）
- Docker / Docker Compose v2
- **PostgreSQL クライアントツール**（任意・バックアップ機能を開発／テストする場合のみ）
  → [補足: バックアップ機能を扱う場合](#補足-バックアップ機能を扱う場合)

## 1. 依存関係のインストール

```bash
# バックエンド
cd backend && npm install && cd ..

# フロントエンド
cd frontend && corepack enable && yarn install && cd ..
```

## 2. 環境変数の設定

```bash
cp backend/.env.example backend/.env
```

以下の値を編集してください：

```bash
POSTGRES_PASSWORD="任意のパスワード"
DATABASE_URL="postgresql://ofuro:上と同じパスワード@localhost:5432/ofuro_wiki"
JWT_SECRET="dev-only-secret-32-chars-minimum!!"  # 開発用の仮の値でOK
BASE_URL="http://localhost:8080"

# メール（Mailpit を使う場合）
MAILER_HOST=localhost
MAILER_PORT=1025
MAILER_IGNORE_TLS=true
```

`docker compose` 用にルートにもコピーします：

```bash
cp backend/.env .env
```

## 3. PostgreSQL の起動

`.env` の準備が完了してから起動してください（先に起動すると認証情報が反映されません）。

```bash
docker compose up -d postgres
```

## 4. Prisma Client の生成とマイグレーション

```bash
cd backend && npx prisma generate && npx prisma migrate deploy && cd ..
```

> `migrate dev` ではなく `migrate deploy` を使います。`migrate dev` は内部でシャドウ DB を作成しますが、PGroonga 拡張が存在しないためエラーになります。

## 5. バックエンド・フロントエンドの起動

ターミナルを 2 つ開いて、それぞれ実行します。

```bash
# ターミナル 1: バックエンド（ポート 3010）
cd backend && npm run start:dev
```

```bash
# ターミナル 2: フロントエンド（ポート 8080）
cd frontend && NODE_OPTIONS="--max-old-space-size=4096" yarn dev
```

> フロントエンドのビルドはメモリを多く消費します。`NODE_OPTIONS` を指定しないとビルド中にメモリ不足でクラッシュすることがあります。

ブラウザで **http://localhost:8080** にアクセスしてください。
`/api`・`/graphql`・`/socket.io` は自動的にバックエンドへプロキシされます。

## メール確認（Mailpit）

招待メール・パスワードリセットメールの動作確認には Mailpit を使います。

```bash
docker compose --profile dev up -d mailpit
```

| サービス | URL |
|---|---|
| 受信メール確認 | http://localhost:8025 |
| SMTP（アプリから送信） | localhost:1025 |

## フロントエンドの型検査

```bash
cd frontend && yarn typecheck
```

⚠️ **`tsc --noEmit` を単体で使わないこと。検査になっていない。**（#125）

`frontend` は 90 個の TypeScript プロジェクトが project references で繋がっている。
参照先の `dist/*.d.ts` が無いと **TS6305 が出て、その依存の型がすべて `any` に落ちる**。
つまり型エラーが**素通りする**。

実測（2026-08-16）:

| 方式 | エラー数 | 依存をまたぐ型エラーを検出するか |
|---|---:|---|
| `tsc --noEmit -p ...` | 4,521（うち **TS6305 が 2,483**） | **❌ 素通りする** |
| **`yarn typecheck`（`tsc --build`）** | **113** | **✅ 検出する** |

`tsc --build` は依存を順にビルドして `.d.ts` を作るため、この問題が起きない。
**エラーの大半は TS6305 のノイズだった。** 未使用宣言を一掃した時点の実数は **113 件**（#204 で死にコードを消して **111 件**、#210 で `schema.ts` を生成物にして **107 件**）
（#125 着手時点は 183 件）。

- 初回は数分かかる。2回目以降は**増分ビルドで 17 秒ほど**
- エラーがあれば**終了コード 2** を返す（CI で使える）
- 出力は `dist/` に出る（`.gitignore` 済み）
- 作り直すときは `yarn typecheck:clean`

⚠️ **検査の起点は `apps/web` と `apps/mobile`（リーフ）にすること。**
`core` を起点にすると、**`core` に依存している側（アプリ本体）が検査されない**。
project references は「依存先」を辿るため、起点より上流しか含まれない。

### 型エラーを増やしていないかの検査（CI と同じ）

```bash
cd frontend && yarn typecheck:ci
```

**既知の未修正が 107 件ある**（大半はフォーク元 AFFiNE 由来）。
**ゼロを条件にすると CI が常に赤になり、誰も見なくなる**ため、
まず「**増やさない**」ことを守る。

- 基準値を**超えたら終了コード 1**（CI が落ちる）
- 基準値を**下回ったら**、その旨を表示する（基準値を下げるよう促す）
- 基準値は `frontend/scripts/check-typecheck-baseline.mjs` の `TYPECHECK_BASELINE`

⚠️ **基準値を引き上げて通さないこと。** 検査を無効化するのと同じ。
減らしたときだけ下げる。

⚠️ **`tsc` が異常終了したときは、件数で判定せず失敗させている。**
見ないと、メモリ不足などで落ちたときにエラー行が 0 件になり、
**「基準値を下回った」と誤判定して CI が緑になる**（型検査が一度も
走っていないのに通る）。終了コードが 0 と 2 以外なら落とす。

⚠️ **`typecheck:ci` は `--force` を付けて毎回すべて検査する。**
`tsc --build` は増分のため、`.tsbuildinfo` が残る2回目以降は変更の
無いプロジェクトを飛ばし、**そのエラーを再出力しない**。付けないと
件数が過小になり、「減った」と誤って基準値の引き下げを促す。
そのぶん `yarn typecheck`（増分・17秒）より遅い。

**CI（`.github/workflows/ci.yml`）の `frontend` ジョブが PR ごとに実行する。**
クリーンビルドで約3分。

## テスト（E2E）

```bash
# フロントエンド(8080)・バックエンド(3010) が起動している状態で
cd e2e && BASE_URL=http://localhost:8080 npx playwright test integration.spec.ts

# バックアップ・エクスポート系
cd e2e && BASE_URL=http://localhost:8080 npx playwright test backup.spec.ts
```

## 単体テストが「タイムアウト」で落ちるとき

**症状**: `npm test` で 2〜7 件が失敗し、**実行するたびに件数が変わる**。
メッセージは値の不一致ではなく `Exceeded timeout of 5000 ms`。
落ちるのは #93（アカウント作成の回数制限）や #117（サインイン失敗の計数）など、
**サインインを繰り返すテスト**。

**原因**: これらは実 DB を使い、パスワード照合（bcrypt, 1回 約300ms）を
何度も回します。Jest は既定でテストファイルを並列に走らせるため、
**開発サーバーやフロントのビルドを動かしたまま**テストすると
CPU とメモリを奪い合い、5 秒に収まらなくなります。

**内容の誤りではありません。** 直列実行なら通ります。

```bash
npm test -- --runInBand      # 直列実行。全件パスすることを確認できる
```

**対処**: テスト前に開発サーバー（`npm run start:dev` / `yarn dev`）を止めるか、
上記の `--runInBand` を使ってください。CI はクリーンな環境で走るため発生しません。

> **⚠️ 本番の「同時ログインが遅い」は別問題です。**
> こちらはテスト環境固有ですが、bcrypt が重いこと自体は本番にもあります。
> 対処は [`deploy/README.md`](deploy/README.md) の
> 「始業時など、同時ログインが集中すると遅い・タイムアウトする」を参照。

## GraphQL のクエリを追加するとき

### スキーマはバックエンドが書き出す（#205）

```
バックエンドのリゾルバ
    ↓ npm run schema:gql（DB もサーバーの起動も要らない）
backend/schema.gql            ← コミットする
    ↓ codegen（frontend/packages/common/graphql/codegen.yml が参照）
.gql → index.ts（送るクエリ）と schema.ts（型）。どちらも生成物（#206・#210）
```

⚠️ **バックエンドの GraphQL を変えたら、同じ PR で `schema.gql` を更新すること。**
更新し忘れると backend の単体テスト（`test/scripts/print-schema.spec.ts`）が落ちる。

```bash
cd backend && npm run schema:gql
```

`schema.gql` は稼働中サーバーのイントロスペクション結果と**完全に一致する**ことを確かめてある
（2026-09-11・922行・差分0）。

### 送るクエリ（`index.ts`）は `.gql` から生成する（#206）

**`.gql` が正。`src/graphql/index.ts` を直接編集しないこと。**

```bash
cd frontend/packages/common/graphql && npx graphql-codegen --config codegen.yml
```

`.gql` を足す・直したら、上を実行して `index.ts` を再生成し、`.gql` と一緒にコミットする。

⚠️ **`.gql` のコメントは `index.ts` に写らない**（生成時に落ちる）。説明は `.gql` 側に書く。

### CI は生成物（`index.ts` / `schema.ts`）が、生成したものと一致するかを検査する（#207・#210）

```bash
cd frontend && yarn graphql:check
```

| 落ちる場面 | 原因 | 直し方 |
|---|---|---|
| codegen が異常終了 | `.gql` がバックエンドのスキーマと合わない（無いフィールドを送っている等） | `.gql` を直す。バックエンドを変えたなら `schema.gql` の更新も |
| `index.ts` / `schema.ts` に差分 | 手で書いた、または `.gql`・バックエンドのスキーマを直して再生成し忘れた | 上の codegen を実行し、`index.ts` と `schema.ts` をコミットする |

⚠️ **差分だけでは判定しない。** スキーマに無いフィールドを書くと codegen は終了コード1で止まり、
`index.ts` を**書き換えない**（2026-09-12 実測）。差分だけ見ると「差分なし」で**緑になる**。
同じ理由で、生成の前に `index.ts` を消しておく。codegen が何も書かずに正常終了しても、
ファイルが消えたままになって必ず差分として出る。

⚠️ **`index.ts` / `schema.ts` に未コミットの変更があると、手元では検査の前に止まる。** 生成し直すと手書きの変更は
上書きされて消え、しかも「一致」と判定されるため（2026-09-12 実測）。再生成したものならコミットしてから、
手で書いたものなら元に戻して `.gql` に書いてから実行し直す。CI は常にコミット済みの状態で走る。

⚠️ ほかの `.ts` に定義を文字列で書くのは検査の対象外（2026-09-12 時点で0件）。
定義は必ず `.gql` に書くこと。

### 型（`schema.ts`）も codegen が生成する（#210）

**`src/schema.ts` を直接編集しないこと。** `index.ts` と同じく codegen の生成物で、
`backend/schema.gql` から作られる。

| 場所 | 書くもの |
|---|---|
| `src/graphql/<name>.gql` | クエリ本体（**これが正**） |
| `src/graphql/index.ts` | ⭕ codegen が生成する |
| `src/schema.ts` | ⭕ codegen が生成する（`<Name>Query` / `<Name>QueryVariables` / `Queries` も含む） |

#### 列挙はバックエンドで定義する（案 A）

AFFiNE 由来のフロントエンドは、次の列挙を**値として**使う（`features.some(f => f === FeatureType.Admin)` など）。
以前は手書きの `schema.ts` にあり、バックエンドは `String` で返していた。
**値の定義はバックエンドの `registerEnumType` に一本化し、生成物に含める。**

| 列挙 | 使うフィールド | バックエンドが実際に返す値 |
|---|---|---|
| `ServerFeature` | `ServerConfigType.features` | `Indexer` / `Comment` / `Email` / `OAuth` |
| `ServerDeploymentType` | `ServerConfigType.type` | `Selfhosted` |
| `OAuthProviderType` | `ServerConfigType.oauthProviders` | `OIDC` |
| `FeatureType` | `UserType.features` | `Admin`（管理者のみ） |
| `WorkspaceMemberStatus` | `InviteUserType.status` / `InvitationType.status` | `Accepted` / `Pending` |
| `NotificationType` | `NotificationObjectType.type` | `Comment` / `Mention` / `CommentMention` |

⚠️ **列挙の値は、フロントエンドが参照しているものをすべて含める**（例: `ServerFeature` の `Payment`・`Copilot`）。
バックエンドが返さない値でも、フロントエンドの分岐が参照しているため。`ServerFeature` には、
フロントエンドの手書きの列挙に無かった `Email` を足した（バックエンドはメールの設定があると返す）。

⚠️ **通知のオブジェクト型は `NotificationObjectType` に改名した。** 列挙 `NotificationType` と名前がぶつかるため。
フロントエンドは型の名前に依存していない（`.gql` の `... on NotificationType`・`__typename` とも 0 件）。

#### ⚠️ 生成物に切り替えると、実行時に壊れていた罠（どちらも型エラーは 1 件前後しか出ない）

| 列挙 | 手書きの `schema.ts` だけにあったとき | 生成物に無いまま切り替えると |
|---|---|---|
| `NotificationType` | `enum`（`Mention = 'Mention'`） | 同名の**オブジェクト型**になり、`NotificationType.Mention` が `undefined` → **通知が1件も描画されない** |
| `FeatureType` | `enum`（`Admin = 'Admin'`） | 消えて `FeatureType.Admin` が `undefined` → **管理者の判定が常に偽**（管理画面の入口が消える） |

どちらも、バックエンドで列挙として定義することで解消する。E2E（通知一覧・管理画面）で確かめる。

#### ⚠️ DB の値が列挙からはみ出したとき

DB の列はただの文字列なので、想定外の値が 1 行でもあると、**GraphQL が列挙に変換できず問い合わせが丸ごと失敗する**。
境目で受け止める:

| 値 | 知らない値のとき |
|---|---|
| メンバーの状態（`workspace_members.status`） | `Pending` として返す（参加済みと誤って見せない）。警告ログ |
| 通知の種類（`notifications.type`） | その通知を一覧から外す（1件のために一覧全体を壊さない）。警告ログ |

2026-09-12 時点で、書き込む値はそれぞれ `accepted` / 上の 3 種だけ（コードで確認）。

#### スキーマに対応が無い型は、持ち主のパッケージに置く

案 A の対象外。バックエンドが返す型ではないため。

| 型 | 置き場所 | 理由 |
|---|---|---|
| `DocMode` | BlockSuite の `DocMode`（`'edgeless' \| 'page'`） | スキーマに無い。値も一致 |
| `ErrorNames` / `ErrorDataUnion` | `@ofuro/error` | サーバーのエラー名の一覧で、スキーマの型ではない |
| 通知の本文の型（`MentionNotificationBodyType` など） | 通知のモジュール | バックエンドは `body: JSON` で返す。中身の解釈はクライアントの責務 |
| `SubscriptionPlan` | 課金ボタンと一緒に扱う | `Payment` 機能が無いと描画されない（ofuro-wiki では一度も出ない） |

#### CI

`yarn graphql:check`（#207）は `index.ts` と `schema.ts` の両方を検査する。

## 補足: バックアップ機能を扱う場合

バックアップ／リストアは **`pg_dump` / `pg_restore` を子プロセスとして実行**します。

- **Docker で動かす場合**: イメージに同梱済みのため、追加作業は不要です
- **ホスト上で `npm run start:dev` する場合**: PostgreSQL クライアントツールが必要です

未インストールのまま実行すると、バックアップ作成が次のエラーになります。

```
PG_TOOL_UNAVAILABLE: pg_dump を実行できません（ENOENT）。
```

E2E（`backup.spec.ts`）は、この場合**失敗ではなく skip** になります（理由が表示されます）。

### インストール（Ubuntu / Debian）

⚠️ **サーバーと同じメジャーバージョンが必要です。** 古い `pg_dump` で新しいサーバーを
ダンプすると `server version mismatch` で失敗します。
ofuro-wiki の Docker 構成は **PostgreSQL 17** を使います。

```bash
# PGDG リポジトリを追加してから 17 系を入れる
sudo apt install -y curl ca-certificates
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
  https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  | sudo tee /etc/apt/sources.list.d/pgdg.list
sudo apt update && sudo apt install -y postgresql-client-17

pg_dump --version   # PostgreSQL 17.x であることを確認
```

### 代替: Docker コンテナ内で実行する

ホストを汚したくない場合は、バックエンドも Docker で動かせば `pg_dump` は同梱されています。

```bash
docker compose up -d
```

詳細・コントリビューションの流れは [CONTRIBUTING.md](../CONTRIBUTING.md) を参照してください。

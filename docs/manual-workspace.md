# マニュアル専用ワークスペース（読み取り専用・自動配布）

対応 Issue: （未作成） / 関連: [doc-read-only-protection.md](./doc-read-only-protection.md)

## 1. 目的

ofuro-wiki の**ユーザーマニュアル（使い方ガイド）**を、全ユーザーが参照でき、かつ**いかなるユーザー（サーバー Admin を含む）も編集できない**形で提供する。

- マニュアルは ofuro-wiki 自身のドキュメントとして作る（ドッグフーディング）。
- 専用の「マニュアル」ワークスペースを用意し、全ユーザーを **Reader（参照のみ）** で参加させる。
- ワークスペース切替でマニュアルが見える。
- **本番では誰も編集しない。マニュアルの更新は開発時のみ**行い、出荷物（アセット）として配布する。

## 2. 方式の決定（背景）

### なぜ「専用WS＋全員Reader」なのか
`Doc_Update`（編集可否）は**ワークスペースのロールのみ**で決まり（`buildDocPermissions(role)`、`isWriter = isAdmin || member || write`）、**サーバー Admin（`is_admin`）はこの判定をバイパスしない**（権限解決に `is_admin` は登場しない）。
したがって Reader ロールのユーザーは `Doc_Update = false` となり、**バックエンド強制の読み取り専用**になる（#66 の advisory lock と異なり、本物のロック）。

検討した代替案と却下理由:

| 案 | 判定 | 理由 |
|----|:----:|------|
| 共有WS内の1ドキュメントを保護（#66） | ✗ | #66 は advisory。Owner/Admin がトグル解除可。doc単位ロールは[非機能](./doc-level-permission-dead-code.md) |
| 会員行を持たない「全員参照の特別WS」 | ✗ | WS一覧・権限・同期・**越境防止ガード**（PR#48 等で強化）を全て特別扱いする必要があり、セキュリティホールのリスク大 |
| **専用WS＋全員Reader（本方式）** | ✓ | 既存の Reader 権限機構にそのまま乗る。越境ガードもそのまま効く。安全 |

### 更新は開発時のみ（出荷物として扱う）
マニュアル本文は**開発環境の ofuro-wiki で執筆** → エクスポート → **デプロイ時にシードとして投入**。本番では誰もログインして編集しない（メンテナンス用アカウントへの本番ログイン運用も不要）。更新＝新しいシードを含む再デプロイ。

## 3. 既存アーキテクチャ（調査結果）

| 要素 | 実体 | 流用方針 |
|------|------|----------|
| 起動時シード | `AdminService.seedAdmin()`（`main.ts` bootstrap で呼ぶ） | 同じ場所に `seedManualWorkspace()` を追加 |
| WS作成 | `WorkspaceService.createWorkspace(userId)`（tx で workspace + owner member 作成） | システムアカウント所有でマニュアルWSを作成 |
| WS一覧 | `workspaces` resolver → `getUserWorkspaces(userId)`（`workspaceMember` status=accepted を読む） | ここで**遅延自動 Reader 参加**を差し込む |
| 権限 | `buildDocPermissions(role)`（role=reader → 全 `*_Update`=false） | そのまま（Reader が読み取り専用を保証） |
| 本文の投入 | `BackupService.exportWorkspace()`→zip / `importWorkspace()` | 開発でエクスポートした zip をシードとして import |
| ユーザー一覧（Admin） | `AdminService.listUsers()`（除外条件なし） | システムアカウントを除外するフィルタを追加 |

## 4. 仕様

### 4.1 システムアカウント

- 既知メール（例 `manual-system@ofuro-wiki.local`）の User を1つ作成。
- `User` に **`isSystem: boolean @default(false)`** カラムを追加。マニュアル所有アカウントは `isSystem = true`。
- **パスワードなし（`passwordHash = null`）でログイン不可**。本番で誰もこのアカウントにログインできない。
- **外部に出さない**:
  - Admin パネルのユーザー一覧（`listUsers`）から `isSystem = true` を除外。
  - （マニュアルWSのメンバー一覧に Owner として出るのは許容 = マニュアルWSにいる時のみ見える。自分の個人WSには `workspaceId` スコープのため出ない。）

### 4.2 マニュアルワークスペース

- 名前は「📖 マニュアル」等。**Owner = システムアカウント**。
- **識別方法**: 固定 ID ではなく「**システムアカウントが所有する WS**」で識別する。
  理由: `importWorkspace` は新 WS を新 ID で作成し、AFFiNE のルートドキュメント
  （`docId === workspaceId`）を新 ID に remap する処理を内包している。この実績ある
  パスをそのまま使うため、ID は import が決めたものを採用し、所有者で引く。
- 起動時シード `seedManualWorkspace()`:
  1. システムアカウントが無ければ作成（`isSystem=true`、パスワードなし）。
  2. バンドルしたマニュアル本文の **seed 版**（`ServerSetting` に記録）と現行版を比較。
  3. 未 import、または版が上がっていれば:
     - 既存マニュアルWS（システムアカウント所有）があれば削除（cascade）。
     - `importWorkspace(systemUserId, 本文zip)` で再作成 → import 版を記録。
  4. 版が同じなら何もしない（**冪等**）。
  - WS の ID が再 import で変わっても、ユーザーは §4.3 の遅延参加で自動的に
    新 WS の Reader になるため問題ない（自己修復）。

### 4.3 遅延自動 Reader 参加（方式 c）

- `workspaces` resolver（または `getUserWorkspaces`）で、システムアカウント所有の
  マニュアルWSを引き、対象ユーザーがその member でなければ **Reader / status=accepted
  で upsert** してから一覧を返す（ユーザー自身がシステムアカウントの場合は除く）。
- 冪等（既に member なら何もしない）。新規・既存ユーザーを問わず、初回ロード時に自己修復的に参加させる。
- per-signup フックやバックフィル移行は**不要**。
- これによりマニュアルWSは各ユーザーのワークスペース切替に自然に出る（フロント改修不要）。

**並び順**: フロントは `workspace-engine/impls/cloud.ts` でクラウドWSを
`workspace.id` の `localeCompare` でソートする（バックエンドの順序は UI に反映されない）。
UUID はランダムなため順序は事実上不定で、しかもマニュアルWSは再シード毎に
新 UUID になり位置が動いていた。対策として、マニュアルWSに**最後にソートされる
固定 UUID（`ffffffff-ffff-4fff-bfff-ffffffffffff`）**を与える（`importWorkspace` の
ID 上書き）。これで既存のフロントソートのまま**常に最下部**に固定され、再シードでも
位置が動かない。マニュアルWSの識別もこの固定 ID で行う。

### 4.4 マニュアル本文の作成・更新パイプライン

1. 開発環境の ofuro-wiki でマニュアルWSに章立て（§5）どおり執筆。
2. `exportWorkspace` で zip を取得し、リポジトリにアセットとして格納（例 `backend/seed/manual.zip` + バージョン識別子）。
3. デプロイ時、`seedManualWorkspace()` がバージョン差分を見て import（更新時のみ）。
4. 本番での編集は発生しない。

執筆は Markdown ソース（章ごとの md ファイル）→ `POST /api/internal/docs/upsert`（内部で
`markdownToYjsUpdate`）で行う。ビルダーが解釈する記法:

| 記法 | 変換先 |
|------|--------|
| `# / ## / ###` | 見出し h1/h2/h3 |
| `---` | 区切り線 |
| `- text` | 箇条書きリスト（`affine:list` bulleted） |
| `1. text` | 番号付きリスト（`affine:list` numbered） |
| `**text**` | 太字（delta 属性 `bold: true`） |
| `[[docId]]` | 内部ドキュメント参照（LinkedPage） |
| `:::left/center/right text` | 文字揃え（独自拡張） |
| `:::image <blobキー> <幅> <高さ>` | 画像ブロック（独自拡張） |

表（`\|` 記法）は非対応のため、本文では箇条書きで代替する。

#### 具体的な更新手順（開発環境）

**正となるソースは `backend/seed/manual.zip` のみ**。執筆時の md ファイルは中間生成物であり、
リポジトリには残らない点に注意（古い md から再投入するとリンク等が欠落する事故につながる）。

1. **執筆用WSを用意**: 現行 seed から再作成する。docId・画像 blob がそのまま引き継がれる。
   ```bash
   curl -X POST http://localhost:3010/api/workspaces/import \
     -b cookies.txt -F "file=@backend/seed/manual.zip;type=application/zip"
   ```
   任意の `-F "name=<ワークスペース名>"` で名前を指定できる（未指定なら「〜 (imported)」）。
   ※ E2E テスト実行はワークスペースを削除することがあるため、執筆用WSは使い捨てと考える。
2. **本文を投入**: 章ごとの md を `POST /api/internal/docs/upsert` で投入
   （body: `workspaceId` / `docId` / `title` / `markdown`）。既存 docId を指定すれば上書き。
3. **表示確認**: ブラウザで執筆用WSを開いて確認。
4. **エクスポート**: `POST /api/workspaces/<執筆用WS-ID>/export` で zip を取得し、
   `backend/seed/manual.zip` に上書き。`backend/seed/manual.version` を新しい版文字列に更新。
5. **コミット → デプロイ**: 起動時に版差分を検知して本番へ自動再シードされる
   （マニュアルWSの ID は版が変わるたびに変わる）。

**既存 seed から md を復元する場合**: `yjsUpdateToMarkdown` は内部リンク（reference delta）を
空白に落とすため使えない。zip 内の `docs/*.yjs` を Yjs でデコードし、`prop:text` の delta を
走査して reference 属性を `[[docId]]` 記法へ戻すこと。

各章の docId（固定）:

| docId | ページ |
|-------|--------|
| `vewJ1Zh9N2_rxVCRXhHum` | 👋 はじめにお読みください（目次） |
| `Tbwm_QbOfw9bN5NSdjwx3` | 1. はじめに |
| `HR2EoMdVHIq9Rc3zwqAnJ` | 2. 基本のブロック概念 |
| `cG5BPgENZB_XAa1fXjlyc` | 3. エディタの使い方 |
| `MBhI3LHkizZ8ccYO1B71Y` | 4. 便利機能 |
| `JMFbfIcnwHIMyHYiWOZdV` | 5. 共有と権限 |
| `5jFtGQp4AmiWXVkcsT7tE` | 6. 管理者編 |

### 4.5 ガード（任意・MVP後）

- ユーザーがマニュアルWSから**離脱**しても、次回ロードの遅延参加で自動復帰する（自己修復）。MVP では明示ガード不要。
- **既定遷移先の除外**: サインイン直後のワークスペース選択（`desktop/pages/index`）では、マニュアルWS（ID 先頭 `ffffffff-ffff-4fff`）を「自分のWS」として数えない。自分のWSが1つも無いユーザー（マニュアルWSにのみ参加）には自動作成を発動し、既定の遷移先にもマニュアルWSを選ばない（Reader 権限のため編集不可で詰むのを防ぐ）。`last_workspace_id` が明示的にマニュアルWSを指す場合は尊重する。
- **昇格**: ロール変更は owner/admin のみ可能で、マニュアルWSの owner はシステムアカウント（誰もログイン不可）。よって一般ユーザーが自分を編集者に昇格させることは不可。追加ガード不要。
- （任意）マニュアルWSの削除/名称変更 UI を無効化する。

## 5. マニュアルの章立て（合意済み）

AFFiNE 公式 docs（Get Started / Core Concepts / Self-host）を参考に、ofuro-wiki 固有機能を加えた構成:

1. **はじめに** — ofuro-wikiとは / ログイン / 画面の見方
2. **基本のブロック概念** — ドキュメント / ブロック / ページ階層
3. **エディタの使い方** — 「/」スラッシュコマンド / 装飾・コピペ / 画像・添付 / データベース（テーブル・カンバン）/ 埋め込み（YouTube/GitHub/Figma）
4. **便利機能** — 全文検索 / テンプレート / 保護モード（#66）/ リアルタイム共同編集
5. **共有と権限** — メンバー・ロール（Admin/Owner/Member/Reader）
6. **管理者編** — ユーザー管理 / サーバー設定 / 外部連携（リンクプレビュー）/ バックアップ

## 5.5 読み取り専用WSと同期エンジンの挙動

クライアントはドキュメントを**開くだけ**でローカルメタデータ（`db$<wsId>$docProperties` 等）に
書き込みを発生させ、それを同期エンジンが `space:push-doc-update` で push する。Reader 参加の
マニュアルWSではサーバーが `ACCESS_DENIED` で拒否するが、これを接続障害として扱うと
無限リトライ＋「Connection lost」バナーが常時表示になる（2026-07-10 デモ環境で発見）。

対策: `nbstore/src/impls/cloud/doc.ts` の `pushDocUpdate` で `ACCESS_DENIED` 応答は
**更新を破棄して成功扱い**にする（サーバーが正。読み取り専用WSへのローカル自動書き込みは
反映されない仕様）。接続障害・タイムアウト等は従来どおり throw → リトライ。

## 6. セキュリティ上の注意

- マニュアルWSは既存の Reader 権限・越境防止ガードにそのまま乗る（特別パスを作らない）。今回強化したアクセス制御を壊さない。
- システムアカウントはログイン不可（パスワードなし）＋ Admin 一覧から除外。トークン発行経路が無いことを確認する。
- 本番では Doc_Update=false のため、API を直接叩いても Reader は編集不可（バックエンド強制）。

## 7. 影響範囲（変更見込み）

| ファイル | 変更 |
|----------|------|
| `backend/prisma/schema.prisma` | `User.isSystem` カラム追加 + マイグレーション |
| `backend/src/modules/admin/admin.service.ts` | `listUsers` から `isSystem=true` を除外 |
| `backend/src/modules/**/manual-seed.service.ts`（新規） | `seedManualWorkspace()`：システムアカウント/WS作成 + 本文 import（冪等） |
| `backend/src/main.ts` | bootstrap で `seedManualWorkspace()` を呼ぶ |
| `backend/src/modules/workspace/workspace.resolver.ts`（または service） | `workspaces` 取得時に遅延 Reader 参加を upsert |
| `backend/seed/manual.zip`（新規アセット） | 開発でエクスポートしたマニュアル本文 + バージョン識別子 |
| （任意）フロント | マニュアルWSの離脱/削除 UI 抑制 |

## 8. テスト方針

- **結合**: 起動シードでマニュアルWS＋システムアカウントが作成される。二重起動で重複しない（冪等）。
- **結合**: 新規/既存ユーザーが `workspaces` を引くと Reader でマニュアルWSに参加し一覧に出る。
- **権限（重要）**: Reader（および `is_admin=true` の Admin ユーザー）がマニュアルWSのドキュメントを **編集できない**こと（`Doc_Update=false`、API 直叩きでも拒否）。
- **越境**: マニュアルWS参加が他WSへのアクセスを広げないこと（既存の越境防止 E2E と同様の観点）。
- **秘匿**: Admin パネルのユーザー一覧にシステムアカウントが出ないこと。システムアカウントでログインできないこと。
- **E2E**: マニュアルWSが切替に出る／中身が読める／編集不可、を追加。

## 9. 未決事項（実装前に確認）

1. マニュアルWSの**固定 ID と名称**（例: 名前「📖 マニュアル」、既知 UUID の決め方）。
2. システムアカウントの**メール規約**（`manual-system@ofuro-wiki.local` 等）。
3. シード本文の**バージョン管理方法**（zip のハッシュ / バージョンファイルで「変わったら再 import」）。
4. マニュアルWSの**離脱・削除 UI 抑制**を MVP に含めるか（自己修復で復帰するため必須ではない）。
5. 執筆の**着手順**: 仕組み（シード＋遅延参加）を先に作るか、開発環境で本文執筆を先に始めるか（本文を先に書いてエクスポート形式を確定 → シード実装、の順が手戻り少ない可能性）。

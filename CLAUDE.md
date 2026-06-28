# ofuro-wiki

アイデアが湧き出てくる社内Wiki プラットフォーム。
お風呂（ofuro）のように、自然とアイデアが出てくる場所をイメージ。

---

## プロジェクトゴール

- Wikiに特化したNotionライクなプラットフォーム
- Notionレベルのブロックエディタ体験（`/` コマンド、ドラッグ&ドロップ等）
- タスク管理・ステータス管理は不要（純粋なWiki/ナレッジベース）
- 社内利用（セルフホスト）

---

## 技術選定（決定済み）

### 方針: AFFiNE フロントエンド流用 + バックエンド自作

**選定理由:**
- BlockSuite エディタのクオリティが最高で、Notionに最も近い体験を提供
- フロントエンド部分はMITライセンスで自由に利用可能

### ライセンス整理

| 区分 | ライセンス | 利用方針 |
|------|-----------|---------|
| AFFiNE フロントエンド (`packages/frontend/*`) | **MIT** | そのままフォーク・改修 |
| BlockSuite エディタ | **MPL-2.0** | そのまま利用 |
| AFFiNE バックエンド (`packages/backend/server/`) | **EE (商用)** | **使用不可** → 自作で置換 |
| `packages/common/native/` | **EE (商用)** | **使用不可** — プロジェクトに含まれていない |
| AFFiNE `ee` ディレクトリ群 | **EE (商用)** | **使用不可** |

### テレメトリ（外部送信）について

AFFiNE フロントエンドにはテレメトリ（Mixpanel, Sentry 等）のコードが含まれているが、ofuro-wiki では**一切の外部送信を無効化**している。以下の多層防御により、外部へのデータ送信は行われない：

1. **フロントエンド初期化**: `tracker.init()` / `sentry.init()` を呼び出していない（`bootstrap/telemetry.ts`）
2. **トランスポート**: テレメトリの送信トランスポートが未設定（`transport = null`）
3. **エンドポイント**: テレメトリURLは `location.origin`（自サーバー）を指す
4. **バックエンドAPI**: `/api/telemetry/collect` は空オブジェクトを返す no-op スタブ
5. **環境変数**: SENTRY_DSN 等のテレメトリ関連設定なし
6. **Docker/デプロイ**: テレメトリ関連の設定なし

エアギャップ環境でも安全に運用可能。

### 比較検討したOSS

| OSS | 判定 | 理由 |
|-----|------|------|
| AFFiNE | **採用（フロント）** | エディタ品質が最高、MIT |
| Docmost | 不採用 | AGPL-3.0、エディタ品質がAFFiNEに劣る |
| Outline | 不採用 | BSLライセンス、PostgreSQL+Redis必須 |
| BlockNote | 不採用 | エディタ単体。プラットフォームとしては不足 |
| DokuWiki | 不採用 | ファイルベースだがUIが古い |

---

## AFFiNE バックエンド機能分析

### `core/` モジュール（必要/不要の判定）

| モジュール | 判定 | 説明 |
|-----------|:----:|------|
| `doc` / `doc-service` | **必要** | ドキュメントCRUD |
| `sync` | **必要** | リアルタイム同期（CRDT/Yjs） |
| `storage` | **必要** | データ保存レイヤー |
| `workspaces` | **必要** | ワークスペース管理 |
| `user` | **必要** | ユーザー管理 |
| `auth` / `access-token` | **必要** | 認証 |
| `permission` | **必要** | 権限管理 |
| `static-files` | **必要** | 静的ファイル配信 |
| `selfhost` | 有用 | セルフホスト対応 |
| `config` / `common` / `utils` | 有用 | 基盤ユーティリティ（自前で軽く作る） |
| `doc-renderer` | 後回し | URL共有時のOGPプレビュー生成 |
| `comment` | **不要** | コメント機能 |
| `notification` | **不要** | 通知 |
| `mail` | **不要** | メール送信 |
| `quota` | **不要** | 使用量制限（SaaS向け） |
| `telemetry` | **不要（除外）** | GA4へのデータ送信 |
| `monitor` | **不要** | 監視 |
| `queue-dashboard` | **不要** | ジョブキュー管理UI |
| `version` / `features` | **不要** | バージョン/フィーチャーフラグ |

### `plugins/` モジュール（ほぼ全て不要）

| プラグイン | 判定 | 説明 |
|-----------|:----:|------|
| `indexer` | **自作で再実装** | 全文検索（Wikiの生命線） |
| `oauth` | 場合による | OAuth認証 |
| `copilot` | 不要 | AIアシスタント |
| `payment` | 不要 | 課金処理 |
| `captcha` | 不要 | CAPTCHA |
| `customerio` | 不要 | 顧客分析 |
| `gcloud` | 不要 | GCP連携 |
| `license` | 不要 | ライセンス検証 |
| `calendar` | 不要 | カレンダー |
| `worker` | 不要 | バックグラウンドジョブ |

---

## 検索アーキテクチャ方針

### AFFiNEの検索設計（参考）

- ブロック単位でインデックス（タイトル、概要、コンテンツ、ブロック種類）
- 検索エンジン: Manticoresearch（軽量、Docker 1コンテナ）or Elasticsearch
- GraphQL APIで3種の検索: search（ブロック単位）、aggregate（ドキュメント集約）、searchDocs（キーワード）
- Boolean検索（must / should / must_not）サポート
- ハイライト付き結果返却

### 自作バックエンドでの再実装方針

1. ドキュメント保存時 → Yjsスナップショットからブロック抽出 → Manticoresearchに投入
2. 検索API（NestJS + GraphQL or REST）→ Manticoresearchに全文検索
3. 社内Wikiなら Manticoresearch で十分

---

## 自作バックエンドの最小構成

```
NestJS バックエンド
├── ドキュメントCRUD API（GraphQL or REST）
├── Yjs WebSocket 同期サーバー
├── ファイルストレージ（画像等のアセット）
├── 認証（JWT等）
├── ワークスペース / ページ階層管理
└── 全文検索（Manticoresearch連携）

DB: PostgreSQL or SQLite
検索: Manticoresearch（Docker）
```

---

## 調査ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [`docs/frontend-analysis.md`](docs/frontend-analysis.md) | AFFiNE フロントエンド構造の詳細分析、モジュール別の残す/削除判定、通信プロトコル仕様（GraphQL・Socket.IO・REST）、ルート構成、4フェーズの削除計画 |

---

## バージョン管理

- **ofuro-wiki バージョン**: `frontend/package.json` の `version` フィールドで管理（手動更新）
- **BlockSuite エディターバージョン**: `frontend/blocksuite/affine/all/package.json` の `version`（上流更新時に変わる）
- リリース時に `package.json` を更新 → Gitタグを打つ運用
- TODO: リリース（デプロイ）手順書にバージョン更新手順を記載すること

---

## ロール体系（確定）

```
Admin  = Owner（ユーザー）の管理者。サーバー全体の最上位権限。
Owner  = 自ワークスペースの管理者。
Member = ドキュメントの読み書き。
Reader = 読み取りのみ。
```

| ロール | 管理対象 | 具体的にやること |
|--------|---------|-----------------|
| **Admin** | Owner（ユーザー） | ユーザー一覧・追加・削除、Admin 権限付与、サーバー設定 |
| **Owner** | 自ワークスペース | メンバー招待・管理、WS設定、Blob管理 |
| **Member** | - | ドキュメントの読み書き |
| **Reader** | - | 読み取りのみ |

**Admin の設定方法**: 環境変数 `ADMIN_EMAIL` でデプロイ時に指定。Admin 同士で追加可能。一般ユーザー/Owner が自力で Admin になる手段はなし。

**運用フロー**:
1. Admin がサインアップ → ワークスペース自動作成（Owner）→ 社員を Member として招待（社内 Wiki）
2. 社員がサインアップ → 個人ワークスペース自動作成（Owner）→ 招待された WS にも参加
3. 個人 WS は下書き・メモ用。社内共有 Wiki は Admin/Owner が作成した WS を全員で共有。

---

## 開発ワークフロー（必須）

**すべての修正・機能追加は以下のフローに従うこと：**

### 1. Feature ブランチを切る
```bash
git checkout -b feature/説明的なブランチ名
```

### 2. 開発・コミット
```bash
# 修正を加える
git add ...
git commit -m "日本語でコミットメッセージを書く"
```

### 3. 開発環境で動作確認（必須）
```bash
# バックエンド起動（ターミナル1）
cd backend && npm run start:dev

# フロントエンド起動（ターミナル2）
cd frontend && NODE_OPTIONS="--max-old-space-size=4096" yarn dev

# ブラウザで http://localhost:8080 にアクセスして動作確認
```

### 4. E2E テスト実行（必須）
```bash
# 開発環境（フロントエンド: 8080、バックエンド: 3010）で実行
cd e2e && BASE_URL=http://localhost:8080 npx playwright test integration.spec.ts
```
> **注意**: 実行前にポート 8080・3010 が他のアプリに使われていないか確認すること。
> 使用中の場合は `lsof -ti:8080` でプロセスを特定してから対処する。
**すべてのテストが PASS するまで修正すること。失敗したまま PR を上げてはいけない。**

### 5. GitHub に push して PR 作成
```bash
git push origin feature/説明的なブランチ名
gh pr create --title "..." --body "..."
```

### 6. レビュー・マージ
PR をレビューしてマージする。

### 7. GitHub Actions でビルド → 本番デプロイ
master へマージ後、GitHub Actions が自動ビルド。

---

## E2E テスト追加ルール

- **修正・機能追加の際に「これは基本動作だ」と判断したら、その場で `e2e/integration.spec.ts` にテストを追加すること。**
- 基本動作の目安：
  - ログイン・サインアップ
  - ドキュメントの作成・保存・表示
  - スラッシュメニューの表示
  - ページ内コピペ
  - 画像アップロード・表示
  - その他、壊れたらすぐ気付くべき操作

---

## コミットメッセージルール

- **コミットメッセージは日本語で書くこと。**

---

## スキル利用ルール

- **Playwright を使用する際は、必ず `playwright-skill` スキルを参照すること。**

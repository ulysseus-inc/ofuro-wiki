# コントリビューションガイド

ofuro-wiki に興味を持っていただきありがとうございます！

> **⚠️ 現在、外部からの Pull Request は受け付けていません。**
> 公開初期は運用を安定させるため、コードの変更はメンテナ（コアチーム）のみが行います。
> **バグ報告・機能提案は [Issue](../../issues) で歓迎します。** いただいた内容は
> メンテナが取り込みを検討します。方針は今後変更される場合があります。

## はじめに

- バグ報告・機能提案は [Issue](../../issues) からお願いします（テンプレートがあります）。
- セキュリティ脆弱性は Issue ではなく [SECURITY.md](SECURITY.md) の手順で**非公開**に報告してください。
- 本プロジェクトに関わる方は [行動規範（CODE_OF_CONDUCT.md）](CODE_OF_CONDUCT.md) に従ってください。

以下の開発手順は、メンテナおよび将来 PR を受け付けた際のための参考情報です。

## 開発環境のセットアップ

詳細は [README](README.md) を参照してください。概要は以下のとおりです。

```bash
# バックエンド（ターミナル1）
cd backend && npm install && npm run start:dev   # http://localhost:3010

# フロントエンド（ターミナル2）
cd frontend && corepack enable && yarn install
NODE_OPTIONS="--max-old-space-size=4096" yarn dev # http://localhost:8080
```

- フロントエンド: AFFiNE 派生（yarn workspaces / yarn 4.12.0）
- バックエンド: NestJS + PostgreSQL（PGroonga）

## ブランチとコミット

- `main`（master）への直接 push は行わず、必ずブランチを切って Pull Request を作成してください。
  - 例: `feature/説明的な名前`、`fix/説明的な名前`、`docs/...`、`chore/...`
- コミットメッセージは以下のフォーマットを推奨します（日本語可）。

  ```
  <type>: <変更内容を簡潔に>

  type: feat（新機能） / fix（バグ修正） / docs（ドキュメント） /
        refactor（リファクタ） / test（テスト） / chore（設定・雑務）
  ```

## テスト

Pull Request を出す前に、以下を確認してください。

- 静的解析が通ること
- UI を伴う変更は **E2E テスト**が通ること

```bash
# E2E（フロントエンド: 8080、バックエンド: 3010 が起動している状態で）
cd e2e && BASE_URL=http://localhost:8080 npx playwright test integration.spec.ts
```

- 「壊れたらすぐ気付くべき基本動作」を追加・変更した場合は、`e2e/integration.spec.ts` にテストを追加してください。
- テストを削除して CI を通すことは避けてください。

## Pull Request（現在は受け付けていません）

前述のとおり、現在は外部からの Pull Request を受け付けていません。
将来 PR を受け付ける際は、以下の流れを想定しています（メンテナの内部運用にも適用）。

1. テストがすべて通ることを確認する。
2. 変更内容・動作確認手順を PR 本文に記載する。
3. レビューを受けてマージする。

## ライセンス

コントリビュートされたコードは、本プロジェクトのライセンス（[MIT](LICENSE)）の下で公開されることに同意したものとみなされます。BlockSuite 由来ファイル（`frontend/blocksuite/**`）への変更は MPL-2.0 が適用されます。

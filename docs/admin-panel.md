# 管理パネル（Admin Panel）

サーバー管理者（Admin）向けの設定 UI。設定ダイアログ内の「管理（Administration）」セクションに表示される。

## アクセス権

- `isAdmin = true` のユーザーのみ表示・操作可能。
- Admin の付与は環境変数 `ADMIN_EMAIL` によるシード（`AdminService.seedAdmin()`、起動時に該当ユーザーを昇格）か、既存 Admin による付与で行う。

## 画面構成

設定ダイアログのサイドバー「管理」セクションに、以下の 4 タブを表示する。

| タブ | コンポーネント | 内容 |
|------|---------------|------|
| ユーザー管理 | `user-management.tsx` | ユーザー一覧・検索・追加・削除、Admin 権限の付与/剥奪 |
| サーバー設定 | `server-settings.tsx` | 新規登録の許可、サイト名 |
| バックアップ | `backup-panel.tsx` | 自動バックアップ設定、手動バックアップ、履歴・ダウンロード・削除 |
| リストア | `restore-panel.tsx` | バックアップ ZIP のアップロードによるシステム復元 |

実装: `frontend/packages/frontend/core/src/desktop/dialogs/setting/admin-setting/`
タブの登録: `index.tsx` の `useAdminSettingList()`
セクション見出し: `setting-sidebar/index.tsx`

## 国際化（i18n）

- すべての表示文字列は i18n 経由（`useI18n()`）で表示し、ハードコード文字列を持たない。
- キーは `com.affine.admin.*` 名前空間（セクション見出しは `com.affine.settingSidebar.settings.admin`）。
- 汎用語（保存/キャンセル/削除/編集/読み込み中）は既存の共通キー（`Save` / `Cancel` / `Delete` / `Edit` / `Loading`）を再利用する。
- 翻訳定義: `frontend/packages/frontend/i18n/src/resources/en.json`（英語）/ `ja.json`（日本語）。
- キーを追加・変更したら `i18n` パッケージで `yarn build` を実行し、型定義 `i18n.gen.ts` を再生成すること。
- アプリのデフォルト言語は日本語（`modules/i18n/entities/i18n.ts` の既定値 `'ja'`）。

## E2E

`e2e/admin.spec.ts`（バックエンドを `ADMIN_EMAIL=e2e-test@ofuro-wiki.local` で起動して実行）。
Admin API（GraphQL）に加え、Admin パネル UI のラベルがデフォルト言語（日本語）で表示されることを検証する。

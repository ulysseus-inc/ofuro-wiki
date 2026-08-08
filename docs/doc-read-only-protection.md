# ドキュメント単位の保護（Read Only）プロパティ

対応 Issue: [#66](https://github.com/masakazu-ulysseus/ofuro-wiki/issues/66)

> ⚠️ **ページ単位の権限（#97）とは別物。** 本機能は**誤操作の防止**であり、
> アクセス制御ではない。「この人には見せない」は本機能では実現できない。
> 対比は [`doc-permission.md`](doc-permission.md) 2.6 を参照。

## 1. 背景・目的

参照が主で編集が少ないドキュメントでは、閲覧中の**意図しないキーボード操作でドキュメントが破壊される**ことがある。これを防ぐため、ドキュメント単位で「保護（Read Only）」フラグを付けられるようにする。

- フラグ ON → そのドキュメントは（編集権限があっても）読み取り専用として開かれる。
- 既定 OFF。
- 誤操作防止のため、編集しようとした際に「保護モードが有効です」と気づける導線を用意する。

## 2. 位置づけ（重要）

**これはアクセス制御（権限）ではなく、誤操作防止のための「緩いロック（advisory lock）」である。**

| 観点 | 保護フラグ（本機能） | ロール権限（Reader 等） |
|------|---------------------|------------------------|
| 実体 | ドキュメントプロパティ（Yjs 同期） | サーバー強制の権限（`Doc_Update`） |
| 誰が変えられる | 編集権限を持つ全員（Member/Owner/Admin） | Admin/Owner のみ |
| 目的 | 自分/他人の誤編集を防ぐ | セキュリティ境界 |
| 解除 | 本人がプロパティを OFF にすれば即編集可 | ロール変更が必要 |

つまり「鍵」ではなく「うっかり防止のカバー」。編集権限のあるユーザーは、保護を自分で外して編集を続行できる。Reader（元々編集不可）には影響しない。

## 3. 既存アーキテクチャ（調査結果）

### 3.0 前提：ドキュメント単位ロールは現状「非機能」

調査の結果、AFFiNE 由来の「ドキュメント単位のユーザーロール権限」機能は
**ofuro-wiki では非機能（デッドコード）**であることを実機（GraphQL introspection）で確認した。

- 共有メニューの doc権限UIが必要とする GraphQL 操作4つのうち、バックエンド実在は
  `grantDocUserRoles` の1つのみ。`grantedUsersList`（一覧表示）・`updateDocDefaultRole`
  （既定ロール変更）・`revokeDocUserRoles`（剥奪）は未実装。
- 共有メニューの `Members` / `Invite` タブは `display:none` で封印され、内容も `null`。
- したがって現状の機能する権限制御は **ワークスペース全体のロール（Admin/Owner/Member/Reader）のみ**。

**→ 本機能（保護フラグ）は「唯一のドキュメント単位の読み取り専用手段」として競合なく導入できる。**
doc単位ロールが動いていないため「両方あって混乱する」問題は起きない。
詳細は [doc-level-permission-dead-code.md](./doc-level-permission-dead-code.md) を参照。

### 3.1 読み取り専用の決定フロー

`desktop/pages/workspace/detail-page/detail-page.tsx`（300-302 行）で確定している。

```ts
const canEdit = useGuard('Doc_Update', doc.id);
const readonly = !canEdit || isInTrash;
```

この `readonly` が `PageDetailEditor`（`components/page-detail-editor.tsx:58`）に渡り、
`editor.doc.blockSuiteDoc.readonly = readonly ?? false;` で BlockSuite ストアに反映される。
BlockSuite 側の `readonly` は preact signal（`framework/store/src/model/store/store.ts:225` `_readonly = signal(false)`）で、
`true` の間は `addBlock`/`updateBlock`/`deleteBlock` 等がすべて no-op になる（同 305-329 行）。

**→ 保護フラグはこの `readonly` の算出条件に OR で足すだけで、既存の読み取り専用機構をそのまま流用できる。**

### 3.2 ドキュメントプロパティの保存

`modules/db/schema/schema.ts` の `docProperties`（Yjs 同期・ワークスペース DB）にシステムプロパティを追加する形。
`isTemplate: f.boolean().optional()` が最も近い先例。

```ts
docProperties: t.document({
  id: f.string().primaryKey(),
  primaryMode: f.string().optional(),
  isTemplate: f.boolean().optional(),
  // ... ここに readOnly を追加する
}),
```

読み書きは `doc.record.setProperty('isTemplate', value)` / `doc.record.properties$.selector(p => p.isTemplate)`。

### 3.3 プロパティ UI の型システム

`components/workspace-property-types/index.ts` の `WorkspacePropertyTypes` レジストリに型を登録する。
チェックボックス型の先例は `template.tsx`（`TemplateValue`）で、これをほぼ複製すればよい。

既定でどのプロパティを・どの順序で・表示するかは
`modules/workspace-property/constants.ts` の `BUILT_IN_CUSTOM_PROPERTY_TYPE` で制御。
`index`（並び順の昇順キー）と `show`（`always-show` / `always-hide` / `hide-when-empty`）を持つ。

**→ 保護プロパティを `index` 最小・`show: 'always-show'` で登録すれば、Issue 要件「プロパティを開いたときすぐ見える位置」を満たせる。**

## 4. 仕様

### 4.1 データモデル

`docProperties` スキーマに以下を追加：

```ts
readOnly: f.boolean().optional(),   // 保護フラグ。未設定/false=通常、true=保護
```

- Yjs 同期のため、ある人が ON にすると全クライアント・全セッションで保護がかかる。
- 既定値なし（= OFF 扱い）。

### 4.2 読み取り専用への反映

`detail-page.tsx` の算出を拡張：

```ts
const canEdit = useGuard('Doc_Update', doc.id);
const isProtected = useLiveData(
  doc.record.properties$.selector(p => p.readOnly)
);
const readonly = !canEdit || isInTrash || !!isProtected;
```

これにより保護 ON のドキュメントは、編集権限の有無に関わらず読み取り専用で開く。

### 4.3 プロパティ UI

- 新プロパティ型 `readOnly` を `WorkspacePropertyTypes` に登録（`uniqueId: 'readOnly'` で単一インスタンス制約）。
- 値コンポーネント `ReadOnlyValue`（`template.tsx` の `TemplateValue` を複製）。チェックボックスで ON/OFF。
- `BUILT_IN_CUSTOM_PROPERTY_TYPE` に登録：
  - `index`: `a0000000`（現状最小の `tags`=`a0000001` より前 → 最上部）
  - `show`: `'always-show'`（空でも常時表示）
- アイコンは施錠（Lock）系。

#### トグルの有効/無効ロジック（要注意）

保護 ON にすると 4.2 によりドキュメント全体が readonly になるが、**プロパティ行に渡る `readonly` をそのまま使うと、保護を掛けた本人が二度と OFF にできなくなる**。

そのため `ReadOnlyValue` のトグル可否は、ドキュメントの readonly ではなく
**`Doc_Update` 権限（`useGuard`）で直接判定する**：

- `Doc_Update` あり（Member/Owner/Admin）→ トグル操作可（ON/OFF 自由）
- `Doc_Update` なし（Reader）→ トグル無効（グレーアウト表示）

### 4.4 編集しようとした際のフィードバック

保護 ON かつ編集権限のあるユーザーが編集操作をした場合、保護に気づけるようにする。二段構えを推奨：

1. **常時バナー（第一報・案内のみ）**
   ドキュメント上部に「🔒 このドキュメントは保護モードです（編集する際はワークスペースのプロパティから保護モードを解除）」バナーを常時表示。
   ゴミ箱バナー（`detail-page.tsx` 周辺の既存パターン）と同じ設置場所・実装方式を流用。
   **バナーからのワンクリック解除は用意しない**（簡単に解除できると保護の意味が薄れるため）。
   解除は情報（ⓘ）→ワークスペースのプロパティ→「保護モード」トグルから行う（本来の方法）。バナーは気づきと解除方法の案内に徹する。

2. **編集操作時のモーダル（第二報）**
   エディタコンテナ上で編集意図のある操作（キー入力・貼り付け等）を検知したら、
   確認モーダル「保護モードが有効です」を表示し、「保護を解除して編集」/「閲覧のまま」を選べるようにする。
   - モーダル表示は `NotificationService`（`blocksuite/view-extensions/editor-view/notification-service.tsx` の `openConfirmModal`）を利用。
   - 毎キーで出すと煩わしいため、**同一ドキュメントを開いている間は初回のみ**表示（フラグでガード）。

> MVP として「1. バナー」だけでも Issue の主目的（誤編集防止・気づき）は満たせる。
> 「2. モーダル」は第2フェーズで追加してもよい（実装コストと UX のバランスで判断）。

### 4.5 一覧・その他での表示（任意）

- ドキュメント一覧で保護中を示すアイコン（`TemplateDocListProperty` 相当の `docListProperty`）。
- 必要なら group-by / filter 対応（`template` 型と同じ枠組みで追加可能）。MVP では省略可。

## 5. 権限・セキュリティ上の注意

- 本機能はサーバー権限を変更しない。**セキュリティ境界としては機能しない**（編集権限者は保護を外せる／API を直接叩けば編集可能）。あくまで UI 上の誤操作防止。
- Reader は元々編集不可なので、保護 ON/OFF の切り替えもできない（トグル無効）。
- Yjs 同期のため、ある人が保護 ON にすると他の編集者も読み取り専用になる。運用上「他人が掛けた保護を別の編集者が外せる」ことは許容（3 章のとおり advisory lock）。

## 6. 影響範囲（変更ファイル見込み）

| ファイル | 変更内容 |
|----------|----------|
| `modules/db/schema/schema.ts` | `docProperties` に `readOnly` 追加 |
| `desktop/pages/workspace/detail-page/detail-page.tsx` | `readonly` 算出に `isProtected` を OR |
| `components/workspace-property-types/read-only.tsx`（新規） | `ReadOnlyValue` チェックボックス（`template.tsx` 複製ベース） |
| `components/workspace-property-types/index.ts` | `readOnly` 型を登録 |
| `modules/workspace-property/constants.ts` | `BUILT_IN_CUSTOM_PROPERTY_TYPE` に最上部・always-show で追加 |
| 保護バナー用コンポーネント（新規） | ドキュメント上部バナー（案内のみ・解除ボタンなし） |
| （第2フェーズ）編集検知モーダル | `NotificationService` 経由の確認モーダル |
| `i18n/resources/en.json` / `ja.json` | ラベル・説明・バナー・モーダル文言 |

## 7. テスト方針

- **単体/結合**: `readOnly` プロパティの set/get が Yjs に反映され、別セッションで読み取り専用になること。
- **E2E（必須・基本動作）**: `e2e/integration.spec.ts` に追加
  - 保護 OFF → 編集できる
  - プロパティで保護 ON → 同ドキュメントが読み取り専用になり、キー入力しても本文が変化しない
  - 保護 ON の状態でもプロパティトグル（`Doc_Update` 保持者）で OFF に戻せ、再び編集できる
  - 保護 ON で表示されるバナーの案内どおり、プロパティトグルから解除すると再編集できる
- 静的解析（webpack コンパイル）が通ること。

## 8. 決定事項（2026-07-06 確定）

実装前の確認事項はすべて合意済み。以下で実装する。

| # | 論点 | 決定 |
|---|------|------|
| 1 | 保護の適用範囲 | **本文編集のみ**ロック（既存 `readonly` 機構の範囲）。タイトル変更・ゴミ箱移動・他プロパティ変更は対象外 |
| 2 | 誰が解除できるか | **編集権限者なら誰でも解除可**（advisory lock）。掛けた本人に限定しない |
| 3 | 呼称 | 「**保護モード**」で統一（バナー・プロパティ名・トグル） |
| 4 | Reader への表示 | 保護プロパティを**グレーアウトで表示**（トグル不可）。隠さない |
| 5 | 解除の方法 | **バナーに解除ボタンは置かない**。解除は情報→プロパティの「保護モード」トグルから（本来の方法）。簡単に解除できると保護の意味が薄れるため（2026-07-06 更新） |
| 6 | 通知方式 | **バナーのみ（MVP）**。編集操作時のモーダル（旧 4.4-2）は初回リリースに含めない（将来の第2フェーズ候補） |

> 旧 4.4-2（編集操作検知モーダル）は MVP スコープ外。Issue 原文では言及されているが、
> バナー（4.4-1）で主目的（誤編集防止・気づき）を満たせるため、まずバナーのみで出す。

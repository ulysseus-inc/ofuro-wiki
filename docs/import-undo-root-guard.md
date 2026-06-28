# インポート × Undo によるルートページ消失バグと再発防止ガード

## 事象

新規ページで Markdown / HTML / Notion などをインポートした**直後に Ctrl-Z（Undo）**すると、
インポートした文書だけでなく**ルートの `affine:page` ブロックごと全削除**され、
ドキュメントの `blocks` が空になる。

その結果、エディタ（`page-editor.ts` / `edgeless-editor.ts` の `if (!this.doc.root) return nothing`）が
描画できず、**ページが開けない**状態になる（`NoPageRootError: Page root not found when render editor!`）。
サーバー側エラーは発生せず、クライアントの描画段階で破綻する。

### 本番での実例（2026-06-21）

- doc `ZLbuuxwey4`（workspace `79d4dcfd-...`）。`doc_snapshots` 無し・`doc_updates` 3件のみ。
- update #0 = インポート本体（174ブロック・全文あり）、#1 = 同一更新の再送、#2 = 63バイトの全削除（Ctrl-Z）。
- 3件すべて 04:30:29〜04:30:35 の6秒間に集中。最終状態は `blocks` 空・ルート無し。
- 元コンテンツは update #0 に完全に残存しており復旧可能。

## 根本原因

正規の空ドキュメント初期化 `initDocFromProps()`
（`frontend/packages/frontend/core/src/blocksuite/initialization/index.ts`）は、
最後に必ず `doc.history.undoManager.clear()` を呼び、ルートページ作成を **Undo 不可**にしている。

一方、インポート経路
（`frontend/blocksuite/affine/widgets/linked-doc/src/transformers/{markdown,html,notion-html}.ts` の
`importMarkdownToDoc` / `importHTMLToDoc` / Notion zip など、`Transformer.toDoc` でドキュメントを生成する処理）は
この `undoManager.clear()` を呼んでいなかった。

そのため、インポートで生成したドキュメント全体（**ルートページブロックを含む**）が
Undo スタックに「取り消し可能」として積まれたままになり、1回の Ctrl-Z で丸ごと消滅していた。

## 修正（2層のガード）

### 修正1: インポートを Undo 不可のベースラインにする（根本原因）

`Transformer.toDoc` でドキュメントを生成した直後に、その新規ドキュメントに対して
`page.history.undoManager.clear()` を呼ぶ。正規の空ドキュメント初期化と同じ挙動に揃える。

対象（いずれも新規ドキュメント生成経路のみ。既存ドキュメントへ取り込む
`importMarkdownToBlock` / `importHTMLToBlock` は対象外で UI からも未使用）:

- `transformers/markdown.ts`: `importMarkdownToDoc` / `importMarkdownZip`
- `transformers/html.ts`: `importHTMLToDoc` / `importHTMLZip`
- `transformers/notion-html.ts`: Notion zip インポートの各ページ

これによりインポート直後の Ctrl-Z はルートを破壊しなくなる。
（インポート全体を1回の Undo で取り消すことはできなくなるが、これは新規ページ作成と同じ仕様。
 取り込み後の編集に対する Undo は通常どおり機能する。）

### 修正2: ルート欠落ドキュメントの自己修復（多層防御）

`Doc` エンティティ（`frontend/packages/frontend/core/src/modules/doc/entities/doc.ts`）に
`ensureRootBlock()` を追加。編集ページ（`detail-page.tsx`）でドキュメントを開く際、
**編集可能な場合のみ**呼び出す。

`ensureRootBlock()` のガード:

1. `waitForSyncReady()` で同期完了を待ってから判定（同期前の一時的なルート不在での誤発火を防ぐ）
2. `readonly`（Reader 権限・ゴミ箱・共有ビュー）では何もしない
3. ルートが既に存在する通常ドキュメントでは何もしない（冪等）
4. 上記を満たし、なおルートが無い場合のみ `page/surface/note/paragraph` を再生成し、
   `undoManager.clear()` で再生成分を Undo 不可にする

これにより、原因を問わずルートが欠落したドキュメントは「開けない」状態から
「空ページとして開ける」状態に自己修復される。
既存の壊れたドキュメント（`ZLbuuxwey4` など）も、編集可能ユーザーが開けば復旧する。

共有ページ（`share-page.tsx`）は読み取り専用で、ルート欠落時は意図的に「Doc is empty」を
表示する設計のため、自己修復の対象外（現状維持）。

## 影響範囲（デグレ検証）

- ルートを持つ通常ドキュメントでは自己修復は一度も発火しない（`doc.root` が非 null のため即スキップ）。
- 挙動が変わるのは「ルート欠落の壊れたドキュメント」のみで、「開けない → 空ページとして開く」へ改善する。
- 残存リスク（軽微）: 同一の壊れたドキュメントを複数ユーザーが同時に開くと自己修復が二重発火し、
  `affine:page` が複数マージされ得る（壊れたドキュメントは少数で稀。BlockSuite は先頭ルートを採用）。

## テスト

E2E: `e2e/integration.spec.ts` の「インポート × Undo の安全性」。
Markdown をインポート → 直後に Ctrl-Z しても本文とタイトルブロックが残り、ページが開けることを検証する。

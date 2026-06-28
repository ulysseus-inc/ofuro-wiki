# カラムブロック（2列・3列レイアウト）仕様

自作の段組みブロック。`affine:columns`（親・CSS grid）→ `affine:column-cell`（各列）→ 任意の content ブロック（段落・リスト等）。

- 実装: `frontend/blocksuite/affine/blocks/columns/`
- モデル: `frontend/blocksuite/affine/model/src/blocks/columns/columns-model.ts`
- スラッシュメニュー: `/2列`・`/3列`（カラム内では非表示＝入れ子防止）

## ブロック構造

```
affine:columns        (role: hub, prop: columnCount=2|3, parent: affine:note)
└─ affine:column-cell (role: hub, parent: affine:columns)
   └─ @content / database / data-view / callout
```

`ColumnsBlockComponent` は `grid-template-columns: repeat(columnCount, 1fr)` でセルを並べ、
各 `ColumnCellBlockComponent` は `renderChildren()`（lit `repeat`）で子ブロックを描画する。

## 既知の不具合と防御策（self-heal）

### 事象
長時間開いたタブで `/` 入力やコピー＆ペーストを繰り返すと、まれに
`TypeError: Cannot read properties of null (reading 'nextSibling')` が
`ColumnCellBlockComponent.update` → lit-html `repeat` → `_$clear` で多発し、
`selectionchange` のたびに再発してドキュメント全体が操作不能になる。**リロードで回復する。**

### 原因の切り分け（2026-06-05 調査）
- 永続データの破損ではない（実データを新規に開くと正常に描画・編集できる）。
- ブラウザ拡張（パスワードマネージャ等）の DOM 注入でもない（注入ノード 0）。
- ブロックモデルのツリーは整合（子id重複 0・欠落参照 0。孤児カラム 1個のみで無害）。
- ⇒ **モデルは正しいのに lit `repeat` が管理する DOM の境界ノードだけが実行中にズレる、
  純粋なレンダリング層の一時的 desync**。ネストの深いカラムセル内で、ネイティブな
  DOM 改変（ペースト/IME/選択）が lit の境界コメントノードを切り離すのが要因と推定。

### 防御策
`ColumnsBlockComponent` / `ColumnCellBlockComponent` の `update()` を try/catch で包み、
描画中に例外が出たら描画状態を捨てて作り直す（リロード相当の自己回復）。
モデルは整合しているため、作り直せば正しく再描画される。

実装: `recoverable-block.ts` の `RecoverableRenderMixin`
- `delete this['_$litPart$']`（lit-html がパートを保持する安定プロパティ）
- `this.replaceChildren()` で DOM を空に
- `this.requestUpdate()` で再描画
- タイトループ防止のため直近の回復から一定時間は再回復を抑止

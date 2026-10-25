---
name: ofuro-wiki-format
description: ofuro-wiki CLI（ofuro read / ofuro edit）の読取表現と編集操作 JSON の書式。ofuro edit の操作を組み立てる前に読む。
---

# ofuro-wiki の読取表現と編集操作

## 読取表現（`ofuro read <docId>`）

```
---
docId: abc
title: 設計方針
url: https://wiki.example.com/workspace/<ws>/abc
---
{#b1} # 設計方針
{#b2} **重要**: 詳細は [設計書](https://wiki.example.com/workspace/<ws>/xyz) を参照
{#b3} * [ ] レビュー
{#b4}   * 子項目
{#t1} | 項目 | 値 |
      | -- | - |
      | A  | 1 |
{#d1} [database 読み取り専用] 案件一覧（3 列 × 12 行）
{#m1} [columns 編集不可]
{#c1}   [column-cell 編集不可]
{#p1}     左の列の段落
{#c2}   [column-cell 編集不可]
{#p2}     右の列の段落
```

- 行頭の `{#ID}` がブロック ID。編集操作ではこの ID でブロックを指す。
- 字下げ（2 文字ずつ）は入れ子。上の例で `b4` は `b3` の子。
- 2 行目以降が続くブロック（コード・表）は、ID の幅だけ字下げして続く。
- 本文は Markdown。ページ参照は、そのページの URL へのリンク。
- `編集不可` / `読み取り専用` のブロックとその中身は、読めるが操作できない。
- ただしマルチカラム（`columns` / `column-cell`）は**構造だけ**が編集不可。中のブロック（上の `p1` / `p2`）は外と同じく編集できる。列に足すときは `parent` に `column-cell` の ID（上の `c1`）を指定する。列の増減・幅・並び、`columns` / `column-cell` 自体の削除・移動はできない。セルの最後のブロックを消す・動かすと、空の段落が1つ残る。
- ノートが複数あるページだけ `[note]` の行が出る。
- `<docId>` にはページ URL を渡してもよい。
- `--json` を付けると、ブロックごとの `id` / `flavour` / `parentId` / `depth` / `access` / `content` を返す。

## 編集操作（`ofuro edit <docId> --ops '<JSON>'`）

JSON の配列で渡す。1 回の `edit` は全部当たるか、何も当たらない。

| op                                    | 引数                                    | 内容                                                     |
| ------------------------------------- | --------------------------------------- | -------------------------------------------------------- |
| `insert`                              | `content`, 位置                         | ブロックを追加。`content` は Markdown（複数ブロック可）  |
| `replace`                             | `block`, `expect`, `content`            | 1 ブロックの本文・種類を変える                           |
| `delete`                              | `block`, `expect`                       | ブロックを子ごと消す                                     |
| `move`                                | `block`, 位置                           | ブロックを子ごと動かす                                   |
| `table.set`                           | `block`, `row`, `col`, `expect`, `text` | 表のセルを変える                                         |
| `table.insertRow` / `table.insertCol` | `block`, `at`?, `cells`?                | 行・列を `at` 番目に足す（省略で末尾）。`cells` は初期値 |
| `table.deleteRow` / `table.deleteCol` | `block`, `index`, `expect`?             | 行・列を消す。`expect` はその行・列のセルの配列          |
| `title`                               | `text`, `expect`?                       | ページの題を変える                                       |

- 位置: `after: ID`（その後ろ）/ `before: ID`（その前）/ `parent: ID`（その子の末尾）のどれか 1 つ。省略するとページの末尾。
- `expect` には `read` で見た本文（`{#ID}` と字下げを除いた部分）をそのまま書く（記号の前の `\` は省いてもよい）。今の本文と違えば、編集全体を中止する。読み直して作り直すこと。
- 箇条書き・ToDo の `expect` は、記号を省いて本文だけ書いてもよい（例: `* [ ] レビュー` は `レビュー`）。記号を書いたなら記号も照合する。
- 表の行・列の番号は 0 始まり。見出し行が 0 行目。
- 変えていない文字の書式（文字色等、Markdown に出ないものを含む）は残る。
- 種類を変える `replace`（例: 段落 → 箇条書き）はブロックを作り直す。新しい ID は結果に出る。
- 作れる種類: 見出し・段落・箇条書き・番号付き・ToDo・引用・コード・区切り線・表。

例:

```json
[
  { "op": "replace", "block": "b2", "expect": "**重要**: 詳細は [設計書](https://wiki.example.com/workspace/<ws>/xyz) を参照", "content": "**重要**: 詳細は別紙を参照" },
  { "op": "insert", "after": "b3", "content": "* [ ] テスト" },
  { "op": "table.set", "block": "t1", "row": 1, "col": 1, "expect": "1", "text": "2" }
]
```

`--dry-run` を付けると、送信せずに適用後との差分を出す。

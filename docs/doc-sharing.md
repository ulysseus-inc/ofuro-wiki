# ドキュメントの共有

**「共有する」というユーザー操作の仕様。**

[`doc-permission.md`](doc-permission.md) は「**誰が何をできるか**」（権限モデル）を定める。
この文書は「**利用者がどう共有するか**」を定める。**混ぜないこと。**

| 文書 | 定めるもの |
|---|---|
| `document-structure.md` | データが**どこにあるか** |
| [`doc-permission.md`](doc-permission.md) | 誰が**何をできるか**（Role / 実効ロール / Read・Discovery Authorization） |
| **この文書** | 利用者が**どう共有するか**（Share / Unshare / Change Role） |

---

## 1. ⚠️ v0.1.0 の共有はワークスペース内に限る

> ## **ドキュメント共有 ≠ ワークスペース外の人への招待**

```
ワークスペースに所属している利用者
        ↓
DocPermission を付与する
```

**ワークスペース外への共有は v0.1.0 では行わない。** 将来 `External` /
Public Share として**別の経路**で実装する
（[`doc-permission.md`](doc-permission.md)「`External` は実効ロールの評価対象外」）。

⚠️ これは実効ロールの計算が
**「ワークスペースのメンバーでなければ不許可」を前提にしている**ことと一致する。
非メンバーに `DocPermission` を作っても**アクセスできない**（作るべきでない）。

---

## 2. 操作と結果

| 操作 | WS メンバー | `DocPermission` | 結果 |
|---|:---:|:---:|---|
| 通常利用 | ✅ | なし | **ワークスペースのロールを継承** |
| 特定の人へ共有 | ✅ | `Reader` | 読める |
| 特定の人へ編集を許す | ✅ | `Editor` | 読み書きできる |
| 特定の人から権限を外す | ✅ | `None` | **アクセス不可** |
| 非メンバーへ共有 | ❌ | （作っても） | **不可**（→ 1） |
| 公開リンク | ❌ | — | `External` / **別仕様**（未実装） |

例（`defaultRole = None` のドキュメント）:

```
A = Reader   → 読める
B = Reader   → 読める
C = 設定なし → None（既定ロールが効く）＝ 見えない
```

---

## 3. ⚠️ 「権限変更」と「共有解除」は別物

**UI でも API でも意味が違う。混同しないこと。**

| | 操作 | API | 結果 |
|---|---|---|---|
| **権限変更** | A を `Editor` → `Reader` | `updateDocUserRole` | **`DocPermission` は残る**。値が変わる |
| **共有解除** | A の個別設定を消す | `revokeDocUserRoles` | **`DocPermission` が消える**。既定ロールに戻る |

```
defaultRole = Reader、A = Editor のとき

  権限変更（A → Reader）    … A は Reader（個別設定として）
  共有解除（A を revoke）    … A は Reader（既定ロールとして）
```

**この例では結果が同じに見えるが、意味が違う。**
既定ロールをあとで `None` に変えたとき、前者は `Reader` のまま、
後者は `None` になる。

---

## 4. ⚠️ 共有解除は Discovery Authorization の解除でもある

> ## **共有解除 = Read Authorization の解除 + Discovery Authorization の解除**

**権限テーブルを変えるだけでは足りない。**

```
defaultRole = None
A = Reader          … A だけが見える状態

  ↓ A の Reader を revoke

A から、そのドキュメントの
  本文が読めなくなる          （Read Authorization）
  存在も見えなくなる          （Discovery Authorization）★ ここを忘れやすい
```

⚠️ **「本文を開けなくする処理」だと考えると、一覧にタイトルが残る。**
それでは「存在を知られない」という要件を満たさない
（[`doc-permission.md`](doc-permission.md)「認可は2種類ある」）。

### 権限を変えたときに起きること

```
権限変更（grant / revoke / updateRole / updateDefaultRole）
   ↓
DocPermission / DocMeta.defaultRole を更新
   ↓
Discovery Revision を上げる          ← 取りこぼしの検出用
   ↓
対象利用者の Discovery Cache を invalidate   ← 即時失効用
   ↓
① Persistent Cache（IndexedDB）
② Runtime Store（DocsStore / Document Record）
③ UI 由来の状態（最近使ったページ / クイック検索 / お気に入り / コレクション）
   ＋ 複数タブへ伝播
```

詳細は [`doc-permission.md`](doc-permission.md)「Discovery Index Local Cache」。

---

## 5. API

| 操作 | API | 必要な権限 |
|---|---|---|
| 共有する | `grantDocUserRoles`（複数人まとめて） | `Doc_Users_Manage` |
| 権限を変える | `updateDocUserRole` | `Doc_Users_Manage` |
| 共有を解除する | `revokeDocUserRoles` | `Doc_Users_Manage` |
| 既定ロールを変える | `updateDocDefaultRole` | `Doc_Users_Manage` |
| 権限を持つ人の一覧 | `workspace.doc.grantedUsersList` | `Doc_Users_Read` |
| 既定ロールを見る | `workspace.doc.defaultRole` | `Doc_Read` |

> ⚠️ **自分より強いロールは配れない。**
> `Doc_Users_Manage` を持つのは Owner と Manager だが、Manager が `Owner` を
> 配れると**自分を Owner に昇格できる**（`Doc_TransferOwner` / `Doc_Delete` を得る）。
>
> ⚠️ **既定ロールに指定できるのは画面が扱える4つだけ**
> （`Manager` / `Editor` / `Reader` / `None`）。
> `Owner` / `External` / `Commenter` は指定できない。

---

## 6. 監査ログ

**権限の変更は必ず記録する。** 「誰がいつ、誰に何を見せるようにしたか」が
追えないと、情報漏洩の調査ができない。

| 操作 | action |
|---|---|
| 共有する | `doc.permission.grant` |
| 共有を解除する | `doc.permission.revoke` |
| 権限を変える | `doc.permission.role` |
| 既定ロールを変える | `doc.permission.default` |

⚠️ **対象名（ドキュメントのタイトル）は残らない。** Interceptor は引数しか
見ないため。**代わりに「誰に配ったか」（`userIds` / `role`）が `detail.meta` に入り、
漏洩の範囲を特定できる。**

詳細は [`logging.md`](logging.md)。

---

## 7. 画面

共有メニュー（`share-menu`）の「一般アクセス」に、次の1行がある。

```
ワークスペースのメンバー   [ 編集可能 ▾ ]   ← defaultRole を変える
```

### ⚠️ 「リンクを持っている全員」（公開リンク）の行は出さない（2026-09-11）

AFFiNE 由来の画面にはこの行があったが、**公開リンクは未実装**（→ 2・8）なので**隠した**。

⚠️ **出していると嘘になる。** `publishPage` を呼ぶと DB の `doc_meta.public` は立つが、
**バックエンドはページの `public` を読み取りの許可に使っていない**。
表示は「読み取り専用」に変わるのに、そのリンクを未ログインで開くと
**サインイン画面になり、誰も読めない**（REST 401・GraphQL UNAUTHENTICATED を実測）。

⚠️ それまでは GraphQL 定義が実装と食い違っていて**公開が失敗し、表示は「アクセス不可」のまま**だった。
定義だけ直すと（#203 の当初案）、**正直だった表示が嘘になる**。

公開リンク用の部品（`PublicDoc`）と `publishPage` / `revokePublicPage` のクライアント定義は**削除した**（使われないコードは実装と乖離するため）。公開リンク（`External`）は読み取りの許可から別途設計する。

「メンバーを管理」から個別の共有（`grantedUsersList`）へ進む。

| 表示 | 中身 |
|---|---|
| 管理可能 | `Manager` |
| 編集可能 | `Editor` |
| 読み取り専用 | `Reader` |
| アクセス不可 | `None` |

> ⚠️ **画面が名前を持たない値をサーバーから返さないこと。**
> 選択肢に無い値（`Owner` など）を返すと、**ロール名が空欄で表示される**
> （エラーにならないため気づきにくい）。

---

## 8. まだ決めていないこと

| | 内容 |
|---|---|
| 共有時の通知 | 現在は通知しない。相手は次にアクセスしたとき見える |
| ワークスペース外への共有 | v0.1.0 では行わない（→ 1） |
| 公開リンク | `External` の経路が未実装（`publishPage` は別の仕組み）。⚠️ **画面には出さない**（→ 7） |

---

## 関連

- [`doc-permission.md`](doc-permission.md) — 権限モデル（Role / 実効ロール / 2種類の認可）
- `document-structure.md` — データがどこにあるか
- [`logging.md`](logging.md) — 監査ログ
- Issue #97（ページ単位の権限）/ Issue #151（Discovery Authorization）

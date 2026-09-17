/**
 * #151 段階3: **その docId は利用者が作ったドキュメント本体か。**
 *
 * 同期の経路には、利用者のページ以外も流れてくる。台帳（`doc_meta`）に
 * 対応する行があるのは**ページ本体だけ**なので、更新日時を進める対象を
 * ここで絞る。
 *
 * | 除くもの | なぜ |
 * |---|---|
 * | **ルート文書**（`docId === workspaceId`） | ⚠️ **ページではない。** 目次・ワークスペース名・タグ定義が入った入れ物。誰かが**ワークスペース名を変えただけ**で、同じ id を持つページの更新日時が動くのを防ぐ |
 * | **内部ドキュメント**（`$` を含む） | `db$<ws>$docProperties` / `db$<ws>$folders`。利用者が作ったものではない |
 *
 * ⚠️ 除かなくても `updateMany` は 0 件で素通りする。それでも条件として
 * 書くのは、**無駄な UPDATE を避け、意図を残す**ため。
 *
 * 詳細は docs/document-structure.md と
 * docs/discovery-stage3-comparison.md 7.10.4
 */
export function isUserDoc(workspaceId: string, docId: string): boolean {
  if (docId === workspaceId) return false;
  if (docId.includes('$')) return false;
  return true;
}

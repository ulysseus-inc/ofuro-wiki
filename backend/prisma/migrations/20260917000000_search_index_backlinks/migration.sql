-- #101: バックリンクのために search_index へ列を足す。
--
-- 画面（AFFiNE 由来）は「このページを参照しているブロック」を
-- refDocId で絞って問い合わせるが、テーブルに列が無く、
-- 毎回 42703（column "ref_doc_id" does not exist）で失敗していた。
--
-- ⚠️ すべて NULL 可。既存行はそのまま残り、リンクの情報だけが空になる。
--    既存ページの分は索引の作り直しで埋める（docs/search-index.md 6章）。
ALTER TABLE "search_index" ADD COLUMN "ref_doc_id" VARCHAR(255);
ALTER TABLE "search_index" ADD COLUMN "ref" TEXT;
ALTER TABLE "search_index" ADD COLUMN "parent_block_id" VARCHAR(255);
ALTER TABLE "search_index" ADD COLUMN "parent_flavour" VARCHAR(50);
ALTER TABLE "search_index" ADD COLUMN "additional" TEXT;
ALTER TABLE "search_index" ADD COLUMN "markdown_preview" TEXT;
ALTER TABLE "search_index" ADD COLUMN "summary" TEXT;

-- 「このページを参照しているブロック」を引くための索引。
-- ⚠️ 無いと、バックリンクの表示でワークスペース全体の走査になる。
CREATE INDEX "idx_search_ref_doc" ON "search_index"("workspace_id", "ref_doc_id");

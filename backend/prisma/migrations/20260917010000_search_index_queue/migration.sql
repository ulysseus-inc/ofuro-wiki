-- #101: 索引の作り直し待ち（docs/search-index.md 5章）。
--
-- 本文の保存と同一トランザクションで pending_generation を進め、
-- 巡回が静まった行だけを作り直して indexed_generation を進める。
-- pending > indexed が「作り直しが要る」。
--
-- ⚠️ doc_meta に相乗りしない。台帳の行が無いページが過去に存在し、
--    相乗りすると取りこぼす。
CREATE TABLE "search_index_queue" (
  "workspace_id"       UUID         NOT NULL,
  "doc_id"             VARCHAR(255) NOT NULL,
  "pending_generation" BIGINT       NOT NULL DEFAULT 1,
  "indexed_generation" BIGINT       NOT NULL DEFAULT 0,
  "pending_at"         TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT "search_index_queue_pkey" PRIMARY KEY ("workspace_id", "doc_id"),
  CONSTRAINT "search_index_queue_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
);

-- 巡回は「静まった行」を pending_at で引く
CREATE INDEX "idx_search_queue_pending" ON "search_index_queue"("pending_at");

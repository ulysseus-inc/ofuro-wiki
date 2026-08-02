-- #90: 監査ログを実行者で絞り込むための索引。
--
-- 画面は actorEmail の部分一致（ILIKE '%...%'）で検索する。索引が無いと
-- 3年で225万行の全表走査になり、絞り込みのたびにサーバーが重くなる。
-- 部分一致には B-tree が効かないため、pg_trgm の GIN 索引を使う。
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "audit_logs_actor_email_trgm_idx"
  ON "audit_logs" USING gin ("actor_email" gin_trgm_ops);

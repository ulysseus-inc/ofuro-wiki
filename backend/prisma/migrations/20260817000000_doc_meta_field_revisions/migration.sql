-- #151 段階3: doc_meta にフィールド単位の版数を追加する。
--
-- 用途は2つ（docs/discovery-stage3-comparison.md 7.5.10 / 7.7）
--   1. 競合制御（恒久）
--   2. 移行判定（PR1〜PR5 の期間限定）… 0 = Yjs が正 / 0 超 = doc_meta が正
--
-- ⚠️ 既定値は 0。既存行はすべて「まだ API 管理へ移行していない」状態になり、
--    doc-meta-sync の挙動は今までと変わらない。
-- ⚠️ schema.prisma の @default(0) と揃えること。揃えないと次の
--    `prisma migrate dev` が差分を生成する。
ALTER TABLE "doc_meta"
  ADD COLUMN "title_revision" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "trash_revision" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "tags_revision"  BIGINT NOT NULL DEFAULT 0;

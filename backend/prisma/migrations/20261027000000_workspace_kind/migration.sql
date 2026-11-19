-- #297: ワークスペースの種類（docs/workspace-model.md 12.1）。
--
-- 'private' … 1 人 1 つ。本人だけ。システム管理者も素通りしない
-- 'shared'  … システム管理者が作る。持ち主は root。システム管理者は素通りする
--
-- ⚠️ 既存はいったん全部 'private' になる。共有にすべきものの分類は
--    移行ツール（src/scripts/migrate-workspace-kind.ts）で行う。
--    流すまでの間、システム管理者は「メンバーでない」既存ワークスペースを開けない。
ALTER TABLE "workspaces" ADD COLUMN "kind" VARCHAR(20) NOT NULL DEFAULT 'private';

-- マニュアル（#72）は共有。書けないのは isManualWorkspace の判定が先に効くため変わらない
UPDATE "workspaces" SET "kind" = 'shared' WHERE "id"::text LIKE 'ffffffff-ffff-4fff-bfff-%';

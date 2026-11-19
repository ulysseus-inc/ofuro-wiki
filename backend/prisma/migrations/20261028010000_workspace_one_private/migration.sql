-- #297: プライベートは 1 人 1 つ（docs/workspace-model.md 12.3・12.9）。
--
-- ⚠️ **重複が無いときだけ作る。** 移行ツールを流す前は、既存がすべて 'private' で、
-- 1 人が 2 つ以上持つことがある。そのまま CREATE すると、起動時のマイグレーションが
-- 失敗して止まる。作れなかった環境は、移行ツールが --apply の最後に作る。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "workspaces" WHERE "kind" = 'private'
    GROUP BY "owner_id" HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "workspaces_one_private_per_owner"
      ON "workspaces" ("owner_id") WHERE "kind" = 'private';
  ELSE
    RAISE NOTICE 'workspaces_one_private_per_owner: 重複があるため作りません。移行ツール（migrate-workspace-kind）が作ります';
  END IF;
END $$;

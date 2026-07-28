-- #93: ログイン試行回数制限・アカウントロックアウト用のカラムを追加
ALTER TABLE "users" ADD COLUMN "failed_login_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "locked_until" TIMESTAMPTZ;
ALTER TABLE "users" ADD COLUMN "last_failed_login_at" TIMESTAMPTZ;

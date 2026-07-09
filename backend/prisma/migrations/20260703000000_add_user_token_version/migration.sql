-- L-1: JWT 即時失効用の token_version カラムを追加
ALTER TABLE "users" ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;

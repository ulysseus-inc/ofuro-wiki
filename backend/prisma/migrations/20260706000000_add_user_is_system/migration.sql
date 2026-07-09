-- #72: マニュアルWS所有などのシステム内部アカウント識別フラグ。
-- ログイン不可・Admin ユーザー一覧から除外する用途。
ALTER TABLE "users" ADD COLUMN "is_system" BOOLEAN NOT NULL DEFAULT false;

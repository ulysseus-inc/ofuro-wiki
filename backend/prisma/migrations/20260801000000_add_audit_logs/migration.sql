-- #90: 監査ログ（docs/logging.md 2章）
--
-- actor_email / actor_name / target_name は「当時の値」を文字列で保持する。
-- 外部キー参照だけだと、利用者の削除や氏名変更で「当時誰だったか」が
-- 分からなくなり、監査ログとして成立しないため。
CREATE TABLE "audit_logs" (
    "id"           UUID PRIMARY KEY,
    "actor_id"     UUID,
    "actor_email"  VARCHAR(255) NOT NULL,
    "actor_name"   VARCHAR(255),
    "action"       VARCHAR(64) NOT NULL,
    "target_type"  VARCHAR(32),
    "target_id"    VARCHAR(255),
    "target_name"  VARCHAR(255),
    "workspace_id" UUID,
    "ip"           VARCHAR(45),
    "user_agent"   VARCHAR(255),
    "detail"       JSONB,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 一覧は新しい順。絞り込みは利用者・操作種別で行う（3年で225万行を想定）
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" ("created_at");
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs" ("actor_id", "created_at");
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs" ("action", "created_at");

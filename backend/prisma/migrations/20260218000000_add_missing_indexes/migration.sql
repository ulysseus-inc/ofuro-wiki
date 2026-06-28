-- Foreign key indexes (PostgreSQL does not auto-index FK columns)

-- workspaces.owner_id
CREATE INDEX "idx_workspaces_owner" ON "workspaces" ("owner_id");

-- doc_snapshots.editor_id
CREATE INDEX "idx_doc_snapshots_editor" ON "doc_snapshots" ("editor_id");

-- doc_histories: lookup + editor FK
CREATE INDEX "idx_doc_histories_lookup" ON "doc_histories" ("workspace_id", "doc_id", "timestamp");
CREATE INDEX "idx_doc_histories_editor" ON "doc_histories" ("editor_id");

-- doc_meta: created_by / updated_by FK
CREATE INDEX "idx_doc_meta_created_by" ON "doc_meta" ("created_by");
CREATE INDEX "idx_doc_meta_updated_by" ON "doc_meta" ("updated_by");

-- doc_permissions.user_id (unique covers workspace+doc+user, but not user alone)
CREATE INDEX "idx_doc_permissions_user" ON "doc_permissions" ("user_id");

-- invitations: workspace_id + inviter_id FK
CREATE INDEX "idx_invitations_workspace" ON "invitations" ("workspace_id");
CREATE INDEX "idx_invitations_inviter" ON "invitations" ("inviter_id");

-- sessions.user_id FK + expires_at for cleanup
CREATE INDEX "idx_sessions_user" ON "sessions" ("user_id");
CREATE INDEX "idx_sessions_expires" ON "sessions" ("expires_at");

-- replies: comment_id + user_id FK
CREATE INDEX "idx_replies_comment" ON "replies" ("comment_id");
CREATE INDEX "idx_replies_user" ON "replies" ("user_id");

-- email_tokens: expires_at for cleanup queries
CREATE INDEX "idx_email_tokens_expires" ON "email_tokens" ("expires_at");

-- Partial indexes for common query patterns

-- Unread notifications (most frequent query)
CREATE INDEX "idx_notification_unread" ON "notifications" ("user_id", "created_at")
WHERE "read" = false;

-- Active (non-deleted) blobs
CREATE INDEX "idx_blobs_active" ON "blobs" ("workspace_id", "key")
WHERE "deleted" = false;

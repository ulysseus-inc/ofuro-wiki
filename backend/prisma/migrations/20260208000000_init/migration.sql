-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255),
    "avatar_url" TEXT,
    "password_hash" TEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255),
    "avatar_key" TEXT,
    "public" BOOLEAN NOT NULL DEFAULT false,
    "owner_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" VARCHAR(50) NOT NULL DEFAULT 'member',
    "status" VARCHAR(50) NOT NULL DEFAULT 'accepted',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_snapshots" (
    "workspace_id" UUID NOT NULL,
    "doc_id" VARCHAR(255) NOT NULL,
    "blob" BYTEA NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editor_id" UUID,

    CONSTRAINT "doc_snapshots_pkey" PRIMARY KEY ("workspace_id","doc_id")
);

-- CreateTable
CREATE TABLE "doc_updates" (
    "id" BIGSERIAL NOT NULL,
    "workspace_id" UUID NOT NULL,
    "doc_id" VARCHAR(255) NOT NULL,
    "blob" BYTEA NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editor_id" UUID,

    CONSTRAINT "doc_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_histories" (
    "id" BIGSERIAL NOT NULL,
    "workspace_id" UUID NOT NULL,
    "doc_id" VARCHAR(255) NOT NULL,
    "blob" BYTEA NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL,
    "editor_id" UUID,

    CONSTRAINT "doc_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_meta" (
    "workspace_id" UUID NOT NULL,
    "doc_id" VARCHAR(255) NOT NULL,
    "title" TEXT,
    "mode" VARCHAR(20) NOT NULL DEFAULT 'page',
    "public" BOOLEAN NOT NULL DEFAULT false,
    "default_role" VARCHAR(50) NOT NULL DEFAULT 'reader',
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "doc_meta_pkey" PRIMARY KEY ("workspace_id","doc_id")
);

-- CreateTable
CREATE TABLE "doc_permissions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "doc_id" VARCHAR(255) NOT NULL,
    "user_id" UUID NOT NULL,
    "role" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doc_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blobs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "mime" VARCHAR(255),
    "size" BIGINT,
    "storage_path" TEXT NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "inviter_id" UUID NOT NULL,
    "email" VARCHAR(255),
    "role" VARCHAR(50) NOT NULL DEFAULT 'member',
    "expire_time" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_spaces" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_spaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_index" (
    "id" BIGSERIAL NOT NULL,
    "workspace_id" UUID NOT NULL,
    "doc_id" VARCHAR(255) NOT NULL,
    "block_id" VARCHAR(255),
    "title" TEXT,
    "content" TEXT NOT NULL,
    "block_type" VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "search_index_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_key" ON "workspace_members"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_doc_updates_lookup" ON "doc_updates"("workspace_id", "doc_id", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "doc_permissions_workspace_id_doc_id_user_id_key" ON "doc_permissions"("workspace_id", "doc_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "blobs_workspace_id_key_key" ON "blobs"("workspace_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "user_spaces_user_id_workspace_id_key" ON "user_spaces"("user_id", "workspace_id");

-- CreateIndex
CREATE INDEX "idx_search_workspace" ON "search_index"("workspace_id", "doc_id");

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_snapshots" ADD CONSTRAINT "doc_snapshots_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_snapshots" ADD CONSTRAINT "doc_snapshots_editor_id_fkey" FOREIGN KEY ("editor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_updates" ADD CONSTRAINT "doc_updates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_updates" ADD CONSTRAINT "doc_updates_editor_id_fkey" FOREIGN KEY ("editor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_histories" ADD CONSTRAINT "doc_histories_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_histories" ADD CONSTRAINT "doc_histories_editor_id_fkey" FOREIGN KEY ("editor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_meta" ADD CONSTRAINT "doc_meta_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_meta" ADD CONSTRAINT "doc_meta_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_meta" ADD CONSTRAINT "doc_meta_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_permissions" ADD CONSTRAINT "doc_permissions_workspace_id_doc_id_fkey" FOREIGN KEY ("workspace_id", "doc_id") REFERENCES "doc_meta"("workspace_id", "doc_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_permissions" ADD CONSTRAINT "doc_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blobs" ADD CONSTRAINT "blobs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_spaces" ADD CONSTRAINT "user_spaces_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_spaces" ADD CONSTRAINT "user_spaces_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_index" ADD CONSTRAINT "search_index_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PGroonga: Full-text search indexes for Japanese
CREATE INDEX idx_search_content ON "search_index" USING pgroonga ("content");
CREATE INDEX idx_search_title ON "search_index" USING pgroonga ("title");


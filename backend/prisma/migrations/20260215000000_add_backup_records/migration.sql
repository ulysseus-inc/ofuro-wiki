-- CreateTable
CREATE TABLE "backup_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "filename" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "workspace_count" INTEGER NOT NULL,
    "doc_count" INTEGER NOT NULL,
    "blob_count" INTEGER NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'completed',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "backup_records_pkey" PRIMARY KEY ("id")
);

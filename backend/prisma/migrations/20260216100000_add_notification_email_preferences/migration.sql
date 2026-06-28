-- AlterTable
ALTER TABLE "users" ADD COLUMN "receive_invitation_email" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "receive_mention_email" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "receive_comment_email" BOOLEAN NOT NULL DEFAULT false;

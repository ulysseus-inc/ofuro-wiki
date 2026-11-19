-- #297: ワークスペースの種類は 'private' か 'shared' だけ（docs/workspace-model.md 12.1）。
-- 打ち間違いなど未知の値を DB で止める。未知の値はシステム管理者も素通りさせない作りだが、
-- 入れさせないほうが確実（レビューの指摘）
ALTER TABLE "workspaces"
  ADD CONSTRAINT "workspaces_kind_check" CHECK ("kind" IN ('private', 'shared'));

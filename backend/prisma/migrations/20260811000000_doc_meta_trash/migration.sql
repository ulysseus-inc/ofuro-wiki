-- #151: ゴミ箱の状態をサーバー側で持つ
--
-- これまでゴミ箱は Yjs 目次（rootYDoc.meta.pages[].trash）にしか無く、
-- サーバーは知らなかった。一覧をサーバー由来に切り替えると、
-- **削除したページが一覧に復活する**ため追加する。
--
-- 既定は false。既存行は「ゴミ箱に入っていない」として扱い、
-- Yjs 目次からの同期で正しい値に更新される。
ALTER TABLE doc_meta ADD COLUMN trash BOOLEAN NOT NULL DEFAULT false;

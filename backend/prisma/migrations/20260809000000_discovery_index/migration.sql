-- #151: Discovery Index をサーバー側で持つための土台
--
-- 現在ドキュメント一覧は Yjs の共有目次（rootYDoc.meta.pages）から作られており、
-- 権限外ページのタイトルも全メンバーに同期される。
-- 「1つの共有目次を人ごとに加工して配る」は CRDT 上成立しない（試作で実証）ため、
-- Discovery Metadata の source of truth をサーバーへ移す。
-- docs/doc-permission.md「Discovery Index Local Cache」を参照。

-- doc → タグID の対応。タグの定義（名前・色）は権限に関係しないため対象外。
-- 既定は空配列。NULL を許すと「タグ未設定」と「タグ無し」の区別が要るため許さない。
ALTER TABLE doc_meta ADD COLUMN tag_ids TEXT[] NOT NULL DEFAULT '{}';

-- Discovery Index の版数。クライアントのキャッシュが古いことを検出する。
--
-- ⚠️ 権限変更だけでなく、Index の内容（作成・削除・改名・タグ）が
--    変わったときも上げること。上げないと「権限は正しいのに一覧が古い」状態になる。
ALTER TABLE workspaces ADD COLUMN discovery_revision BIGINT NOT NULL DEFAULT 0;

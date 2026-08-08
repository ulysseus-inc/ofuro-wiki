-- #97: doc_meta.default_role を「未設定」と表せるようにする
--
-- ⚠️ これまで既定値 'reader' が入っており、**doc を作った瞬間に
-- 「ドキュメントの設定がある」状態**になっていた。
-- docs/doc-permission.md 4.2 の②はドキュメントの設定を
-- ワークスペースのロールより優先するため、
-- **所有者を含む全員が Reader に降格し、自分の doc を編集できなくなる。**
--
-- 既存の値はすべて DB 既定値であり（設定する手段が無かった）、
-- 情報を持たない。NULL（未設定）へ寄せる。

ALTER TABLE doc_meta ALTER COLUMN default_role DROP DEFAULT;
ALTER TABLE doc_meta ALTER COLUMN default_role DROP NOT NULL;

UPDATE doc_meta SET default_role = NULL WHERE default_role = 'reader';

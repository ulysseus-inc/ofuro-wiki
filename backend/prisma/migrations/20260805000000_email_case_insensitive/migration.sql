-- #120: メールアドレスの大文字小文字を区別しないようにする。
--
-- 事象: users.email は @unique だが Postgres の比較は大文字小文字を区別するため、
-- tanaka@example.com と Tanaka@example.com が別アカウントとして共存できた。
-- 実際のメール運用では同一視されるため、利用者の認識とずれる。
--
-- 特に AUTH_SIGNIN_AUTOCREATE が有効な環境では実害が大きい。
-- 打ち間違いで大文字にしただけで**別アカウントが黙って作られ**、
-- 利用者からは「ログインできたのに自分の文書が全部消えた」ように見える。
--
-- ⚠️ アプリ側の正規化だけでは足りない。メールアドレスの入口は
-- サインアップ・サインイン・Admin作成・CSV・招待・OIDC と6つ以上あり、
-- **1つ足し忘れれば穴が残る**。DB の型で強制すれば、経路によらず保証される。
CREATE EXTENSION IF NOT EXISTS citext;

-- ⚠️ 型変更の前に衝突を検出する。
-- 大文字小文字だけが違うアカウントが既にあると、citext 化した時点で
-- 一意制約に違反して失敗する。そのままだと Postgres の
-- 「duplicate key value violates unique constraint」しか出ず、
-- **どのアドレスが原因か分からないまま起動できなくなる**。
--
-- ⚠️ 集約はサブクエリの外側で行うこと。
-- `GROUP BY ... HAVING` を直接 `SELECT INTO` に渡すと**グループごとに1行返る**が、
-- plpgsql の（STRICT でない）`SELECT INTO` は**先頭行だけ採って残りを黙って捨てる**。
-- 衝突が3件あっても1件しか出ず、直して再実行を繰り返す羽目になる。
-- 「分かる形で止める」ためには、**全件を一度に出す**必要がある。
DO $$
DECLARE
  conflicts text;
BEGIN
  SELECT string_agg(dup.email, ', ' ORDER BY dup.email)
    INTO conflicts
    FROM (
      SELECT lower(email) AS email
        FROM users
       GROUP BY lower(email)
      HAVING count(*) > 1
    ) AS dup;

  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION
      '大文字小文字だけが違うアカウントが存在するため移行できません: %  '
      '/ どちらを残すか決めて、不要な方を削除または改名してから再実行してください',
      conflicts;
  END IF;
END $$;

-- 保存値も小文字に揃える（citext は比較を揃えるだけで、保存値は入力どおりのため）。
UPDATE users SET email = lower(email) WHERE email <> lower(email);
UPDATE invitations SET email = lower(email) WHERE email <> lower(email);

-- 一意制約と = 比較を、大文字小文字を区別しないものにする。
ALTER TABLE "users" ALTER COLUMN "email" TYPE citext;

-- 招待の宛先。#148 で「招待された本人か」を照合するため、同じ扱いに揃える。
-- ここが text のままだと、照合が経路によって変わりうる。
ALTER TABLE "invitations" ALTER COLUMN "email" TYPE citext;

-- ⚠️ audit_logs.actor_email は**あえて変更しない**。
-- 監査ログは「入力された値そのもの」を残す証跡であり、
-- 正規化すると「攻撃者が何を打ったか」が失われる。

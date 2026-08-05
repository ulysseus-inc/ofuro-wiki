import * as fs from 'fs';
import * as path from 'path';
import { normalizeEmail } from '../../src/common/email.util';

/**
 * #120: メールアドレスの大文字小文字を区別しないことを固定する。
 *
 * ⚠️ **保証しているのは DB の型（citext）であって、アプリ側の正規化ではない。**
 *
 * メールアドレスの入口はサインアップ・サインイン・Admin作成・CSV・招待・OIDC と
 * 6つ以上ある。**アプリ側で揃える方式は、1つ足し忘れれば穴が残る。**
 * 実際、同じ種類の取りこぼしを短期間に3回踏んでいる
 * （#145 `signInOrSignUp` / #146 compose / #147 サインアップの記録）。
 *
 * そのため schema で citext を宣言している。**ここを VarChar に戻すと本テストが落ちる。**
 */
describe('メールアドレスの大文字小文字 (#120)', () => {
  const schema = fs.readFileSync(
    path.join(__dirname, '../../prisma/schema.prisma'),
    'utf-8',
  );

  /** モデルのブロックを取り出す。 */
  const modelOf = (name: string): string => {
    const start = schema.indexOf(`model ${name} {`);
    expect(start).toBeGreaterThan(-1);
    return schema.slice(start, schema.indexOf('\n}', start));
  };

  describe('DB の型で強制している', () => {
    it('users.email は citext', () => {
      const line = modelOf('User')
        .split('\n')
        .find((l) => /^\s+email\s/.test(l));
      expect(line).toContain('@db.Citext');
      // 一意制約が無いと、そもそも重複を防げない
      expect(line).toContain('@unique');
    });

    // #148: 招待の宛先を照合するため、users.email と同じ扱いに揃える
    it('invitations.email は citext', () => {
      const line = modelOf('Invitation')
        .split('\n')
        .find((l) => /^\s+email\s/.test(l));
      expect(line).toContain('@db.Citext');
    });

    /**
     * ⚠️ 監査ログは**あえて citext にしない。**
     * 「入力された値そのもの」を残す証跡であり、正規化すると
     * **攻撃者が何を打ったかが失われる**。
     */
    it('audit_logs.actor_email は正規化しない（証跡のため）', () => {
      const line = modelOf('AuditLog')
        .split('\n')
        .find((l) => /^\s+actorEmail\s/.test(l));
      expect(line).toContain('@db.VarChar(255)');
      expect(line).not.toContain('Citext');
    });
  });

  describe('マイグレーション', () => {
    const migration = fs.readFileSync(
      path.join(
        __dirname,
        '../../prisma/migrations/20260805000000_email_case_insensitive/migration.sql',
      ),
      'utf-8',
    );

    it('citext 拡張を作る', () => {
      expect(migration).toContain('CREATE EXTENSION IF NOT EXISTS citext');
    });

    /**
     * ⚠️ 大文字小文字だけが違うアカウントが既にあると、citext 化した時点で
     * 一意制約に違反する。事前に検出しないと、Postgres の
     * 「duplicate key value violates unique constraint」しか出ず、
     * **どのアドレスが原因か分からないまま起動できなくなる。**
     */
    it('移行前に衝突を検出して、原因が分かる形で止める', () => {
      expect(migration).toContain('RAISE EXCEPTION');
      // どのアドレスが衝突しているかを出す
      expect(migration).toMatch(/lower\(email\)/);
      expect(migration).toContain('HAVING count(*) > 1');
    });

    /**
     * ⚠️ **衝突が複数あっても一度に全部出すこと。**
     *
     * `GROUP BY ... HAVING` を直接 `SELECT INTO` に渡すと**グループごとに1行返る**が、
     * plpgsql の（STRICT でない）`SELECT INTO` は**先頭行だけ採って残りを黙って捨てる**。
     * 衝突が3件あっても1件しか出ず、直して再実行を繰り返す羽目になる。
     *
     * 実際にそう書いており、**衝突1件でしか検証していなかったため気づけなかった**
     * （レビューで指摘されて発覚）。集約はサブクエリの外側で行う。
     */
    it('衝突が複数あっても一度に全部出す', () => {
      // HAVING を含むサブクエリを、外側で string_agg している形であること
      const guard = migration.slice(
        migration.indexOf('DO $$'),
        migration.indexOf('END $$'),
      );
      expect(guard).toMatch(/string_agg\([^)]*\)[\s\S]*FROM\s*\(/);
      expect(guard).toMatch(/HAVING count\(\*\) > 1[\s\S]*\)\s*AS\s+dup/);
    });

    it('既存の保存値も小文字に揃える', () => {
      expect(migration).toContain('UPDATE users SET email = lower(email)');
    });
  });

  describe('normalizeEmail', () => {
    it('小文字に揃える', () => {
      expect(normalizeEmail('Tanaka@Example.COM')).toBe('tanaka@example.com');
    });

    it('前後の空白を落とす', () => {
      expect(normalizeEmail('  user@example.com  ')).toBe('user@example.com');
    });

    it('すでに正規形ならそのまま', () => {
      expect(normalizeEmail('user@example.com')).toBe('user@example.com');
    });
  });
});

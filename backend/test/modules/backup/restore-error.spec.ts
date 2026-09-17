import * as fs from 'fs';
import * as path from 'path';
import { isIgnorableRestoreError } from '../../../src/modules/backup/scheduled-backup.service';

/**
 * `pg_restore` の失敗のうち、どれを「復元成功」とみなすか。
 *
 * ⚠️ **データ本体が入らなかった場合は必ず失敗にすること。**
 * 「復元できていないのに成功と報告する」ほうが、逆より危険である
 * （障害対応中に、退路が無いことに気づけない）。
 *
 * ## ⚠️ 実出力で検査すること
 *
 * 二度誤り、**どちらもテストは緑だった。**
 * 二度目を見逃したのは、テストのヘルパーが**出力形式を捏造していた**ため
 * （エラーブロックの間に人工的な空行を入れていた）。
 *
 * `fixtures/` の実出力は、本物の `pg_restore` から採取したもの。
 * **手で組み立てた文字列を主役にしないこと。**
 */
describe('復元エラーの判定', () => {
  const fixture = (name: string) =>
    fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8');

  describe('⚠️ 実出力（本物の pg_restore から採取）', () => {
    /**
     * 索引の作成だけが失敗した場合。データ本体は入っている。
     */
    it('索引の作成だけが失敗 → 無視してよい', () => {
      expect(isIgnorableRestoreError(fixture('pg-restore-index-only.txt'))).toBe(
        true,
      );
    });

    /**
     * ⚠️ **これが見逃していたもの。**
     *
     * `COPY failed` には `Command was:` が付かない。`Command was:` ブロック
     * だけを見る実装では、**データが入っていないのに「成功」**になっていた。
     */
    it('COPY(データ投入)の失敗を含む → 失敗として扱う', () => {
      const real = fixture('pg-restore-multi-error.txt');
      // 実出力に COPY 失敗が含まれていること（資料が正しいことの確認）
      expect(real).toContain('COPY failed for table');
      // ⚠️ COPY 失敗には Command was: が無い、という前提の確認
      const copyBlock = real
        .split(/^pg_restore: error:/m)
        .find((b) => b.includes('COPY failed'));
      expect(copyBlock).toBeDefined();
      expect(copyBlock).not.toContain('Command was:');

      expect(isIgnorableRestoreError(real)).toBe(false);
    });
  });

  describe('組み合わせ', () => {
    /** 実出力から「索引の失敗」だけを取り出して組み合わせる。 */
    const indexFailure = fixture('pg-restore-index-only.txt')
      .split(/^pg_restore: warning:/m)[0]
      .trim();
    const copyFailure = fixture('pg-restore-multi-error.txt')
      .split(/^pg_restore: error:/m)
      .find((b) => b.includes('COPY failed'))!;

    it('⚠️ 索引の失敗に COPY の失敗が1つでも混ざれば失敗', () => {
      const mixed = `${indexFailure}\npg_restore: error:${copyFailure}\npg_restore: warning: errors ignored on restore: 3\n`;
      expect(isIgnorableRestoreError(mixed)).toBe(false);
    });
  });

  describe('⚠️ 失敗として扱うもの', () => {
    const withCommand = (sql: string) =>
      `pg_restore: error: could not execute query: ERROR:  x\nCommand was: ${sql}\n\n\npg_restore: warning: errors ignored on restore: 1\n`;

    it.each([
      ['データ投入(COPY)', 'COPY public.doc_snapshots (workspace_id) FROM stdin;'],
      ['行の挿入', "INSERT INTO public.users VALUES ('...');"],
      ['テーブル作成', 'CREATE TABLE public.workspaces (id uuid NOT NULL);'],
      ['スキーマ作成', 'CREATE SCHEMA public;'],
      ['シーケンス', 'CREATE SEQUENCE public.doc_updates_id_seq;'],
      ['拡張', 'CREATE EXTENSION IF NOT EXISTS pgroonga;'],
    ])('%s の失敗は成功にしない', (_name, sql) => {
      expect(isIgnorableRestoreError(withCommand(sql))).toBe(false);
    });

    it.each([
      ['接続できない', 'pg_restore: error: could not connect to database'],
      ['認証失敗', 'pg_restore: error: authentication failed for user "ofuro"'],
      ['空', ''],
      ['無関係な出力', 'pg_restore: processing data for table "users"'],
      [
        '「無視した」とだけあり、失敗内容が読み取れない',
        'pg_restore: warning: errors ignored on restore: 3\n',
      ],
    ])('%s は失敗のまま', (_name, stderr) => {
      expect(isIgnorableRestoreError(stderr)).toBe(false);
    });
  });

  describe('無視してよいもの', () => {
    const withCommand = (sql: string) =>
      `pg_restore: error: could not execute query: ERROR:  x\nCommand was: ${sql}\n\n\npg_restore: warning: errors ignored on restore: 1\n`;

    it.each([
      ['一意索引', 'CREATE UNIQUE INDEX users_email_key ON public.users (email);'],
      [
        '制約',
        'ALTER TABLE ONLY public.docs\n    ADD CONSTRAINT docs_pkey PRIMARY KEY (id);',
      ],
      ['トリガ', 'CREATE TRIGGER t BEFORE UPDATE ON public.docs FOR EACH ROW EXECUTE FUNCTION f();'],
      ['コメント', "COMMENT ON TABLE public.docs IS 'ドキュメント';"],
      [
        'ivfflat（開発環境で実際に出たもの）',
        "CREATE INDEX rag_embeddings_embedding_idx ON enigma.rag_embeddings USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='100');",
      ],
    ])('%s の失敗は無視してよい', (_name, sql) => {
      expect(isIgnorableRestoreError(withCommand(sql))).toBe(true);
    });
  });

  describe('実装の健全性', () => {
    const source = () =>
      fs.readFileSync(
        path.join(__dirname, '../../../src/modules/backup/scheduled-backup.service.ts'),
        'utf-8',
      );

    it('無視した内容をログに残している', () => {
      const s = source();
      const start = s.indexOf('isIgnorableRestoreError(stderr)) throw err');
      expect(s.slice(start, start + 600)).toContain('this.logger.warn');
    });

    /** ⚠️ 許可リストに危険なものが後から足されていないこと。 */
    it('許可リストにデータ投入系が入っていない', () => {
      const m = /const IGNORABLE_COMMAND =\s*([\s\S]*?);/.exec(source());
      expect(m).not.toBeNull();
      for (const dangerous of ['COPY', 'INSERT', 'CREATE\\s+TABLE', 'CREATE\\s+SCHEMA']) {
        expect(m![1]).not.toContain(dangerous);
      }
    });
  });
});

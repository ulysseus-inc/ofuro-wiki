import { pgDumpArgs } from '../../../src/modules/backup/scheduled-backup.service';

/**
 * #212: **バックアップの一覧（backup_records）はダンプに入れない。**
 *
 * ⚠️ 入れると、復元で一覧が取得時点に巻き戻る。
 * - 同期のころ: 使ったバックアップの記録が消え、ZIP だけが残った（開発環境で18個中16個が迷子）
 * - 非同期にしてから: running の自分の記録がダンプに入り、復元で running に戻って消せなくなった
 *
 * 一覧はディスク上の ZIP の目録であり、業務データではない。docs/backup.md 3b章
 */
describe('pg_dump の引数（#212）', () => {
  const args = pgDumpArgs('/tmp/db.dump', 'postgresql://u@h/db');

  test('⚠️ backup_records を表ごと除外する（データだけでなく表そのもの）', () => {
    // --exclude-table-data では表の定義がダンプに残り、pg_restore --clean が
    // 表を作り直して一覧が空になる。表ごと外すこと
    expect(args).toContain('--exclude-table=public.backup_records');
    expect(args.some((a) => a.startsWith('--exclude-table-data'))).toBe(false);
  });

  test('custom 形式で、指定したファイルに書き出す', () => {
    expect(args).toContain('--format=custom');
    expect(args[args.indexOf('--file') + 1]).toBe('/tmp/db.dump');
  });

  test('接続先は最後に置く（pg_dump の位置引数）', () => {
    expect(args[args.length - 1]).toBe('postgresql://u@h/db');
  });
});

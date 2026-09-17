import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * #101: ⚠️ **許可リスト（FIELD_TO_COLUMN）と実テーブルのずれを検知する。**
 *
 * この表は SQL インジェクション対策の許可リストを兼ねているため、
 * **存在しない列名が載っていても起動時には落ちない**。実際に問い合わせが来て
 * 初めて `42703 column ... does not exist` になる。
 * バックリンクは毎回 500 で失敗していた（docs/search-index.md）。
 */
const ROOT = join(__dirname, '../../..');

function allowedColumns(): string[] {
  const src = readFileSync(
    join(ROOT, 'src/modules/search/search.service.ts'),
    'utf-8'
  );
  const block = src.slice(
    src.indexOf('const FIELD_TO_COLUMN'),
    src.indexOf('function col(')
  );
  return [...block.matchAll(/:\s*'([a-z_]+)'/g)].map(m => m[1]);
}

function searchIndexColumns(): string[] {
  const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf-8');
  const model = schema.slice(
    schema.indexOf('model SearchIndex'),
    schema.indexOf('@@map("search_index")')
  );
  const columns: string[] = [];
  for (const line of model.split('\n')) {
    const mapped = /@map\("([a-z_]+)"\)/.exec(line);
    if (mapped) {
      columns.push(mapped[1]);
      continue;
    }
    // @map が無い項目は、名前がそのまま列名になる（title / content など）
    const plain = /^\s{2}([a-zA-Z]+)\s+\S+/.exec(line);
    if (plain) columns.push(plain[1]);
  }
  return columns;
}

describe('検索の許可リストと実テーブル（#101）', () => {
  it('⚠️ 許可リストの列は、すべて search_index に存在する', () => {
    const missing = [...new Set(allowedColumns())].filter(
      c => !searchIndexColumns().includes(c)
    );
    expect(missing).toEqual([]);
  });

  it('許可リストを読めている（解析が壊れていない）', () => {
    expect(allowedColumns().length).toBeGreaterThan(8);
    expect(searchIndexColumns()).toContain('doc_id');
  });
});

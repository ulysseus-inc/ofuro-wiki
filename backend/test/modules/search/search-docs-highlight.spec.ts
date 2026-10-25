import { SearchService } from '../../../src/modules/search/search.service';

/**
 * #265: `searchDocs` の抜粋は GraphQL では String。
 *
 * ⚠️ `pgroonga_snippet_html` は **text[]** を返す（実 DB で `pg_typeof` を確認）。
 * そのまま渡すと GraphQL が `String cannot represent value: [...]` で落ち、
 * **ヒットした検索ほど必ず失敗する**（0件のときだけ成功して見える）。
 */
type Hit = { highlight: string };

describe('searchDocs の抜粋（#265）', () => {
  function serviceReturning(rows: unknown[]): SearchService {
    const permission = {
      readableDocFilter: jest.fn().mockResolvedValue({
        join: '',
        sql: 'TRUE',
        params: [],
      }),
    };
    const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue(rows) };
    return new SearchService(permission as never, prisma as never);
  }

  const row = (highlight: unknown) => ({
    doc_id: 'd1',
    title: '題',
    block_id: 'b1',
    highlight,
    created_at: new Date('2026-10-14T00:00:00Z'),
    updated_at: new Date('2026-10-14T00:00:00Z'),
  });

  it('⚠️ DB が返す配列を1つの文字列にする', async () => {
    const hits = (await serviceReturning([
      row([
        '<span class="keyword">見出し</span>2',
        '別の<span class="keyword">見出し</span>',
      ]),
    ]).searchDocsKeyword('ws', '見出し', 10, 'u1')) as Hit[];

    expect(typeof hits[0].highlight).toBe('string');
    expect(hits[0].highlight).toContain('<span class="keyword">見出し</span>2');
    expect(hits[0].highlight).toContain(
      '別の<span class="keyword">見出し</span>',
    );
  });

  it('抜粋が無ければ空文字', async () => {
    const hits = (await serviceReturning([row(null)]).searchDocsKeyword(
      'ws',
      '見出し',
      10,
      'u1',
    )) as Hit[];
    expect(hits[0].highlight).toBe('');
  });
});

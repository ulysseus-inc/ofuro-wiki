import { DocMetaAuditService } from '../../../src/modules/discovery/doc-meta-audit.service';
import type { IndexReaderService } from '../../../src/modules/discovery/index-reader.service';
import type { PrismaService } from '../../../src/prisma.service';

/**
 * #151: 目次と台帳の一致検査。
 *
 * ⚠️ **通ることより、壊れたときに落ちることが大事。**
 * 検出しない検査は「一致している」という誤った確信を与えるだけで、
 * 無いより悪い。
 */
describe('目次と doc_meta の一致検査', () => {
  const makeService = (opts: {
    pages: Array<{
      id: string;
      title?: string | null;
      tags?: string[];
      trash?: boolean;
    }> | null;
    metas?: Array<Record<string, unknown>>;
  }) => {
    const prisma = {
      docMeta: { findMany: jest.fn().mockResolvedValue(opts.metas ?? []) },
      workspace: {
        findMany: jest.fn().mockResolvedValue([{ id: 'ws-1', name: 'W' }]),
      },
    };
    const sync = {
      readIndex: jest.fn().mockResolvedValue(
        opts.pages === null
          ? null
          : opts.pages.map((p) => ({
              id: p.id,
              title: p.title === undefined ? 'あ' : p.title,
              tags: p.tags ?? [],
              trash: p.trash ?? false,
              createdAt: null,
              updatedAt: null,
            })),
      ),
    };
    return new DocMetaAuditService(
      prisma as unknown as PrismaService,
      sync as unknown as IndexReaderService,
    );
  };

  const meta = (o: Partial<Record<string, unknown>> & { docId: string }) => ({
    title: 'あ',
    tagIds: [],
    trash: false,
    ...o,
  });

  const WS = 'ws-1';

  it('一致していれば異常なし', async () => {
    const r = await makeService({
      pages: [{ id: 'a' }, { id: 'b' }],
      metas: [meta({ docId: 'a' }), meta({ docId: 'b' })],
    }).auditWorkspace(WS);

    expect(r.missing).toEqual([]);
    expect(r.mismatched).toEqual([]);
    expect(r.indexed).toBe(2);
  });

  it('⚠️ 目次にあって台帳に無いものを検出する（一覧から消える）', async () => {
    const r = await makeService({
      pages: [{ id: 'a' }, { id: 'きえた' }],
      metas: [meta({ docId: 'a' })],
    }).auditWorkspace(WS);

    expect(r.missing).toEqual(['きえた']);
  });

  it('⚠️ ゴミ箱の食い違いを検出する（ゴミ箱のページが一覧に出る）', async () => {
    const r = await makeService({
      pages: [{ id: 'a', trash: true }],
      metas: [meta({ docId: 'a', trash: false })],
    }).auditWorkspace(WS);

    expect(r.mismatched).toHaveLength(1);
    expect(r.mismatched[0].reasons.join()).toContain('ゴミ箱');
  });

  it('題の食い違いを検出する', async () => {
    const r = await makeService({
      pages: [{ id: 'a', title: '新' }],
      metas: [meta({ docId: 'a', title: '旧' })],
    }).auditWorkspace(WS);

    expect(r.mismatched[0].reasons.join()).toContain('題');
  });

  it('タグの食い違いを検出する', async () => {
    const r = await makeService({
      pages: [{ id: 'a', tags: ['t1'] }],
      metas: [meta({ docId: 'a', tagIds: [] })],
    }).auditWorkspace(WS);

    expect(r.mismatched[0].reasons.join()).toContain('タグ');
  });

  it('目次に題が無いものを異常と呼ばない（同期が書かないと決めた値）', async () => {
    const r = await makeService({
      pages: [{ id: 'a', title: null }],
      metas: [meta({ docId: 'a', title: '台帳の題' })],
    }).auditWorkspace(WS);

    expect(r.mismatched).toEqual([]);
  });

  it('台帳にしか無いものは異常に数えない（内部API 由来。消さない設計）', async () => {
    const r = await makeService({
      pages: [{ id: 'a' }],
      metas: [meta({ docId: 'a' }), meta({ docId: '台帳のみ' })],
    }).auditWorkspace(WS);

    expect(r.extra).toBe(1);
    expect(r.missing).toEqual([]);
    expect(r.mismatched).toEqual([]);
  });

  it('目次が無いワークスペースは未同期として扱う', async () => {
    const r = await makeService({ pages: null }).auditWorkspace(WS);

    expect(r.noIndex).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it('全体集計が各ワークスペースの合計になる', async () => {
    const svc = makeService({
      pages: [{ id: 'a' }, { id: 'きえた' }],
      metas: [meta({ docId: 'a', title: '旧' }), meta({ docId: '台帳のみ' })],
    });

    const all = await svc.auditAll();
    expect(all.indexed).toBe(2);
    expect(all.missing).toBe(1);
    expect(all.mismatched).toBe(1);
    expect(all.extra).toBe(1);
  });

  it('同期と同じ読み取り経路を使う（別々に書くと片方だけ壊れる）', async () => {
    const readIndex = jest.fn().mockResolvedValue([]);
    const svc = new DocMetaAuditService(
      {
        docMeta: { findMany: jest.fn().mockResolvedValue([]) },
      } as unknown as PrismaService,
      { readIndex } as unknown as IndexReaderService,
    );

    await svc.auditWorkspace(WS);
    expect(readIndex).toHaveBeenCalledWith(WS);
  });
});

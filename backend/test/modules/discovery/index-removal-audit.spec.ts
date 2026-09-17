import { IndexRemovalAuditService } from '../../../src/modules/discovery/index-removal-audit.service';
import type { PrismaService } from '../../../src/prisma.service';

/**
 * #151 段階3 PR5-b: **共有目次を消してよいかの判定。**
 *
 * ⚠️ 問うているのは「一致しているか」ではなく
 * **「消したときに失われる情報があるか」**。
 *
 * 段階3 では台帳のほうが新しいのが**正常**なので、
 * 「不一致 0 件」を条件にすると**永久に掃除できない**。
 */
describe('共有目次を消してよいかの判定', () => {
  const WS = 'ws-1';

  const makeService = (opts: {
    pages: Array<{
      id: string;
      title: string | null;
      tags: string[];
      trash: boolean;
    }> | null;
    metas: Array<Record<string, unknown>>;
    /** 点検中に目次が動いた状況を作る */
    pagesAfter?: Array<{
      id: string;
      title: string | null;
      tags: string[];
      trash: boolean;
    }> | null;
  }) => {
    const prisma = {
      docMeta: { findMany: jest.fn().mockResolvedValue(opts.metas) },
      workspace: {
        findMany: jest.fn().mockResolvedValue([{ id: WS, name: 'テスト' }]),
      },
    };
    // ⚠️ 点検は目次を2回読む（前後で変化を見るため）。
    // `pagesAfter` を渡すと2回目だけ別の内容を返す
    const readIndex = jest.fn().mockResolvedValue(opts.pages);
    if (opts.pagesAfter !== undefined) {
      readIndex
        .mockResolvedValueOnce(opts.pages)
        .mockResolvedValueOnce(opts.pagesAfter);
    }
    const sync = { readIndex };
    return new IndexRemovalAuditService(
      prisma as unknown as PrismaService,
      sync as never,
    );
  };

  const meta = (over: Record<string, unknown> = {}) => ({
    docId: 'd1',
    title: '題',
    tagIds: ['t1'],
    trash: false,
    titleRevision: 0n,
    trashRevision: 0n,
    tagsRevision: 0n,
    ...over,
  });

  const page = (over: Record<string, unknown> = {}) => ({
    id: 'd1',
    title: '題',
    tags: ['t1'],
    trash: false,
    ...over,
  });

  test('一致していれば、消してよい', async () => {
    const service = makeService({ pages: [page()], metas: [meta()] });

    const r = await service.auditWorkspace(WS);

    expect(r.unrecoverable).toEqual([]);
    expect(r.indexAuthoritative).toEqual([]);
    expect(r.safeStale).toBe(0);
  });

  /**
   * ⚠️ **これが最も重い。** 台帳に行が無いページの題は、
   * 目次を消したら**復元手段が無い**。
   */
  describe('復元不能', () => {
    test('⚠️ 目次にあって台帳に無いページを検出する', async () => {
      const service = makeService({
        pages: [page({ id: 'orphan', title: '失われる題' })],
        metas: [],
      });

      const r = await service.auditWorkspace(WS);

      expect(r.unrecoverable).toHaveLength(1);
      expect(r.unrecoverable[0]).toMatchObject({
        docId: 'orphan',
        title: '失われる題',
      });
    });
  });

  /**
   * ⚠️ 版数 0 は「台帳がまだ所有していない＝**目次が正**」という意味
   * （7.7.2 の移行判定）。この状態で消すと、目次側の値が失われる。
   */
  describe('目次が正（版数 0）', () => {
    test('⚠️ 題が食い違い、版数が 0 なら危険とする', async () => {
      const service = makeService({
        pages: [page({ title: '目次の題' })],
        metas: [meta({ title: '台帳の題', titleRevision: 0n })],
      });

      const r = await service.auditWorkspace(WS);

      expect(r.indexAuthoritative).toHaveLength(1);
      expect(r.indexAuthoritative[0].reasons[0]).toContain('題');
      expect(r.safeStale).toBe(0);
    });

    test('⚠️ ゴミ箱が食い違い、版数が 0 なら危険とする', async () => {
      const service = makeService({
        pages: [page({ trash: true })],
        metas: [meta({ trash: false, trashRevision: 0n })],
      });

      const r = await service.auditWorkspace(WS);

      expect(r.indexAuthoritative).toHaveLength(1);
      expect(r.indexAuthoritative[0].reasons[0]).toContain('ゴミ箱');
    });

    test('⚠️ タグが食い違い、版数が 0 なら危険とする', async () => {
      const service = makeService({
        pages: [page({ tags: ['t1', 't2'] })],
        metas: [meta({ tagIds: ['t1'], tagsRevision: 0n })],
      });

      const r = await service.auditWorkspace(WS);

      expect(r.indexAuthoritative).toHaveLength(1);
      expect(r.indexAuthoritative[0].reasons[0]).toContain('タグ');
    });
  });

  /**
   * ⚠️ **ここを危険と呼ばないこと。** 段階3 が動いていれば台帳のほうが
   * 新しくなるのが正常で、危険と呼ぶと**永久に掃除できない**。
   */
  describe('台帳が所有済み（版数 1 以上）', () => {
    test('⚠️ 題が食い違っても、版数があれば消してよい', async () => {
      const service = makeService({
        pages: [page({ title: '古い目次の題' })],
        metas: [meta({ title: '新しい台帳の題', titleRevision: 5n })],
      });

      const r = await service.auditWorkspace(WS);

      expect(r.indexAuthoritative).toEqual([]);
      expect(r.unrecoverable).toEqual([]);
      expect(r.safeStale).toBe(1);
    });

    test('ゴミ箱・タグも同じ', async () => {
      const service = makeService({
        pages: [page({ trash: true, tags: [] })],
        metas: [
          meta({
            trash: false,
            trashRevision: 3n,
            tagIds: ['t1'],
            tagsRevision: 2n,
          }),
        ],
      });

      const r = await service.auditWorkspace(WS);

      expect(r.indexAuthoritative).toEqual([]);
      expect(r.safeStale).toBe(1);
    });
  });

  /**
   * ⚠️ **並び順で比べないこと。** タグに順序の意味は無く、台帳（配列カラム）と
   * 目次（Y.Array）で並びが揃う保証も無い。順序で比べると、中身が同じでも
   * 「食い違い」と数えてしまい、版数 0 のページが★危険に計上されて
   * **掃除に永久に進めなくなる**。
   */
  describe('タグの比較', () => {
    test('⚠️ 並び順が違っても、中身が同じなら食い違いとみなさない', async () => {
      const service = makeService({
        pages: [page({ tags: ['t2', 't1'] })],
        metas: [meta({ tagIds: ['t1', 't2'], tagsRevision: 0n })],
      });

      const r = await service.auditWorkspace(WS);

      expect(r.indexAuthoritative).toEqual([]);
      expect(r.safeStale).toBe(0);
    });

    test('中身が違えば、きちんと食い違いとする', async () => {
      const service = makeService({
        pages: [page({ tags: ['t2', 't3'] })],
        metas: [meta({ tagIds: ['t1', 't2'], tagsRevision: 0n })],
      });

      const r = await service.auditWorkspace(WS);

      expect(r.indexAuthoritative).toHaveLength(1);
    });

    test('件数が違えば食い違いとする', async () => {
      const service = makeService({
        pages: [page({ tags: ['t1'] })],
        metas: [meta({ tagIds: ['t1', 't2'], tagsRevision: 0n })],
      });

      const r = await service.auditWorkspace(WS);

      expect(r.indexAuthoritative).toHaveLength(1);
    });
  });

  /**
   * ⚠️ 目次に題が無いときは同期が書かない。**書かない値を異常と呼ばない**
   * （既存の `DocMetaAuditService` と揃える）。
   */
  test('⚠️ 目次に題が無い場合は、食い違いとみなさない', async () => {
    const service = makeService({
      pages: [page({ title: null })],
      metas: [meta({ title: '台帳の題', titleRevision: 0n })],
    });

    const r = await service.auditWorkspace(WS);

    expect(r.indexAuthoritative).toEqual([]);
  });

  test('台帳にしか無いページは、消しても影響しない', async () => {
    const service = makeService({
      pages: [page()],
      metas: [meta(), meta({ docId: 'ledger-only' })],
    });

    const r = await service.auditWorkspace(WS);

    expect(r.unrecoverable).toEqual([]);
    expect(r.indexAuthoritative).toEqual([]);
  });

  test('目次そのものが無ければ、掃除するものが無い', async () => {
    const service = makeService({ pages: null, metas: [meta()] });

    const r = await service.auditWorkspace(WS);

    expect(r.noIndex).toBe(true);
    expect(r.indexed).toBe(0);
  });

  describe('全体の集計', () => {
    test('危険の件数を合算する', async () => {
      const service = makeService({
        pages: [page({ id: 'orphan' }), page({ id: 'd1', title: '目次の題' })],
        metas: [meta({ docId: 'd1', title: '台帳の題', titleRevision: 0n })],
      });

      const report = await service.auditAll();

      expect(report.unrecoverable).toBe(1);
      expect(report.indexAuthoritative).toBe(1);
    });
  });

  /**
   * ⚠️ **判定は「その瞬間」のものでしかない。**
   * 目次と台帳は別の時点で読んでいるうえ、稼働中はいつでも目次が動く。
   *
   * ```
   * 目次を読む → （この間に別の利用者がページを追加）→ 台帳を読む
   *            ↓ 追加分は判定に入らない
   * 「安全」と答える → 掃除する → 追加されたページの題が失われる
   * ```
   */
  describe('点検中に目次が動いた場合', () => {
    test('⚠️ ページが増えていたら、見落としに気づける', async () => {
      const service = makeService({
        pages: [page()],
        metas: [meta()],
        pagesAfter: [page(), page({ id: 'あとから増えた' })],
      });

      const r = await service.auditWorkspace(WS);

      expect(r.changedDuringAudit).toBe(true);
    });

    /** ⚠️ 件数だけを見ると、**題の変更を見落とす** */
    test('⚠️ 件数が同じでも、題が変わっていれば気づける', async () => {
      const service = makeService({
        pages: [page({ title: '前の題' })],
        metas: [meta({ title: '前の題' })],
        pagesAfter: [page({ title: '後の題' })],
      });

      const r = await service.auditWorkspace(WS);

      expect(r.changedDuringAudit).toBe(true);
    });

    test('動いていなければ、そう答える', async () => {
      const service = makeService({
        pages: [page()],
        metas: [meta()],
        pagesAfter: [page()],
      });

      const r = await service.auditWorkspace(WS);

      expect(r.changedDuringAudit).toBe(false);
    });
  });
});

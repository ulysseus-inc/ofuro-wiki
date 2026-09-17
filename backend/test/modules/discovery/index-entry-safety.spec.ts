import { judgeIndexEntry } from '../../../src/modules/discovery/index-entry-safety';

/**
 * #151 段階3: **共有目次の項目を消してよいかの規則。**
 *
 * ⚠️ **規則を1か所に集めた理由。** 点検と掃除で別々に書いたところ
 * 食い違い、**点検は「安全」と言うのに掃除は 597 件中 595 件を
 * 消せない**という状態になった（2026-08-27・実データで発覚）。
 */
describe('目次の項目を消してよいかの規則', () => {
  const page = (over: Record<string, unknown> = {}) => ({
    id: 'd1',
    title: '題',
    tags: ['t1'],
    trash: false,
    ...over,
  });

  const meta = (over: Record<string, unknown> = {}) =>
    ({
      title: '題',
      tagIds: ['t1'],
      trash: false,
      titleRevision: 0n,
      trashRevision: 0n,
      tagsRevision: 0n,
      ...over,
    }) as never;

  test('一致していれば消してよい', () => {
    expect(judgeIndexEntry(page(), meta()).purgeable).toBe(true);
  });

  /**
   * ⚠️ **これが今回の落とし穴。**
   * `doc-meta-sync` は版数を上げずに値を写すため、
   * **移行しただけのページはすべて版数 0 のまま**である。
   * 「版数 1 以上」を条件にすると、誰かが編集するまで永久に掃除できない。
   */
  test('⚠️ 版数 0 でも、値が一致していれば消してよい', () => {
    const r = judgeIndexEntry(page(), meta({ titleRevision: 0n }));
    expect(r.purgeable).toBe(true);
  });

  test('⚠️ 台帳に行が無ければ消さない（復元手段が無い）', () => {
    const r = judgeIndexEntry(page(), undefined);
    expect(r).toMatchObject({ purgeable: false, reason: '台帳に行が無い' });
  });

  describe('値が食い違う場合', () => {
    test('⚠️ 版数 0 なら消さない（目次が正）', () => {
      const r = judgeIndexEntry(
        page({ title: '目次の題' }),
        meta({ title: '台帳の題', titleRevision: 0n }),
      );
      expect(r.purgeable).toBe(false);
      expect(r.reason).toContain('題');
    });

    test('版数が 1 以上なら消してよい（台帳が所有済み）', () => {
      const r = judgeIndexEntry(
        page({ title: '古い目次の題' }),
        meta({ title: '新しい台帳の題', titleRevision: 5n }),
      );
      expect(r.purgeable).toBe(true);
    });

    test('ゴミ箱でも同じ', () => {
      expect(
        judgeIndexEntry(page({ trash: true }), meta({ trashRevision: 0n }))
          .purgeable,
      ).toBe(false);
      expect(
        judgeIndexEntry(page({ trash: true }), meta({ trashRevision: 2n }))
          .purgeable,
      ).toBe(true);
    });

    test('タグでも同じ', () => {
      expect(
        judgeIndexEntry(page({ tags: ['t1', 't2'] }), meta({ tagsRevision: 0n }))
          .purgeable,
      ).toBe(false);
      expect(
        judgeIndexEntry(page({ tags: ['t1', 't2'] }), meta({ tagsRevision: 3n }))
          .purgeable,
      ).toBe(true);
    });
  });

  /** ⚠️ 並び順で比べると、中身が同じでも消せなくなる */
  test('⚠️ タグの並び順が違っても、食い違いとしない', () => {
    const r = judgeIndexEntry(
      page({ tags: ['t2', 't1'] }),
      meta({ tagIds: ['t1', 't2'], tagsRevision: 0n }),
    );
    expect(r.purgeable).toBe(true);
  });

  /** ⚠️ 目次に題が無いときは同期が書かない。書かない値を異常と呼ばない */
  test('⚠️ 目次に題が無い場合は、食い違いとしない', () => {
    const r = judgeIndexEntry(
      page({ title: null }),
      meta({ title: '台帳の題', titleRevision: 0n }),
    );
    expect(r.purgeable).toBe(true);
  });
});

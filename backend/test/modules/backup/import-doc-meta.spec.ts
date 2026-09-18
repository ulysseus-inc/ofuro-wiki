import { BackupService } from '../../../src/modules/backup/backup.service';

/**
 * #241: 取り込みが作る `doc_meta` の中身。
 *
 * ⚠️ **内部データに台帳の行を作らない。** ワークスペース自身の doc や
 * `db$...$docProperties` まで行を作っていたため、一覧に**「無題」が2つ**並んでいた
 * （2026-09-18 に利用者が発見。7月から本番のマニュアルにも出ていた）。
 *
 * ⚠️ **日時は書き出し元のものを引き継ぐ。** 取り込んだ時刻で埋めると、
 * 並び順（既定は更新日時の降順）が取り込みの実行順になり、章の順番が崩れる。
 */
describe('取り込みが作る台帳（#241）', () => {
  const WS = '11111111-1111-4111-8111-111111111111';

  const make = () => {
    const service = new BackupService({} as any, {} as any, {} as any);
    return service as any;
  };

  describe('内部データを除く', () => {
    test.each([
      ['ワークスペース自身の doc', WS],
      ['プロパティの内部データ', `db$${WS}$docProperties`],
    ])('⚠️ %s には台帳の行を作らない', (_name, docId) => {
      expect(make().shouldCreateDocMeta(WS, docId)).toBe(false);
    });

    test('ふつうのページには作る', () => {
      expect(make().shouldCreateDocMeta(WS, 'doc-1')).toBe(true);
    });
  });

  describe('日時の引き継ぎ', () => {
    test('⚠️ 書き出し元の日時をそのまま使う', () => {
      const meta = {
        createdAt: '2026-01-02T03:04:05.000Z',
        updatedAt: '2026-02-03T04:05:06.000Z',
      };
      expect(make().docTimestamps(meta)).toEqual({
        createdAt: new Date(meta.createdAt),
        updatedAt: new Date(meta.updatedAt),
      });
    });

    /**
     * ⚠️ **壊れた日時で取り込み全体を落とさない。** `new Date('壊れた値')` は
     * Invalid Date になり、そのまま渡すと Prisma が例外を投げる。
     * 古いバックアップや手で編集された zip でも、取り込みは通すべき
     * （レビュー指摘・2026-09-18）。
     */
    test.each([
      ['壊れた文字列', 'not-a-date'],
      ['空文字', ''],
      ['数値', 12345 as unknown as string],
    ])('⚠️ 日時が %s でも、いまの時刻にして取り込みを続ける', (_n, bad) => {
      const before = Date.now();
      const t = make().docTimestamps({ createdAt: bad, updatedAt: bad });
      expect(Number.isNaN(t.createdAt.getTime())).toBe(false);
      expect(Number.isNaN(t.updatedAt.getTime())).toBe(false);
      expect(t.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    /**
     * ⚠️ 空白だけの文字列は `new Date(' ')` が Invalid Date になるため、
     * いまの時刻に落ちる（2026-09-18 に Node で実測）。
     * 「1970年として通ってしまうのでは」という指摘があったため、
     * 実際の挙動をここに固定しておく。
     */
    test.each([[' '], ['  '], ['\t']])(
      '空白だけの日時（%j）も、いまの時刻にする',
      (blank) => {
        const before = Date.now();
        const t = make().docTimestamps({ createdAt: blank, updatedAt: blank });
        expect(t.createdAt.getTime()).toBeGreaterThanOrEqual(before);
      },
    );

    test('日時が無ければ、いまの時刻にする', () => {
      const before = Date.now();
      const t = make().docTimestamps(undefined);
      expect(t.createdAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(t.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
    });
  });
});

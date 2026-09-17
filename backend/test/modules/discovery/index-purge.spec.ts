import * as Y from 'yjs';
import { IndexPurgeService } from '../../../src/modules/discovery/index-purge.service';
import type { PrismaService } from '../../../src/prisma.service';

/**
 * #151 段階3 PR5-b: **共有目次から題を消す。**
 *
 * ⚠️ ここで守っているのは、**間違えると題が漏れ続けるか、
 * 逆に復元できない情報を失う**性質のもの。
 *
 * 詳細は docs/discovery-stage3-comparison.md 7.8
 */
describe('共有目次の掃除', () => {
  const WS = '11111111-1111-4111-8111-111111111111';

  /**
   * ⚠️ 中身のある**本物の更新**を作る。空の Buffer を渡すと Yjs が
   * 「Unexpected end of array」で落ちる（捏造した形では検査にならない）
   */
  const someUpdate = () => {
    const d = new Y.Doc();
    d.getMap('meta').set('touched', Date.now());
    return Buffer.from(Y.encodeStateAsUpdate(d));
  };

  /**
   * 題を含む目次を持つルート文書を作る。
   *
   * `spaceIds` を渡すと `spaces` にも docId を載せる（#151 PR5-c・7.9）。
   */
  const makeRootDoc = (
    pages: Array<{ id: string; title: string }>,
    spaceIds: string[] = [],
  ) => {
    const doc = new Y.Doc();
    const arr = new Y.Array();
    doc.getMap('meta').set('pages', arr);
    for (const p of pages) {
      const m = new Y.Map();
      m.set('id', p.id);
      m.set('title', p.title);
      arr.push([m]);
    }
    // ⚠️ 実物と同じく subdoc を入れる。文字列で代用すると、
    // subdoc 特有の書き出しを通らず検査にならない
    for (const id of spaceIds) {
      doc.getMap('spaces').set(id, new Y.Doc({ guid: id }));
    }
    return Buffer.from(Y.encodeStateAsUpdate(doc));
  };

  /** 掃除後のスナップショットから `spaces` の中身を読み出す */
  const readSpaces = (blob: Buffer | Uint8Array): string[] => {
    const d = new Y.Doc();
    Y.applyUpdate(d, new Uint8Array(blob));
    return [...d.getMap('spaces').keys()];
  };

  const makeService = (opts: {
    snapshotBlob?: Buffer | null;
    snapshotTimestamp?: Date;
    updates?: Array<{ id: bigint; blob: Buffer }>;
    metas?: Array<Record<string, unknown>>;
    /** トランザクション中に割り込む他者の書き込み */
    intrude?: () => void;
    /** ⚠️ 他者が先にスナップショットを作った（一意制約違反）状況を作る */
    createConflict?: boolean;
  }) => {
    const state = {
      snapshot:
        opts.snapshotBlob === null
          ? null
          : {
              blob: opts.snapshotBlob ?? makeRootDoc([]),
              timestamp: opts.snapshotTimestamp ?? new Date('2026-08-27T00:00:00Z'),
            },
      updates: opts.updates ?? [],
      histories: 3,
    };

    const tx = {
      docUpdate: {
        count: jest.fn().mockImplementation((args: any) => {
          opts.intrude?.();
          const gt = args?.where?.id?.gt;
          const n = state.updates.filter((u) =>
            gt === undefined ? true : u.id > gt,
          ).length;
          return Promise.resolve(n);
        }),
        deleteMany: jest.fn().mockImplementation((args: any) => {
          const lte = args?.where?.id?.lte;
          state.updates = state.updates.filter((u) =>
            lte === undefined ? false : u.id > lte,
          );
          return Promise.resolve({ count: 0 });
        }),
      },
      docSnapshot: {
        updateMany: jest.fn().mockImplementation((args: any) => {
          // ⚠️ 実際の CAS と同じく、版が一致したときだけ書ける
          if (
            !state.snapshot ||
            state.snapshot.timestamp.getTime() !==
              args.where.timestamp.getTime()
          ) {
            return Promise.resolve({ count: 0 });
          }
          state.snapshot = {
            blob: args.data.blob,
            timestamp: args.data.timestamp,
          };
          return Promise.resolve({ count: 1 });
        }),
        create: jest.fn().mockImplementation((args: any) => {
          if (opts.createConflict) {
            return Promise.reject(Object.assign(new Error('unique'), {
              code: 'P2002',
            }));
          }
          state.snapshot = {
            blob: args.data.blob,
            timestamp: args.data.timestamp,
          };
          return Promise.resolve({});
        }),
      },
      docHistory: {
        deleteMany: jest.fn().mockImplementation(() => {
          const count = state.histories;
          state.histories = 0;
          return Promise.resolve({ count });
        }),
      },
    };

    const prisma = {
      docSnapshot: {
        findUnique: jest.fn().mockImplementation(() =>
          Promise.resolve(state.snapshot),
        ),
      },
      docUpdate: {
        findMany: jest.fn().mockImplementation(() =>
          Promise.resolve([...state.updates]),
        ),
        count: jest.fn().mockImplementation(() =>
          Promise.resolve(state.updates.length),
        ),
      },
      docMeta: {
        findMany: jest.fn().mockResolvedValue(opts.metas ?? []),
      },
      docHistory: {
        count: jest.fn().mockImplementation(() =>
          Promise.resolve(state.histories),
        ),
      },
      $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
    };

    return {
      service: new IndexPurgeService(prisma as unknown as PrismaService),
      state,
      /** 掃除後のスナップショットに題が残っているか */
      snapshotContains: (s: string) =>
        state.snapshot
          ? Buffer.from(state.snapshot.blob).includes(Buffer.from(s, 'utf8'))
          : false,
    };
  };

  /**
   * 台帳の1行。**既定は目次と一致した状態**（＝消してよい）。
   *
   * ⚠️ `doc-meta-sync` は版数を上げずに写すため、移行しただけのページは
   * **版数 0 のまま**。それが普通の状態なので既定を 0n にする
   */
  const owned = (
    docId: string,
    over: Record<string, unknown> = {},
  ) => ({
    docId,
    title: '題',
    tagIds: [] as string[],
    trash: false,
    titleRevision: 0n,
    trashRevision: 0n,
    tagsRevision: 0n,
    ...over,
  });

  describe('掃除できるもの', () => {
    /**
     * ⚠️ **これが本丸。** 削除しただけでは題は残る。
     * 状態を作り直して初めて消える（7.8.2）。
     */
    test('⚠️ 台帳が所有しているページは消え、題も残らない', async () => {
      const { service, state, snapshotContains } = makeService({
        snapshotBlob: makeRootDoc([{ id: 'd1', title: 'ヒミツの題' }]),
        metas: [owned('d1', { title: 'ヒミツの題' })],
      });

      expect(snapshotContains('ヒミツの題')).toBe(true);

      const r = await service.purgeWorkspace(WS, false);

      expect(r.purged).toBe(1);
      expect(r.applied).toBe(true);
      expect(snapshotContains('ヒミツの題')).toBe(false);
      expect(state.histories).toBe(0);
    });

    test('複数あっても、まとめて消える', async () => {
      const { service, snapshotContains } = makeService({
        snapshotBlob: makeRootDoc([
          { id: 'd1', title: '題1' },
          { id: 'd2', title: '題2' },
          { id: 'd3', title: '題3' },
        ]),
        metas: [
          owned('d1', { title: '題1' }),
          owned('d2', { title: '題2' }),
          owned('d3', { title: '題3' }),
        ],
      });

      const r = await service.purgeWorkspace(WS, false);

      expect(r.purged).toBe(3);
      expect(snapshotContains('題1')).toBe(false);
      expect(snapshotContains('題3')).toBe(false);
    });
  });

  describe('⚠️ 消してはいけないもの', () => {
    /**
     * ⚠️ 台帳に行が無いページの題は、消したら**復元手段が無い**。
     * 残す害は「題が漏れ続ける」だけで、消す害とは釣り合わない。
     */
    test('⚠️ 台帳に行が無いページは残す', async () => {
      const { service, snapshotContains } = makeService({
        snapshotBlob: makeRootDoc([{ id: 'orphan', title: '失われる題' }]),
        metas: [],
      });

      const r = await service.purgeWorkspace(WS, false);

      expect(r.purged).toBe(0);
      expect(r.kept[0]).toMatchObject({ docId: 'orphan', reason: '台帳に行が無い' });
      expect(snapshotContains('失われる題')).toBe(true);
    });

    /** ⚠️ 版数 0 は「台帳が未所有＝目次が正」の意味（7.7.2） */
    test('⚠️ 値が食い違い、版数が 0 なら残す', async () => {
      const { service, snapshotContains } = makeService({
        snapshotBlob: makeRootDoc([{ id: 'd1', title: '目次が正の題' }]),
        // ⚠️ 値が食い違い、かつ版数 0 ＝台帳が未所有なので目次が正
        metas: [owned('d1', { title: '台帳の古い題', titleRevision: 0n })],
      });

      const r = await service.purgeWorkspace(WS, false);

      expect(r.purged).toBe(0);
      expect(r.kept[0].reason).toContain('目次が正');
      expect(snapshotContains('目次が正の題')).toBe(true);
    });

    /**
     * ⚠️ **混在しても、消してよいものだけを消すこと。**
     * 「1件でも危険なら全部やめる」にすると、いつまでも掃除できない。
     */
    test('⚠️ 混在していれば、消してよいものだけ消す', async () => {
      const { service, snapshotContains } = makeService({
        snapshotBlob: makeRootDoc([
          { id: 'd1', title: '消せる題' },
          { id: 'orphan', title: '残す題' },
        ]),
        metas: [owned('d1', { title: '消せる題' })],
      });

      const r = await service.purgeWorkspace(WS, false);

      expect(r.purged).toBe(1);
      expect(snapshotContains('消せる題')).toBe(false);
      expect(snapshotContains('残す題')).toBe(true);
    });
  });

  describe('⚠️ 掃除中に他の書き込みが入った場合', () => {
    /**
     * ⚠️ **読んだあとに届いた更新があれば、何もせずやり直す**（7.8.7a）。
     *
     * 消せば利用者の変更が失われ、残せば掃除後の状態に適用されて
     * 新しい ID の目次項目として**題が再出現する**。
     */
    test('⚠️ 境界より後の更新があれば、書き換えない', async () => {
      const svc = makeService({
        snapshotBlob: makeRootDoc([{ id: 'd1', title: 'ヒミツの題' }]),
        metas: [owned('d1', { title: 'ヒミツの題' })],
        // 読む時点では 1 件だけ（＝境界は 1n）
        updates: [{ id: 1n, blob: someUpdate() }],
        // ⚠️ 読み終えたあと、置き換えの直前に新しい更新が届く
        intrude: () => {
          if (!svc.state.updates.some((u) => u.id === 100n)) {
            svc.state.updates.push({ id: 100n, blob: someUpdate() });
          }
        },
      });

      const r = await svc.service.purgeWorkspace(WS, false);

      expect(r.applied).toBe(false);
      expect(r.retriedForConflict).toBe(true);
      // ⚠️ 何も書き換えていないこと（題も更新ログも残る）
      expect(svc.snapshotContains('ヒミツの題')).toBe(true);
      expect(svc.state.updates.some((u) => u.id === 1n)).toBe(true);
    });

    /**
     * ⚠️ **版が変わっていたら書かない**（7.8.7c）。
     * 書くと、その間に入った別の書き込み（再構築など）を取り消す。
     */
    test('⚠️ スナップショットの版が変わっていたら、書き換えない', async () => {
      const svc = makeService({
        snapshotBlob: makeRootDoc([{ id: 'd1', title: 'ヒミツの題' }]),
        metas: [owned('d1', { title: 'ヒミツの題' })],
        intrude: () => {
          // 別の書き込みが版を進めた
          if (svc.state.snapshot) {
            svc.state.snapshot.timestamp = new Date('2026-08-27T12:00:00Z');
          }
        },
      });

      const r = await svc.service.purgeWorkspace(WS, false);

      expect(r.applied).toBe(false);
      expect(r.retriedForConflict).toBe(true);
      expect(svc.snapshotContains('ヒミツの題')).toBe(true);
    });

    /**
     * ⚠️ **他者が先にスナップショットを作った場合も「やり直し」である。**
     * 更新ログしか無い状態で掃除している最中に、同期が初回の
     * スナップショットを作りにくることがある。捕まえずにいたため、
     * 掃除全体が例外で落ちて**中止を報告できなかった**（2026-08-27 指摘）。
     */
    test('⚠️ 他者が先にスナップショットを作っていたら、中止として報告する', async () => {
      const svc = makeService({
        snapshotBlob: null,
        updates: [{ id: 1n, blob: makeRootDoc([{ id: 'd1', title: 'ヒミツの題' }]) }],
        metas: [owned('d1', { title: 'ヒミツの題' })],
        createConflict: true,
      });

      const r = await svc.service.purgeWorkspace(WS, false);

      expect(r.applied).toBe(false);
      expect(r.retriedForConflict).toBe(true);
      // ⚠️ 更新ログを消していないこと（消すと題ごと失われる）
      expect(svc.state.updates).toHaveLength(1);
    });
  });

  describe('試し行い（dryRun）', () => {
    /** ⚠️ 既定は試し行い。うっかり本番で消さないため */
    test('⚠️ 何も書き換えない', async () => {
      const { service, snapshotContains, state } = makeService({
        snapshotBlob: makeRootDoc([{ id: 'd1', title: 'ヒミツの題' }]),
        metas: [owned('d1', { title: 'ヒミツの題' })],
      });

      const r = await service.purgeWorkspace(WS);

      expect(r.purged).toBe(1);
      expect(r.applied).toBe(false);
      expect(snapshotContains('ヒミツの題')).toBe(true);
      expect(state.histories).toBe(3);
    });
  });

  describe('完了の確認', () => {
    /**
     * ⚠️ **「消した」ではなく「どこにも無い」を確かめる**（7.8.7d）。
     */
    test('目次・更新ログ・履歴の3か所を数える', async () => {
      const { service } = makeService({
        snapshotBlob: makeRootDoc([{ id: 'd1', title: '題' }]),
        updates: [{ id: 1n, blob: someUpdate() }],
      });

      const v = await service.verify(WS);

      expect(v.indexed).toBe(1);
      expect(v.updates).toBe(1);
      expect(v.histories).toBe(3);
    });

    test('掃除後は目次も履歴も 0 になる', async () => {
      const { service } = makeService({
        snapshotBlob: makeRootDoc([{ id: 'd1', title: '題' }]),
        metas: [owned('d1')],
      });

      await service.purgeWorkspace(WS, false);
      const v = await service.verify(WS);

      expect(v.indexed).toBe(0);
      expect(v.histories).toBe(0);
    });
  });

  test('目次も docId も空なら何もしない', async () => {
    const { service } = makeService({ snapshotBlob: makeRootDoc([]) });

    const r = await service.purgeWorkspace(WS, false);

    expect(r.indexed).toBe(0);
    expect(r.applied).toBe(false);
  });

  /**
   * #151 PR5-c: **`spaces` の docId**（7.9）。
   *
   * ⚠️ 題を消しても docId が残れば「文書がいくつ在り、id は何か」は漏れる。
   * 段階3 の要求は「読めないものは**存在も**知らせない」。
   */
  describe('docId（spaces）の掃除', () => {
    test('⚠️ docId は消える', async () => {
      const { service, state } = makeService({
        snapshotBlob: makeRootDoc([{ id: 'd1', title: '題' }], ['d1', 'd2']),
        metas: [owned('d1')],
      });

      expect(readSpaces(state.snapshot!.blob)).toHaveLength(2);

      const r = await service.purgeWorkspace(WS, false);

      expect(r.applied).toBe(true);
      expect(r.spacesIndexed).toBe(2);
      expect(r.spacesPurged).toBe(2);
      expect(readSpaces(state.snapshot!.blob)).toEqual([]);
    });

    /**
     * ⚠️ **ここが PR5-c の本丸。** PR5-b を通したあとの本番がまさにこの形
     * （目次 0 件・docId 124 件）。目次が空だからと先に返すと**何もしない**。
     */
    test('⚠️ 目次が空でも、docId だけ残っていれば掃除する', async () => {
      const { service, state } = makeService({
        snapshotBlob: makeRootDoc([], ['d1', 'd2', 'd3']),
        metas: [],
      });

      const r = await service.purgeWorkspace(WS, false);

      expect(r.indexed).toBe(0);
      expect(r.spacesIndexed).toBe(3);
      expect(r.applied).toBe(true);
      expect(readSpaces(state.snapshot!.blob)).toEqual([]);
    });

    /**
     * ⚠️ **判定は要らない**（7.9.6）。`spaces` の値は subdoc でしかなく、
     * 台帳と食い違う値を持たない。台帳に行が無くても消してよい
     */
    test('⚠️ 台帳に行が無い docId も消す（目次と違って復元すべき値が無い）', async () => {
      const { service, state } = makeService({
        snapshotBlob: makeRootDoc([], ['台帳にない']),
        metas: [],
      });

      const r = await service.purgeWorkspace(WS, false);

      expect(r.spacesPurged).toBe(1);
      expect(readSpaces(state.snapshot!.blob)).toEqual([]);
    });

    /** ⚠️ 目次を残す判断になっても、docId の掃除は別勘定で進む */
    test('目次を残しても、docId は消える', async () => {
      const { service, state, snapshotContains } = makeService({
        // 台帳に行が無い＝目次は残す
        snapshotBlob: makeRootDoc([{ id: 'orphan', title: '失われる題' }], ['orphan']),
        metas: [],
      });

      const r = await service.purgeWorkspace(WS, false);

      expect(r.kept).toHaveLength(1);
      expect(r.purged).toBe(0);
      expect(snapshotContains('失われる題')).toBe(true);
      expect(readSpaces(state.snapshot!.blob)).toEqual([]);
    });

    test('試し行いでは docId を消さない', async () => {
      const { service, state } = makeService({
        snapshotBlob: makeRootDoc([], ['d1']),
        metas: [],
      });

      const r = await service.purgeWorkspace(WS, true);

      expect(r.spacesIndexed).toBe(1);
      expect(r.applied).toBe(false);
      expect(readSpaces(state.snapshot!.blob)).toEqual(['d1']);
    });

    test('確認でも docId の残りを数える', async () => {
      const { service } = makeService({
        snapshotBlob: makeRootDoc([], ['d1', 'd2']),
      });

      expect((await service.verify(WS)).spaces).toBe(2);
    });
  });
});

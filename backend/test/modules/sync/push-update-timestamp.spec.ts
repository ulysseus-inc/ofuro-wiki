import { SyncService } from '../../../src/modules/sync/sync.service';
import { isUserDoc } from '../../../src/modules/sync/user-doc';

/**
 * #151 段階3: **本文の保存と台帳の更新日時を同じトランザクションで動かす。**
 *
 * ⚠️ ここで守っているのは、**間違えると「最終更新日が古いまま」に戻るか、
 * 逆に本文が保存されなくなる**性質のもの。
 *
 * 本文だけを編集したとき、フロントエンドは台帳を触らない
 * （`planMetaWrite` は title / trash / tags しか送らない）。
 * そのため `@updatedAt` も発火せず、**更新日時が進まなくなっていた**
 * （2026-08-29 実測。台帳 08-27 / 本文 08-29）。
 *
 * 詳細は docs/discovery-stage3-comparison.md 7.10
 */
describe('本文の保存と更新日時（#151 段階3）', () => {
  const WS = '11111111-1111-4111-8111-111111111111';
  const DOC = 'doc-1';

  const make = (opts: { metaRows?: number; createThrows?: Error } = {}) => {
    const calls: string[] = [];

    const tx = {
      docUpdate: {
        create: jest.fn().mockImplementation(() => {
          calls.push('docUpdate.create');
          if (opts.createThrows) return Promise.reject(opts.createThrows);
          return Promise.resolve({ id: 1n });
        }),
      },
      docMeta: {
        updateMany: jest.fn().mockImplementation(() => {
          calls.push('docMeta.updateMany');
          return Promise.resolve({ count: opts.metaRows ?? 1 });
        }),
      },
      // #101: 索引の作り直しの印も同じトランザクションで立つ
      searchIndexQueue: {
        upsert: jest.fn().mockImplementation(() => {
          calls.push('searchIndexQueue.upsert');
          return Promise.resolve({});
        }),
      },
    };

    const prisma: any = {
      workspace: { findUnique: jest.fn().mockResolvedValue({ id: WS }) },
      // 閾値に届かせない（スナップショット再構築は本テストの関心事ではない）
      docUpdate: { count: jest.fn().mockResolvedValue(1) },
      // ⚠️ 実物と同じく、渡した関数に tx を与えて実行する。
      // ここを素通りさせると「同一トランザクション」を検査できない
      $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
    };

    const discovery: any = { bump: jest.fn(), current: jest.fn() };
    return { prisma, tx, calls, service: new SyncService(prisma, discovery) };
  };

  const someUpdate = () => new Uint8Array([1, 2, 3]);

  test('本文を保存すると、更新ログが積まれる', async () => {
    const { service, tx } = make();

    await service.pushUpdate(WS, DOC, someUpdate(), 'user-1');

    expect(tx.docUpdate.create).toHaveBeenCalledTimes(1);
    expect(tx.docUpdate.create.mock.calls[0][0].data).toMatchObject({
      workspaceId: WS,
      docId: DOC,
      editorId: 'user-1',
    });
  });

  test('⚠️ 同時に台帳の更新日時が進む', async () => {
    const { service, tx } = make();

    await service.pushUpdate(WS, DOC, someUpdate(), 'user-1');

    expect(tx.docMeta.updateMany).toHaveBeenCalledTimes(1);
    const args = tx.docMeta.updateMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ workspaceId: WS, docId: DOC });
    expect(args.data.updatedAt).toBeInstanceOf(Date);
    expect(args.data.updatedById).toBe('user-1');
  });

  /**
   * ⚠️ **本文の保存時刻と更新日時がずれてはいけない。**
   * ずれると「本文は 12:04 に保存されたのに、最終更新は 12:03」という
   * 説明できない状態になる。同じ瞬間を渡す。
   */
  test('⚠️ 更新ログと台帳に、同じ時刻が入る', async () => {
    const { service, tx } = make();

    await service.pushUpdate(WS, DOC, someUpdate(), 'user-1');

    const logged = tx.docUpdate.create.mock.calls[0][0].data.timestamp;
    const meta = tx.docMeta.updateMany.mock.calls[0][0].data.updatedAt;
    expect(meta.getTime()).toBe(logged.getTime());
  });

  /**
   * ⚠️ **これが要件の中心。** 分けると
   * 「本文は保存されたが更新日時は進まなかった」が再発する
   * （いま直している不具合と同じ形の穴）。
   */
  describe('⚠️ 同一トランザクション', () => {
    test('両方が同じトランザクションの中で呼ばれる', async () => {
      const { service, prisma, calls } = make();

      await service.pushUpdate(WS, DOC, someUpdate(), 'user-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // #101: 索引の作り直しの印も同じトランザクションに入る
      expect(calls).toEqual([
        'docUpdate.create',
        'searchIndexQueue.upsert',
        'docMeta.updateMany',
      ]);
    });

    test('⚠️ 本文の保存が失敗したら、台帳も触らない', async () => {
      const { service, tx } = make({ createThrows: new Error('DB が落ちた') });

      await expect(
        service.pushUpdate(WS, DOC, someUpdate(), 'user-1'),
      ).rejects.toThrow('DB が落ちた');

      expect(tx.docMeta.updateMany).not.toHaveBeenCalled();
    });
  });

  /**
   * ⚠️ **更新日時を巻き戻さない**（Codex 指摘・2026-08-30）。
   *
   * `now` は push が届いた時点で決まるが、行ロックを取るのはその後。
   * 同じページを2人が編集すると、**古いほうが最後にロックを取って
   * 新しい値を上書きし得る**。鮮度表示が逆行し、更新者も別人に戻る。
   *
   * 0 件に当たるのが正しい結果。**より新しい編集が既に書いている**。
   */
  test('⚠️ 自分より新しい更新日時は上書きしない', async () => {
    const { service, tx } = make();

    await service.pushUpdate(WS, DOC, someUpdate(), 'user-1');

    const where = tx.docMeta.updateMany.mock.calls[0][0].where;
    const data = tx.docMeta.updateMany.mock.calls[0][0].data;
    // 「いま書こうとしている時刻以前のものだけ」を条件にしていること
    expect(where.updatedAt).toEqual({ lte: data.updatedAt });
  });

  /**
   * ⚠️ **`update` ではなく `updateMany` を使う理由。**
   * `update` は行が無いと `P2025` を投げ、**本文の保存ごと巻き込む**。
   * 台帳に行が無いのは異常ではない（移行漏れ・段階3 より前に作られたページ）。
   * **台帳の不備で利用者の本文を失ってはいけない**（#90 と同じ方針）。
   */
  test('⚠️ 台帳に行が無くても、本文の保存は成功する', async () => {
    const { service, tx } = make({ metaRows: 0 });

    await expect(
      service.pushUpdate(WS, DOC, someUpdate(), 'user-1'),
    ).resolves.toEqual(expect.any(Number));

    expect(tx.docUpdate.create).toHaveBeenCalledTimes(1);
    expect(tx.docMeta.updateMany).toHaveBeenCalledTimes(1);
  });

  /**
   * ⚠️ 内部 REST API は編集者を持たない。
   * ここで null を書くと、**最後に触った人が消える**。
   */
  test('⚠️ 編集者が分からないときは、更新者を書き換えない', async () => {
    const { service, tx } = make();

    await service.pushUpdate(WS, DOC, someUpdate());

    const data = tx.docMeta.updateMany.mock.calls[0][0].data;
    expect(data.updatedAt).toBeInstanceOf(Date);
    expect(data).not.toHaveProperty('updatedById');
  });

  /** ⚠️ ページではないものの更新日時を動かさない（7.10.4） */
  describe('⚠️ 対象にしないもの', () => {
    test('⚠️ ルート文書では台帳を触らない', async () => {
      const { service, tx } = make();

      // ルート文書＝ワークスペースIDと同じ docId
      await service.pushUpdate(WS, WS, someUpdate(), 'user-1');

      expect(tx.docUpdate.create).toHaveBeenCalledTimes(1);
      expect(tx.docMeta.updateMany).not.toHaveBeenCalled();
    });

    test('内部ドキュメントでも台帳を触らない', async () => {
      const { service, tx } = make();

      await service.pushUpdate(WS, `db$${WS}$docProperties`, someUpdate());

      expect(tx.docUpdate.create).toHaveBeenCalledTimes(1);
      expect(tx.docMeta.updateMany).not.toHaveBeenCalled();
    });
  });

  test('ワークスペースが無ければ、何も書かずに落ちる', async () => {
    const { service, prisma, tx } = make();
    prisma.workspace.findUnique.mockResolvedValue(null);

    await expect(
      service.pushUpdate(WS, DOC, someUpdate(), 'user-1'),
    ).rejects.toThrow(/not found/);

    expect(tx.docUpdate.create).not.toHaveBeenCalled();
  });
});

/**
 * ⚠️ 対象の判定は1か所に置く。同じ条件を呼び出し側で書き直すと、
 * 片方だけ直したときに食い違う（`judgeIndexEntry` で経験済み）。
 */
describe('利用者のドキュメントかの判定', () => {
  const WS = 'ws-1';

  test('普通のページは対象', () => {
    expect(isUserDoc(WS, 'FRw54wx5Oi')).toBe(true);
  });

  test('⚠️ ルート文書は対象外', () => {
    expect(isUserDoc(WS, WS)).toBe(false);
  });

  test('⚠️ 内部ドキュメントは対象外', () => {
    expect(isUserDoc(WS, `db$${WS}$docProperties`)).toBe(false);
    expect(isUserDoc(WS, `db$${WS}$folders`)).toBe(false);
  });
});

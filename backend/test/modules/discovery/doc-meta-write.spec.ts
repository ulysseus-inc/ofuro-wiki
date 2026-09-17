import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DocMetaWriteService } from '../../../src/modules/discovery/doc-meta-write.service';
import type { PrismaService } from '../../../src/prisma.service';

/**
 * #151 段階3: Discovery Metadata の書き込み。
 *
 * ⚠️ ここで守っているのは、**間違えると利用者の変更が黙って消える**性質のもの。
 *
 * - 値型（title / trash）は**版数**で競合を弾く
 * - 操作型（tags）は**版数で弾かない**（順序に依存しないため）
 * - 移行期間（版数 0）は**版数では判定できない**ので、見ていた値と突き合わせる
 *
 * 詳細は docs/discovery-stage3-comparison.md 7.5.10 / 7.7
 */
describe('Discovery Metadata の書き込み', () => {
  const WS = 'ws-1';
  const DOC = 'doc-1';
  const USER = 'user-1';

  const makeService = (opts: {
    row: Record<string, unknown> | null;
    canUpdate?: boolean;
    canDelete?: boolean;
    /** 読み取り直後に他者の書き込みを割り込ませる */
    onRead?: () => void;
  }) => {
    const updates: any[] = [];
    const bumps: string[] = [];
    // ⚠️ 実際の DB と同じく、**条件（where）が現在の行と合ったときだけ**書けるようにする。
    // ここを「常に成功」にすると、CAS が壊れていても検査が通ってしまう
    let row: Record<string, unknown> | null = opts.row ? { ...opts.row } : null;
    /** 読み取り直後に割り込む他人の書き込み */
    let intruder: ((r: Record<string, unknown> | null) => void) | undefined;
    const prisma = {
      docMeta: {
        findUnique: jest.fn().mockImplementation(() => {
          // ⚠️ **先に写しを取ってから割り込ませる。**
          // これで「読んだ内容は古い」という TOCTOU の状況が再現できる
          const r = row ? { ...row } : null;
          intruder?.(row);
          return Promise.resolve(r);
        }),
        updateMany: jest.fn().mockImplementation((args: any) => {
          updates.push(args);
          if (!row) return Promise.resolve({ count: 0 });
          const { workspaceId: _w, docId: _d, ...guard } = args.where;
          const matches = Object.entries(guard).every(
            ([k, v]) => row![k] === v,
          );
          if (!matches) return Promise.resolve({ count: 0 });
          for (const [k, v] of Object.entries(args.data)) {
            if (v && typeof v === 'object' && 'increment' in (v as any)) {
              row![k] = (row![k] as bigint) + BigInt((v as any).increment);
            } else {
              row![k] = v;
            }
          }
          return Promise.resolve({ count: 1 });
        }),
        create: jest.fn().mockImplementation((args: any) => {
          row = { ...args.data };
          return Promise.resolve({ ...row });
        }),
        // ⚠️ 実際の upsert と同じく**原子的**に振る舞わせる。
        // 「読んでから作る」を模すと、同時作成の検査が意味を失う
        upsert: jest.fn().mockImplementation((args: any) => {
          if (!row) row = { ...args.create };
          else row = { ...row, ...args.update };
          return Promise.resolve({ ...row });
        }),
        deleteMany: jest.fn().mockImplementation(() => {
          const had = row !== null;
          row = null;
          return Promise.resolve({ count: had ? 1 : 0 });
        }),
      },
      // #136: 監査ログの実行者（actorEmail）を引く
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: USER, email: 'u1@example.com', name: 'U1' }),
      },
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const permission = {
      canUpdate: jest.fn().mockResolvedValue(opts.canUpdate ?? true),
      // ⚠️ 削除も PermissionService に委ねる（判定を散らさない）
      canDelete: jest.fn().mockResolvedValue(opts.canDelete ?? true),
    };
    const revision = {
      bump: jest.fn().mockImplementation((_ws: string, reason: string) => {
        bumps.push(reason);
        return Promise.resolve();
      }),
    };
    // #45: 完全削除で消すものは DocGcService が1か所で持つ
    const gc = {
      purge: jest.fn().mockImplementation(() => {
        const had = row !== null;
        row = null;
        if (had) bumps.push('doc-delete');
        return Promise.resolve({ deleted: had });
      }),
    };
    return {
      service: new DocMetaWriteService(
        prisma as unknown as PrismaService,
        permission as any,
        revision as any,
        audit as any,
        gc as any,
      ),
      updates,
      bumps,
      permission,
      audit,
      gc,
      /** 読み取り直後に1度だけ他人の書き込みを割り込ませる */
      intrudeOnce: (fn: (r: Record<string, unknown>) => void) => {
        let done = false;
        intruder = (r) => {
          if (done || !r) return;
          done = true;
          fn(r);
        };
      },
      currentRow: () => row,
    };
  };

  /** 台帳の1行。既定は未移行（版数 0）。 */
  const row = (over: Record<string, unknown> = {}) => ({
    title: '元の題',
    trash: false,
    tagIds: ['t1'],
    titleRevision: 0n,
    trashRevision: 0n,
    tagsRevision: 0n,
    ...over,
  });

  const setTitle = (over: Record<string, unknown> = {}) => ({
    workspaceId: WS,
    docId: DOC,
    userId: USER,
    title: '新しい題',
    baseRevision: 0n,
    ...over,
  });

  describe('認可', () => {
    it('⚠️ 書き込み権限が無ければ拒否する', async () => {
      const { service } = makeService({ row: row(), canUpdate: false });
      await expect(service.setTitle(setTitle())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    /**
     * ⚠️ 「権限が無い」と「存在しない」を利用者から区別できるようにしない。
     * 区別できると、権限外のページの**存在が分かってしまう**（#151 の目的）。
     */
    it('⚠️ 権限の確認は台帳を読む前に行う（存在を漏らさない）', async () => {
      const { service, permission } = makeService({
        row: null,
        canUpdate: false,
      });
      await expect(service.setTitle(setTitle())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(permission.canUpdate).toHaveBeenCalled();
    });

    it('判定は PermissionService に委ねる（自前で条件を書かない）', async () => {
      const { service, permission } = makeService({ row: row() });
      await service.setTitle(setTitle());
      expect(permission.canUpdate).toHaveBeenCalledWith(WS, DOC, USER);
    });
  });

  /**
   * #151 段階3: **版数 0 も、ほかと同じく版数で判定する**（7.7.5）。
   *
   * ⚠️ かつては「版数 0 なら Yjs 目次が正」として、見ていた値そのものと
   * 突き合わせていた（7.7.4）。`doc-meta-sync` が**版数を上げずに値を
   * 書き換える**ため、版数では判定できなかったからである。
   * その同期を撤去したので、**版数を動かさずに値が変わる経路は無い**。
   *
   * ⚠️ **本番の 126 行中 124 行が版数 0**（2026-09-01 実測）。
   * ここが壊れると、ほぼ全ページの題が変えられなくなる。
   */
  describe('版数 0 の行（本番のほとんど）', () => {
    it('版数 0 を基準に送れば受理し、1 に進める', async () => {
      const { service, updates } = makeService({ row: row() });
      const r = await service.setTitle(setTitle({ observedTitle: null }));
      expect(r.status).toBe('ok');
      expect(r.revision).toBe(1n);
      expect(updates[0].data.title).toBe('新しい題');
    });

    /** ⚠️ 見ていた値はもう使わない。**あっても無くても結果は同じ** */
    it('⚠️ 見ていた値が無くても、例外にしない', async () => {
      const { service } = makeService({ row: row() });
      const r = await service.setTitle(setTitle({ observedTitle: null }));
      expect(r.status).toBe('ok');
    });

    it('⚠️ 値が食い違っていても、版数が合っていれば受理する', async () => {
      // かつては stale にしていた（目次側の変更を守るため）。
      // いま目次は空で、書き換える者がいない
      const { service } = makeService({ row: row({ title: '別の題' }) });
      const r = await service.setTitle(setTitle({ observedTitle: '元の題' }));
      expect(r.status).toBe('ok');
    });

    it('版数が食い違えば stale', async () => {
      const { service, updates } = makeService({ row: row({ titleRevision: 3n }) });
      const r = await service.setTitle(setTitle({ baseRevision: 0n }));
      expect(r.status).toBe('stale');
      expect(updates).toHaveLength(0);
    });
  });

  describe('移行後（版数 0 超）は版数で判定する', () => {
    it('版数が一致すれば受理する', async () => {
      const { service } = makeService({
        row: row({ titleRevision: 5n }),
      });
      const r = await service.setTitle(
        setTitle({ baseRevision: 5n, observedTitle: null }),
      );
      expect(r.status).toBe('ok');
      expect(r.revision).toBe(6n);
    });

    it('版数が古ければ stale とし、現在値を返す', async () => {
      const { service, updates } = makeService({
        row: row({ titleRevision: 7n, title: '他人が変えた題' }),
      });
      const r = await service.setTitle(
        setTitle({ baseRevision: 5n, observedTitle: null }),
      );
      expect(r.status).toBe('stale');
      expect(r.revision).toBe(7n);
      // ⚠️ 現在値を返さないと、クライアントは「取ってから捨てる」ができない（7.5.10）
      expect(r.currentTitle).toBe('他人が変えた題');
      expect(updates).toHaveLength(0);
    });

    /**
     * ⚠️ **移行後に値の比較を足さないこと。**
     * 足すと「同じ値への変更」を stale として拒否してしまう。
     */
    it('見ていた値を送らなくても、版数が合えば受理する', async () => {
      const { service } = makeService({ row: row({ titleRevision: 2n }) });
      const r = await service.setTitle(
        setTitle({ baseRevision: 2n, observedTitle: null }),
      );
      expect(r.status).toBe('ok');
    });
  });

  describe('無駄な書き込みをしない', () => {
    /**
     * ⚠️ 変わっていないのに書くと版数が上がり、
     * **全員のキャッシュが失効する**。キャッシュが意味を失う。
     */
    it('移行後は、値が同じなら書かず版数も上げない', async () => {
      const { service, updates, bumps } = makeService({
        row: row({ titleRevision: 3n }),
      });
      const r = await service.setTitle(
        setTitle({ title: '元の題', baseRevision: 3n, observedTitle: null }),
      );
      expect(r.status).toBe('ok');
      expect(r.revision).toBe(3n);
      expect(updates).toHaveLength(0);
      expect(bumps).toHaveLength(0);
    });

    /**
     * #151 段階3: **版数 0 でも、変わらないなら書かない**（7.7.5）。
     *
     * ⚠️ かつては「値が同じでも所有権を取る」ため版数を進めていた。
     * `doc-meta-sync` に上書きされる余地を消すためだったが、
     * その同期を撤去したので**取る相手がいない**。
     */
    it('版数 0 でも、値が同じなら書かない', async () => {
      const { service, updates, bumps } = makeService({ row: row() });
      const r = await service.setTitle(
        setTitle({ title: '元の題', observedTitle: null }),
      );
      expect(r.status).toBe('ok');
      expect(r.revision).toBe(0n);
      expect(updates).toHaveLength(0);
      expect(bumps).toHaveLength(0);
    });
  });

  describe('タグは操作型（版数で弾かない）', () => {
    const changeTags = (over: Record<string, unknown> = {}) => ({
      workspaceId: WS,
      docId: DOC,
      userId: USER,
      add: [] as string[],
      remove: [] as string[],
      ...over,
    });

    it('足す', async () => {
      const { service, updates } = makeService({ row: row() });
      const r = await service.changeTags(changeTags({ add: ['t2'] }));
      expect(r.status).toBe('ok');
      expect(updates[0].data.tagIds).toEqual(['t1', 't2']);
    });

    it('外す', async () => {
      const { service, updates } = makeService({
        row: row({ tagIds: ['t1', 't2'] }),
      });
      await service.changeTags(changeTags({ remove: ['t1'] }));
      expect(updates[0].data.tagIds).toEqual(['t2']);
    });

    /**
     * ⚠️ **同じ操作の再送で版数を上げないこと。**
     * 上げると、送信が重なるたびに全員のキャッシュが失効する。
     * 送信担当タブを固定しない設計（7.5.9）はこれが前提。
     */
    it('⚠️ 既にあるタグを足しても、書かず版数も上げない（冪等）', async () => {
      const { service, updates, bumps } = makeService({
        row: row({ tagsRevision: 3n }), // 移行済み
      });
      const r = await service.changeTags(changeTags({ add: ['t1'] }));
      expect(r.status).toBe('ok');
      expect(updates).toHaveLength(0);
      expect(bumps).toHaveLength(0);
    });

    it('⚠️ 無いタグを外しても、書かず版数も上げない（冪等）', async () => {
      const { service, updates, bumps } = makeService({
        row: row({ tagsRevision: 3n }), // 移行済み
      });
      await service.changeTags(changeTags({ remove: ['t9'] }));
      expect(updates).toHaveLength(0);
      expect(bumps).toHaveLength(0);
    });

    /**
     * ⚠️ **移行前は、内容が変わらなくても所有権を取る。**
     *
     * 取らないと未移行のままになり、**doc-meta-sync が目次のタグで上書きする**。
     * 利用者が操作したはずのタグが、あとから目次の内容に戻る。
     */
    it('⚠️ 移行前は、内容が変わらなくても版数を進める（所有権を取る）', async () => {
      const { service, updates, bumps } = makeService({ row: row() });
      const r = await service.changeTags(changeTags({ add: ['t1'] }));
      expect(r.status).toBe('ok');
      expect(r.revision).toBe(1n);
      expect(updates).toHaveLength(1);
      // 一覧の内容は変わっていないので、全員のキャッシュは失効させない
      expect(updates[0].data.tagIds).toBeUndefined();
      expect(bumps).toHaveLength(0);
    });

    it('版数を送らなくても受理される（操作型のため）', async () => {
      const { service } = makeService({
        row: row({ tagsRevision: 42n }),
      });
      const r = await service.changeTags(changeTags({ add: ['t2'] }));
      expect(r.status).toBe('ok');
    });
  });

  /**
   * ⚠️ **読んでから無条件に書くと、ここが壊れる。**
   *
   * 検査と更新を1つの操作にしないと、同じ版数を基準にした2件が並行したとき
   * **両方とも検査を通って両方とも書き込み、後勝ちで一方が消える**。
   * しかも両方に ok を返すため、競合制御が働いていないことに気づけない。
   */
  describe('⚠️ 並行して書かれても失わない', () => {
    it('値型: 読んだ直後に他人が書いていたら stale にする（上書きしない）', async () => {
      let intruded = false;
      const { service, updates } = makeService({
        row: row({ titleRevision: 5n }),
        onRead: () => {
          // 1回目の読み取り直後に、他人が先に書いた状況を作る
          if (intruded) return;
          intruded = true;
        },
      });
      // 他人の書き込みで版数が 6 に進んだ状態を作る
      await service.setTitle(
        setTitle({ title: '他人の題', baseRevision: 5n, observedTitle: null }),
      );
      updates.length = 0;

      // こちらは 5 を基準にしたまま書こうとする
      const r = await service.setTitle(
        setTitle({ title: '自分の題', baseRevision: 5n, observedTitle: null }),
      );
      expect(r.status).toBe('stale');
      expect(r.currentTitle).toBe('他人の題');
    });

    it('⚠️ 値型: 更新の条件に版数が入っている（検査と更新が1操作）', async () => {
      const { service, updates } = makeService({ row: row({ titleRevision: 4n }) });
      await service.setTitle(
        setTitle({ baseRevision: 4n, observedTitle: null }),
      );
      expect(updates[0].where.titleRevision).toBe(4n);
    });

    /**
     * #151 段階3: **版数 0 でも条件は版数だけ**（7.7.5）。
     * ⚠️ 見ていた値を条件に混ぜていた頃の名残を残さないこと。
     * 混ぜると、同じ値へ戻す操作が通らなくなる
     */
    it('⚠️ 版数 0 でも、条件は版数だけ（見ていた値を混ぜない）', async () => {
      const { service, updates } = makeService({ row: row() });
      await service.setTitle(setTitle({ observedTitle: null }));
      expect(updates[0].where.titleRevision).toBe(0n);
      expect(updates[0].where.title).toBeUndefined();
    });

    /**
     * ⚠️ **これが Codex に指摘された競合そのもの。**
     * 2人が別のタグを同時に足したとき、両方が残らなければならない。
     */
    it('⚠️ タグ: 読んだ直後に他人が別のタグを足しても、両方残る', async () => {
      const { service, intrudeOnce, currentRow } = makeService({
        row: row({ tagIds: ['t1'], tagsRevision: 1n }),
      });

      // こちらが読んだ直後に、他人が t2 を足して版数を進める
      intrudeOnce((r) => {
        r.tagIds = ['t1', 't2'];
        r.tagsRevision = 2n;
      });

      const r = await service.changeTags({
        workspaceId: WS,
        docId: DOC,
        userId: USER,
        add: ['t3'],
        remove: [],
      });

      expect(r.status).toBe('ok');
      // ⚠️ 再試行で読み直すため、他人の t2 が消えない
      expect(currentRow()!.tagIds).toEqual(['t1', 't2', 't3']);
    });

    it('⚠️ タグ: 更新の条件に版数が入っている（CAS になっている）', async () => {
      const { service, updates } = makeService({ row: row({ tagsRevision: 2n }) });
      await service.changeTags({
        workspaceId: WS,
        docId: DOC,
        userId: USER,
        add: ['t2'],
        remove: [],
      });
      expect(updates[0].where.tagsRevision).toBe(2n);
    });
  });

  describe('版数を上げる理由', () => {
    it('題の変更は doc-update', async () => {
      const { service, bumps } = makeService({ row: row() });
      await service.setTitle(setTitle());
      expect(bumps).toEqual(['doc-update']);
    });

    it('ゴミ箱へ入れると doc-trash', async () => {
      const { service, bumps } = makeService({ row: row() });
      await service.setTrash({
        workspaceId: WS,
        docId: DOC,
        userId: USER,
        trash: true,
        baseRevision: 0n,
      });
      expect(bumps).toEqual(['doc-trash']);
    });

    it('ゴミ箱から戻すと doc-restore', async () => {
      const { service, bumps } = makeService({
        row: row({ trash: true }),
      });
      await service.setTrash({
        workspaceId: WS,
        docId: DOC,
        userId: USER,
        trash: false,
        baseRevision: 0n,
      });
      expect(bumps).toEqual(['doc-restore']);
    });
  });

  /**
   * #136: ⚠️ **ゴミ箱の出し入れは、値が実際に変わったときだけ記録する。**
   *
   * `setDocTrash` は失敗を結果の `status` で返し、同じ値への変更も `ok` を返す。
   * Interceptor で記録すると、競合・行が無い・何も変わらない操作まで残る（docs/logging.md 2.6）。
   */
  describe('ゴミ箱の監査ログ（#136）', () => {
    const setTrash = (over: Record<string, unknown> = {}) => ({
      workspaceId: WS,
      docId: DOC,
      userId: USER,
      trash: true,
      baseRevision: 0n,
      ...over,
    });

    it('ゴミ箱へ入れると doc.trash を記録する（実行者・対象・題）', async () => {
      const { service, audit } = makeService({ row: row() });

      await service.setTrash(setTrash());

      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'doc.trash',
          actor: { id: USER, email: 'u1@example.com', name: 'U1' },
          targetType: 'doc',
          targetId: DOC,
          targetName: '元の題',
          workspaceId: WS,
        }),
      );
    });

    it('ゴミ箱から戻すと doc.untrash を記録する', async () => {
      const { service, audit } = makeService({ row: row({ trash: true }) });

      await service.setTrash(setTrash({ trash: false }));

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'doc.untrash', targetId: DOC }),
      );
    });

    it('⚠️ すでに同じ値なら記録しない（ok が返っても何も変わっていない）', async () => {
      const { service, audit } = makeService({ row: row({ trash: true }) });

      const result = await service.setTrash(setTrash({ trash: true }));

      expect(result.status).toBe('ok');
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('⚠️ 競合（stale）なら記録しない', async () => {
      const { service, audit } = makeService({
        row: row({ trashRevision: 3n }),
      });

      const result = await service.setTrash(setTrash({ baseRevision: 2n }));

      expect(result.status).toBe('stale');
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('⚠️ 台帳に行が無ければ記録しない', async () => {
      const { service, audit } = makeService({ row: null });

      const result = await service.setTrash(setTrash());

      expect(result.status).toBe('not-found');
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('題の変更では記録しない（編集は DocEditAggregator が集約して記録する）', async () => {
      const { service, audit } = makeService({ row: row() });

      await service.setTitle(setTitle());

      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('台帳に行が無い', () => {
    it('not-found を返す（例外にしない）', async () => {
      const { service } = makeService({ row: null });
      const r = await service.setTitle(setTitle());
      expect(r.status).toBe('not-found');
    });
  });

  /**
   * #151 段階3: **ページの作成・削除を台帳へ反映する。**
   *
   * ⚠️ 段階2 までは `doc-meta-sync` が Yjs 目次を見て行を作っていた。
   * 目次にメタデータを書かなくなると**その経路が無くなり、
   * 新しいページが誰の一覧にも出なくなる**。
   */
  describe('ページの作成', () => {
    test('台帳に行を作る', async () => {
      const { service, bumps } = makeService({ row: null });

      const r = await service.createDoc({
        workspaceId: WS,
        docId: DOC,
        userId: USER,
        title: '作りたて',
        mode: 'page',
      });

      expect(r.status).toBe('ok');
      expect(bumps).toContain('doc-create');
    });

    /**
     * ⚠️ **版数を 1 から始めること。**
     * 0 は「まだ台帳が持っていない（Yjs が正）」を意味する移行判定の値
     * （7.7.2）。新規ページに 0 を使うと、**`doc-meta-sync` に
     * 上書きされる余地を残す**。
     */
    test('⚠️ 版数は 1 から始める（0 は移行中の意味）', async () => {
      const { service, currentRow } = makeService({ row: null });

      await service.createDoc({
        workspaceId: WS,
        docId: DOC,
        userId: USER,
        title: '作りたて',
        mode: 'page',
      });

      const r = currentRow()!;
      expect(r.titleRevision).toBe(1n);
      expect(r.trashRevision).toBe(1n);
      expect(r.tagsRevision).toBe(1n);
    });

    /**
     * ⚠️ **3フィールドの版数を返すこと**（7.12）。
     *
     * 返さないと、クライアントは作成直後の書き込みを baseRevision 0 で
     * 送る。サーバーは 1 から採番するため**必ず食い違い**、stale と
     * 判定して**打った題を捨てる**（2026-08-31 実測。新規ページが
     * すべて無題になっていた）。
     */
    test('⚠️ 作成したら、3フィールドそれぞれの版数を返す', async () => {
      const { service } = makeService({ row: null });

      const r = await service.createDoc({
        workspaceId: WS,
        docId: DOC,
        userId: USER,
        title: '作りたて',
        mode: 'page',
      });

      expect(r.revisions).toEqual({ title: 1n, trash: 1n, tags: 1n });
    });

    /**
     * ⚠️ **再送では「全部 1」ではない。**
     *
     * 作成は冪等な upsert なので、既にある行の版数がそのまま返る。
     * クライアントが「作成時は全部 1」と推測すると、改名済みのページを
     * 再送したときに **trash / tags へ嘘の版数を書く**。
     */
    test('⚠️ 再送では、いまの行の版数をそのまま返す', async () => {
      const { service } = makeService({
        row: row({
          title: 'あとから付けた題',
          titleRevision: 5n,
          trashRevision: 2n,
          tagsRevision: 3n,
        }),
      });

      const r = await service.createDoc({
        workspaceId: WS,
        docId: DOC,
        userId: USER,
        title: '',
        mode: 'page',
      });

      expect(r.revisions).toEqual({ title: 5n, trash: 2n, tags: 3n });
    });

    /**
     * ⚠️ **冪等にすること。** 作成は再送され得る（通信断・複数タブ）。
     * 上書きすると、**すでに付けた題を作りたての空へ戻す**。
     */
    test('⚠️ すでに行があれば上書きしない', async () => {
      const { service, currentRow, bumps } = makeService({
        row: row({ title: 'あとから付けた題', titleRevision: 5n }),
      });

      const r = await service.createDoc({
        workspaceId: WS,
        docId: DOC,
        userId: USER,
        title: '',
        mode: 'page',
      });

      expect(r.status).toBe('ok');
      expect(currentRow()!.title).toBe('あとから付けた題');
      // ⚠️ 何も変えていないのに版数を上げない（全員のキャッシュが失効する）
      expect(bumps).not.toContain('doc-create');
    });
  });

  describe('ページの削除', () => {
    test('台帳から行を消す', async () => {
      const { service, currentRow, bumps } = makeService({ row: row() });

      const r = await service.deleteDoc({ workspaceId: WS, docId: DOC, userId: USER });

      expect(r.status).toBe('ok');
      expect(currentRow()).toBeNull();
      expect(bumps).toContain('doc-delete');
    });

    /**
     * ⚠️ **本文と索引も一緒に消す（#45）。**
     *
     * 台帳の行だけ消すと、`doc_updates` などが孤児として残り続けた。
     * さらに索引が残ると、doc ごとの権限を引けなくなって
     * 「ワークスペースのメンバーなら読める」に落ちるため、
     * **完全削除したページの本文が検索結果に出る**（docs/permanent-delete.md 4章）。
     */
    test('⚠️ 本文・索引・作り直しの印も消す', async () => {
      const { service, gc } = makeService({ row: row() });

      await service.deleteDoc({ workspaceId: WS, docId: DOC, userId: USER });

      expect(gc.purge).toHaveBeenCalledWith(WS, DOC);
    });

    /**
     * ⚠️ **無くても失敗にしないこと。** 削除は再送され得るし、
     * 台帳に無いページを消そうとするのは矛盾ではない。
     */
    test('⚠️ 行が無くても失敗にしない', async () => {
      const { service, bumps } = makeService({ row: null });

      const r = await service.deleteDoc({ workspaceId: WS, docId: DOC, userId: USER });

      expect(r.status).toBe('ok');
      // 何も消していないなら版数も上げない
      expect(bumps).not.toContain('doc-delete');
    });
  });

  /**
   * ⚠️ **ワークスペースのメンバーであることだけでは足りない**（レビュー指摘）。
   * 判定を落とすと、**編集できないページを誰でも台帳から消せる**
   * ＝全員の一覧から消える。
   */
  describe('削除の権限', () => {
    test('⚠️ 権限が無ければ消せない', async () => {
      const { service, currentRow } = makeService({
        row: row(),
        canDelete: false,
      });

      await expect(
        service.deleteDoc({ workspaceId: WS, docId: DOC, userId: USER }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(currentRow()).not.toBeNull();
    });

    /**
     * ⚠️ 「権限が無い」と「存在しない」を利用者から区別させない。
     * 区別できると、権限外のページの存在が分かる（#151 の目的）。
     */
    test('⚠️ 判定は PermissionService に委ねる', async () => {
      const { service, permission } = makeService({ row: row() });

      await service.deleteDoc({ workspaceId: WS, docId: DOC, userId: USER });

      expect(permission.canDelete).toHaveBeenCalledWith(WS, DOC, USER);
    });
  });

  /**
   * ⚠️ **同時作成で落ちないこと**（レビュー指摘）。
   * 「読んでから作る」にすると、複数タブや再送で両方が「無い」を読み、
   * 一意制約違反で片方が落ちる。
   */
  describe('同時の作成', () => {
    test('⚠️ 2つ同時に来ても両方成功し、後勝ちで上書きしない', async () => {
      const { service, currentRow } = makeService({ row: null });

      const [a, b] = await Promise.all([
        service.createDoc({
          workspaceId: WS,
          docId: DOC,
          userId: USER,
          title: '先の題',
          mode: 'page',
        }),
        service.createDoc({
          workspaceId: WS,
          docId: DOC,
          userId: USER,
          title: '',
          mode: 'page',
        }),
      ]);

      expect(a.status).toBe('ok');
      expect(b.status).toBe('ok');
      expect(currentRow()!.title).toBe('先の題');
    });
  });
});

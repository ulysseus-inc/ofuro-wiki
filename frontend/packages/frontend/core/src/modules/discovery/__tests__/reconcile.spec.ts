import { describe, expect, test } from 'vitest';

import { planReconcile } from '../reconcile';

/**
 * #151 段階3: **サーバーの値を手元へ取り込んでよいか**（原則2 の具体化）。
 *
 * ```
 * 未送信の変更が無いフィールド  → サーバーの値を採用
 * 未送信の変更があるフィールド  → 手元の値を維持（送信待ちのまま）
 * ```
 *
 * ⚠️ 逆にすると、**利用者の変更が送られる前に消える**。画面上は
 * 「入力したのに元に戻った」という形で現れ、原因が追いにくい。
 */
describe('#151 段階3 サーバー値との突き合わせ', () => {
  const server = { title: 'サーバーの題', trash: false, tagIds: ['x', 'z'] };

  describe('未送信の変更が無いフィールド', () => {
    test('題はサーバーの値を採用する', () => {
      expect(planReconcile({ field: 'title', server, hasPending: false })).toEqual({
        title: 'サーバーの題',
      });
    });

    test('ゴミ箱はサーバーの値を採用する', () => {
      expect(planReconcile({ field: 'trash', server, hasPending: false })).toEqual({
        trash: false,
      });
    });

    /**
     * ⚠️ **受け取り側は配列をそのまま入れ替えてよい。**
     * 送信時に配列を送るのは #164 の再現になるが、
     * ここは「未送信の変更が無い」と確かめたうえでの取り込みなので別。
     */
    test('タグはサーバーの配列を採用する', () => {
      expect(planReconcile({ field: 'tags', server, hasPending: false })).toEqual({
        tags: ['x', 'z'],
      });
    });
  });

  describe('未送信の変更があるフィールド', () => {
    /**
     * ⚠️ **ここが原則2 の本体。** 上書きすると、利用者の変更が
     * サーバーへ送られる前に消える。
     */
    test('⚠️ 題: 上書きしない', () => {
      expect(
        planReconcile({ field: 'title', server, hasPending: true })
      ).toBeUndefined();
    });

    test('⚠️ ゴミ箱: 上書きしない', () => {
      expect(
        planReconcile({ field: 'trash', server, hasPending: true })
      ).toBeUndefined();
    });

    test('⚠️ タグ: 上書きしない', () => {
      expect(
        planReconcile({ field: 'tags', server, hasPending: true })
      ).toBeUndefined();
    });
  });

  describe('台帳に無いページ', () => {
    /**
     * ⚠️ **メタを作って返さないこと。** 台帳に無いページの値を
     * 補うと、**存在を隠すという段階3 の目的に反する**。
     */
    test('⚠️ 何も当てない', () => {
      expect(
        planReconcile({ field: 'title', server: undefined, hasPending: false })
      ).toBeUndefined();
    });
  });

  describe('サーバーがその項目を返さなかった場合', () => {
    /**
     * ⚠️ **undefined を「空」として当てないこと。**
     * 当てると、題が消える・ゴミ箱から出る、といった実害になる。
     */
    test('⚠️ 題が無ければ当てない', () => {
      expect(
        planReconcile({ field: 'title', server: {}, hasPending: false })
      ).toBeUndefined();
    });

    test('⚠️ ゴミ箱が無ければ当てない', () => {
      expect(
        planReconcile({ field: 'trash', server: {}, hasPending: false })
      ).toBeUndefined();
    });

    test('⚠️ タグが無ければ当てない', () => {
      expect(
        planReconcile({ field: 'tags', server: {}, hasPending: false })
      ).toBeUndefined();
    });
  });

  describe('境界', () => {
    /**
     * ⚠️ 空の題・空のタグは**正当な値**。undefined と区別すること。
     * 区別しないと、題を消した／タグを全部外した状態が反映されない。
     */
    test('⚠️ 空の題は当てる（undefined とは違う）', () => {
      expect(
        planReconcile({ field: 'title', server: { title: '' }, hasPending: false })
      ).toEqual({ title: '' });
    });

    test('⚠️ 空のタグ配列は当てる', () => {
      expect(
        planReconcile({ field: 'tags', server: { tagIds: [] }, hasPending: false })
      ).toEqual({ tags: [] });
    });

    test('⚠️ ゴミ箱の true も当てる', () => {
      expect(
        planReconcile({ field: 'trash', server: { trash: true }, hasPending: false })
      ).toEqual({ trash: true });
    });
  });
});

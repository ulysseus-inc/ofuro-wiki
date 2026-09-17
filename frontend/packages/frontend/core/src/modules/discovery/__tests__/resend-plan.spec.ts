import { describe, expect, test } from 'vitest';

import {
  ownerChanged,
  samePending,
  selectResendable,
  toWritePlan,
} from '../resend-plan';
import type { PendingWrite } from '../stores/pending-write';

/**
 * #151 段階3: **控えておいた変更を送り直す**（7.5.8）。
 *
 * ⚠️ ここでの中心は「**基準の版数を取り直さない**」こと。
 * 取り直すと、オフライン中に他人が変えた分を黙って上書きする。
 */
describe('#151 段階3 控えの再送', () => {
  const base = { workspaceId: 'ws', userId: 'u1', docId: 'd1' };

  describe('送る形に戻す', () => {
    /**
     * ⚠️ **控えたときの版数をそのまま使うこと。**
     *
     * ```
     * 自分  オフラインで題を C にした（そのとき版数は 5）
     * 他人  その間に同じ題を D にした（サーバーは 9 になった）
     *       ↓ 版数を取り直して 9 で再送すると
     * 結果  CAS が通り、**他人の変更 D を黙って上書きする**
     * ```
     *
     * 5 のまま送れば stale として弾かれ、突き合わせへ回る。
     * **競合を検出できることこそが、版数を控えておく理由。**
     */
    test('⚠️ 題: 控えたときの版数と「見ていた値」を保つ', () => {
      const entry: PendingWrite = {
        ...base,
        field: 'title',
        title: 'C',
        baseRevision: '5',
      };

      expect(toWritePlan(entry)).toEqual({
        field: 'title',
        title: 'C',
        baseRevision: '5',
      });
    });

    test('⚠️ ゴミ箱: 控えたときの版数と「見ていた値」を保つ', () => {
      const entry: PendingWrite = {
        ...base,
        field: 'trash',
        trash: true,
        baseRevision: '7',
      };

      expect(toWritePlan(entry)).toEqual({
        field: 'trash',
        trash: true,
        baseRevision: '7',
      });
    });

    /**
     * ⚠️ タグは操作型なので版数を持たない（7.5.10）。
     * 足す・外すをそのまま送る。他人が付けたタグは触らない。
     */
    test('⚠️ タグ: 足す・外すをそのまま送る（版数を持たない）', () => {
      const entry: PendingWrite = {
        ...base,
        field: 'tags',
        add: ['z'],
        remove: ['x'],
      };

      expect(toWritePlan(entry)).toEqual({
        field: 'tags',
        add: ['z'],
        remove: ['x'],
      });
      expect(toWritePlan(entry)).not.toHaveProperty('baseRevision');
    });
  });

  describe('どの控えを送るか', () => {
    const keyOf = (e: { docId: string; field: string }) =>
      `${e.docId}:${e.field}`;
    const none = new Set<string>();

    const title = (docId: string): PendingWrite => ({
      ...base,
      docId,
      field: 'title',
      title: 'C',
      baseRevision: '5',
    });

    test('控えがあれば送る', () => {
      const entries = [title('d1'), title('d2')];
      expect(selectResendable(entries, none, keyOf)).toEqual(entries);
    });

    /**
     * ⚠️ **送るものが無い控えを送らないこと。**
     * 打ち消し合って空になったタグ操作を送ると、
     * **版数が上がるだけで全員のキャッシュが失効する**。
     */
    test('⚠️ 空のタグ操作は送らない', () => {
      const empty: PendingWrite = {
        ...base,
        field: 'tags',
        add: [],
        remove: [],
      };
      expect(selectResendable([empty], none, keyOf)).toEqual([]);
    });

    test('中身のあるタグ操作は送る', () => {
      const entry: PendingWrite = {
        ...base,
        field: 'tags',
        add: [],
        remove: ['x'],
      };
      expect(selectResendable([entry], none, keyOf)).toEqual([entry]);
    });

    /**
     * ⚠️ **送信中のものを二重に積まないこと。**
     * 契機は複数ある（起動・オンライン復帰・取り直し）ので、
     * 重なると同じ値を2回送って**版数が無駄に上がる**。
     */
    test('⚠️ すでに送信中の控えは積み直さない', () => {
      const entries = [title('d1'), title('d2')];
      const inFlight = new Set(['d1:title']);

      expect(selectResendable(entries, inFlight, keyOf)).toEqual([title('d2')]);
    });

    /**
     * ⚠️ 送信中かどうかは**フィールドまで見る**。
     * ドキュメントで判定すると、題を送っている間にタグの再送が止まる。
     */
    test('⚠️ 同じドキュメントでもフィールドが違えば送る', () => {
      const tags: PendingWrite = {
        ...base,
        field: 'tags',
        add: ['z'],
        remove: [],
      };
      const inFlight = new Set(['d1:title']);

      expect(selectResendable([title('d1'), tags], inFlight, keyOf)).toEqual([
        tags,
      ]);
    });

    test('控えが無ければ何も送らない', () => {
      expect(selectResendable([], none, keyOf)).toEqual([]);
    });
  });

  /**
   * ⚠️ 送信は順番待ちを挟むため、その間に利用者が変わり得る。
   *
   * ```
   * 利用者A  題を変更（送信待ちに積まれる）
   *          ↓ 送信前にサインアウトし、利用者B がサインイン
   * 送信      this.userId を読むと B → **A の変更を B の名義で送る**
   * 控えの削除 B の同じ鍵の控えを消す → **B の未送信の変更が消える**
   * ```
   */
  describe('送り主が変わっていないか', () => {
    test('⚠️ 別の利用者に変わっていたら食い違いとする', () => {
      expect(ownerChanged('u1', 'u2')).toBe(true);
    });

    /**
     * ⚠️ **サインアウトも食い違いとして扱うこと。**
     * 未設定なら誰の名義でも送ってよい、とはならない。
     */
    test('⚠️ サインアウトしていたら食い違いとする', () => {
      expect(ownerChanged('u1', undefined)).toBe(true);
    });

    test('⚠️ 未サインインで積んだあとサインインしたら食い違いとする', () => {
      expect(ownerChanged(undefined, 'u1')).toBe(true);
    });

    test('同じ利用者なら食い違わない', () => {
      expect(ownerChanged('u1', 'u1')).toBe(false);
    });

    test('どちらも未設定なら食い違わない', () => {
      expect(ownerChanged(undefined, undefined)).toBe(false);
    });
  });

  /**
   * ⚠️ **受理されたからといって、控えを無条件に消してはいけない。**
   *
   * ```
   * 再送      控えを読んで "オフ" を送る
   * 利用者    送信中に打ち進めて、控えが "オフラインで変えた題" になる
   *           ↓ "オフ" が受理された
   * 無条件に消す → **打ち進めた分が、送られないまま消える**（原則2に反する）
   * ```
   */
  describe('控えを消してよいか', () => {
    const title = (t: string): PendingWrite => ({
      ...base,
      field: 'title',
      title: t,
      baseRevision: '5',
    });

    test('送ったものと同じなら消してよい', () => {
      expect(samePending(title('オフ'), title('オフ'))).toBe(true);
    });

    test('⚠️ 送信中に打ち進めていたら消さない', () => {
      expect(samePending(title('オフラインで変えた題'), title('オフ'))).toBe(false);
    });

    test('フィールドが違えば別物', () => {
      const trash: PendingWrite = {
        ...base,
        field: 'trash',
        trash: true,
        baseRevision: '5',
      };
      expect(samePending(title('オフ'), trash)).toBe(false);
    });

    describe('タグ', () => {
      const tags = (add: string[], remove: string[]): PendingWrite => ({
        ...base,
        field: 'tags',
        add,
        remove,
      });

      /** ⚠️ 順序は問わない（集合として同じかを見る） */
      test('⚠️ 順序が違っても同じとみなす', () => {
        expect(samePending(tags(['z', 'w'], []), tags(['w', 'z'], []))).toBe(true);
      });

      test('⚠️ 送信中にタグを足していたら消さない', () => {
        expect(samePending(tags(['z', 'w'], []), tags(['z'], []))).toBe(false);
      });

      test('外す側が違えば別物', () => {
        expect(samePending(tags([], ['x']), tags([], ['y']))).toBe(false);
      });
    });
  });
});

import { describe, expect, test } from 'vitest';

import {
  isEmptyPending,
  mergePending,
  mergeTagOps,
} from '../merge-pending';
import type { PendingWrite } from '../stores/pending-write';

/**
 * #151 段階3: **未送信の変更を1つにまとめる**（7.5.8）。
 *
 * ⚠️ ここで守っているのは、**間違えると利用者の変更が消える**性質のもの。
 *
 * - `tags` は**操作を積み重ねる**（後勝ちにすると先の操作が消える・#164 と同型）
 * - 値型は**後勝ちでよい**が、**基準の版数は最初のもの**を使う
 *   （途中の版数はサーバーに存在しない）
 */
describe('#151 段階3 未送信の変更のまとめ方', () => {
  const target = {
    workspaceId: 'ws',
    userId: 'u',
    docId: 'd',
  };

  const title = (t: string, rev = '0'): PendingWrite => ({
    ...target,
    field: 'title',
    title: t,
    baseRevision: rev,
  });

  const tags = (add: string[], remove: string[]): PendingWrite => ({
    ...target,
    field: 'tags',
    add,
    remove,
  });

  describe('タグは操作を積み重ねる', () => {
    /**
     * ⚠️ **後勝ちにしないこと。** 「z を足す」→「x を外す」と操作したなら、
     * 両方送る必要がある。後勝ちだと先の操作が消える（#164 と同じ形）。
     */
    test('⚠️ 別のタグへの操作は両方残る', () => {
      const merged = mergePending(tags(['z'], []), tags([], ['x']));
      expect(merged).toMatchObject({ add: ['z'], remove: ['x'] });
    });

    test('足すを2回なら、両方残る', () => {
      expect(mergeTagOps({ add: ['z'], remove: [] }, { add: ['w'], remove: [] })).toEqual(
        { add: ['z', 'w'], remove: [] }
      );
    });

    /**
     * ⚠️ **打ち消し合う操作は相殺すること。**
     * 「足して外した」を両方送ると、サーバーで2回書き込みが起き、
     * **版数が無駄に上がって全員のキャッシュが失効する**。
     *
     * ⚠️ 残すのは**あとの操作**。未送信の `add` が届いていないからといって、
     * サーバーにそのタグが無いとは限らない（他人が付けていることがある）。
     * `remove` まで落とすと**利用者の「外す」意図が消える**。
     */
    test('⚠️ 足したあと外したなら、残るのは「外す」', () => {
      expect(mergeTagOps({ add: ['z'], remove: [] }, { add: [], remove: ['z'] })).toEqual(
        { add: [], remove: ['z'] }
      );
    });

    test('⚠️ 外したあと足したなら、足すだけが残る', () => {
      expect(mergeTagOps({ add: [], remove: ['z'] }, { add: ['z'], remove: [] })).toEqual(
        { add: ['z'], remove: [] }
      );
    });

    test('同じ操作を繰り返しても増えない', () => {
      expect(mergeTagOps({ add: ['z'], remove: [] }, { add: ['z'], remove: [] })).toEqual(
        { add: ['z'], remove: [] }
      );
    });
  });

  describe('値型は後勝ち', () => {
    test('最後の値を送る', () => {
      const merged = mergePending(title('B'), title('C'));
      expect(merged).toMatchObject({ title: 'C' });
    });

    /**
     * ⚠️ **基準の版数は最初の控えのものを使うこと。**
     *
     * 途中の版数はサーバーへ届いていないので存在しない。
     * 2回目の版数を使うと、サーバーが知らない版数を基準にすることになり、
     * **必ず stale になって届かない**。
     */
    test('⚠️ 基準の版数は最初のものを使う', () => {
      const merged = mergePending(title('B', '5'), title('C', '9'));
      expect(merged).toMatchObject({ baseRevision: '5' });
    });

    /**
     * ⚠️ 移行期間は「見ていた値」も最初のものを引き継いでいたが、
     * **撤去した**（7.7.5）。基準は版数だけ。
     */
    test('⚠️ 見ていた値は持たない（版数だけが基準）', () => {
      const merged = mergePending(title('B', '0'), title('C', '0'));
      expect(merged).not.toHaveProperty('observedTitle');
      expect(merged).toMatchObject({ baseRevision: '0', title: 'C' });
    });
  });

  describe('控えが無い場合', () => {
    test('そのまま新しい控えになる', () => {
      expect(mergePending(undefined, title('B'))).toEqual(title('B'));
    });
  });

  describe('空になった控え', () => {
    /**
     * ⚠️ 送るものが無いなら控えごと捨てる。
     * 送ると版数が上がるだけで、全員のキャッシュが無駄に失効する。
     */
    test('⚠️ タグの操作が空なら「送るものが無い」と分かる', () => {
      expect(isEmptyPending(tags([], []))).toBe(true);
      expect(isEmptyPending(tags(['z'], []))).toBe(false);
    });

    test('値型は空にならない（必ず送る値がある）', () => {
      expect(isEmptyPending(title('B'))).toBe(false);
    });
  });
});

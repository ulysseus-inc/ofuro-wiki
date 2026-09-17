import { describe, expect, test } from 'vitest';

import {
  pendingKey,
  pendingScopePrefix,
  selectPendingKeys,
} from '../pending-key';

/**
 * #151 段階3: **未送信の変更をどの鍵に置くか**（7.5.8 / 7.5.9）。
 *
 * ⚠️ ここで検査しているのは**鍵の分け方**。
 * 間違えると、そのまま「利用者の変更が消える」不具合になる。
 */
describe('#151 段階3 未送信の変更の鍵', () => {
  const target = {
    workspaceId: 'ws',
    userId: 'u1',
    docId: 'd1',
    field: 'title',
  };

  test('同じ対象なら同じ鍵になる', () => {
    expect(pendingKey(target)).toBe(pendingKey({ ...target }));
  });

  /**
   * ⚠️ **フィールドごとに別の鍵にすること。**
   * 1つにまとめると、題とタグを続けて変えたときに
   * **後に書いたほうが勝ち、片方が消える**（7.5.9）。
   * `AsyncMemento.set` は値をまるごと置き換えるだけでマージしない。
   */
  test('⚠️ フィールドが違えば別の鍵になる', () => {
    expect(pendingKey({ ...target, field: 'tags' })).not.toBe(
      pendingKey(target)
    );
    expect(pendingKey({ ...target, field: 'trash' })).not.toBe(
      pendingKey(target)
    );
  });

  /**
   * ⚠️ **鍵に `userId` を含めること。**
   * 含めないと、共用 PC で別の利用者の未送信分を
   * 自分の名前で送ってしまう。
   */
  test('⚠️ 利用者が違えば別の鍵になる', () => {
    expect(pendingKey({ ...target, userId: 'u2' })).not.toBe(
      pendingKey(target)
    );
  });

  test('ワークスペースが違えば別の鍵になる', () => {
    expect(pendingKey({ ...target, workspaceId: 'ws2' })).not.toBe(
      pendingKey(target)
    );
  });

  test('ドキュメントが違えば別の鍵になる', () => {
    expect(pendingKey({ ...target, docId: 'd2' })).not.toBe(pendingKey(target));
  });

  /**
   * ⚠️ **スナップショットと同じ鍵に同居させないこと。**
   * 原則3 によりスナップショットは丸ごと入れ替わるため、
   * 同居させると**入れ替えのたびに未送信分が消える**（7.5.8）。
   */
  test('⚠️ 未送信分だと分かる接頭辞を持つ', () => {
    expect(pendingKey(target).startsWith('discovery:pending:')).toBe(true);
  });

  describe('まとめて取り出す鍵の選び方', () => {
    const keys = [
      pendingKey({ ...target, docId: 'd1' }),
      pendingKey({ ...target, docId: 'd2', field: 'tags' }),
      pendingKey({ ...target, userId: 'u2', docId: 'd3' }),
      pendingKey({ ...target, workspaceId: 'ws2', docId: 'd4' }),
    ];

    /**
     * ⚠️ **他の利用者・他のワークスペースの分を混ぜないこと。**
     * 復帰時にまとめて送るため、混ざるとそのまま誤送信になる。
     */
    test('⚠️ 自分の・そのワークスペースの分だけ選ぶ', () => {
      const selected = selectPendingKeys(keys, {
        workspaceId: 'ws',
        userId: 'u1',
      });
      expect(selected).toEqual([keys[0], keys[1]]);
    });

    /**
     * ⚠️ **同じキャッシュには別のものが同居している。**
     * 前方一致を緩めると、関係ない鍵を未送信分として送ろうとする。
     */
    test('⚠️ 関係ない鍵は選ばない', () => {
      const selected = selectPendingKeys(
        [...keys, 'discovery:snapshot:ws:u1', 'affine:something'],
        { workspaceId: 'ws', userId: 'u1' }
      );
      expect(selected).toEqual([keys[0], keys[1]]);
    });

    /**
     * ⚠️ 利用者 ID の前方一致で取りこぼさない・拾いすぎないこと。
     * 区切りを付けないと `u1` の一覧が `u10` の分まで拾う。
     */
    test('⚠️ 似た利用者 ID を拾わない', () => {
      const other = pendingKey({ ...target, userId: 'u10' });
      const selected = selectPendingKeys([...keys, other], {
        workspaceId: 'ws',
        userId: 'u1',
      });
      expect(selected).not.toContain(other);
    });

    test('該当が無ければ空', () => {
      expect(selectPendingKeys(keys, { workspaceId: 'ws9', userId: 'u1' })).toEqual(
        []
      );
    });

    test('接頭辞は利用者とワークスペースまでを含む', () => {
      expect(pendingScopePrefix({ workspaceId: 'ws', userId: 'u1' })).toBe(
        'discovery:pending:ws:u1:'
      );
    });
  });
});

import { describe, expect, test } from 'vitest';

import {
  classifyWriteOutcome,
  shouldDiscardPending,
  shouldKeepPending,
  shouldNotifyUser,
} from '../classify-write-failure';

/**
 * #151 段階3: **書き込みの結果をどう扱うか**（7.5.10）。
 *
 * ⚠️ **「失敗」を1つにまとめると、必ずどちらかの向きに害が出る。**
 *
 * | 誤り | 起きること |
 * |---|---|
 * | 通信不能を「破棄」に寄せる | **通信が切れただけで利用者の変更が消える** |
 * | 権限拒否を「再送」に寄せる | 通らない要求を延々と送り続け、利用者は気づけない |
 * | stale を利用者に見せる | 競合のたびに警告が出て、本当の失敗を見逃す |
 */
describe('#151 段階3 書き込みの失敗の分類', () => {
  const gqlError = (code: string) => ({
    message: 'denied',
    extensions: { code },
  });

  describe('応答が返った場合', () => {
    test('ok は完了', () => {
      expect(classifyWriteOutcome({ result: { status: 'ok' } })).toBe('done');
    });

    test('stale は stale', () => {
      expect(classifyWriteOutcome({ result: { status: 'stale' } })).toBe(
        'stale'
      );
    });

    test('not-found は not-found', () => {
      expect(classifyWriteOutcome({ result: { status: 'not-found' } })).toBe(
        'not-found'
      );
    });

    /**
     * ⚠️ **知らない状態を「捨てる」に倒さないこと。**
     * サーバーが新しい状態を返すようになったとき、
     * **黙って利用者の変更を捨てる**ことになる。
     */
    test('⚠️ 知らない状態は再送に倒す（捨てない）', () => {
      expect(
        classifyWriteOutcome({
          result: { status: 'something-new' as never },
        })
      ).toBe('retry');
    });
  });

  describe('例外が投げられた場合', () => {
    /**
     * ⚠️ **GraphQL の拒否は HTTP 200 で返る。**
     * `extensions.code` を見ないと権限拒否を検出できない
     * （実測: 権限拒否は `FORBIDDEN`）。
     */
    test('⚠️ FORBIDDEN は権限拒否として扱う', () => {
      expect(classifyWriteOutcome({ error: gqlError('FORBIDDEN') })).toBe(
        'forbidden'
      );
    });

    test('UNAUTHENTICATED も権限拒否として扱う', () => {
      expect(classifyWriteOutcome({ error: gqlError('UNAUTHENTICATED') })).toBe(
        'forbidden'
      );
    });

    /**
     * ⚠️ **通信できないだけで捨てないこと。**
     * 捨てると、電波が切れた瞬間の編集が消える。
     */
    test('⚠️ 通信できないときは再送に倒す', () => {
      expect(classifyWriteOutcome({ error: new Error('Network error') })).toBe(
        'retry'
      );
    });

    test('サーバー障害も再送に倒す', () => {
      expect(
        classifyWriteOutcome({
          error: { message: 'boom', extensions: { status: 500 } },
        })
      ).toBe('retry');
    });

    test('応答も例外も無い場合は再送に倒す', () => {
      expect(classifyWriteOutcome({})).toBe('retry');
    });
  });

  describe('未送信分を捨ててよいか', () => {
    /**
     * ⚠️ **再送だけは保持すること。** 原則2（未送信の変更を
     * 暗黙に破棄しない）が守れるかはここで決まる。
     */
    test('⚠️ 再送のときだけ保持する', () => {
      expect(shouldDiscardPending('retry')).toBe(false);
      expect(shouldDiscardPending('done')).toBe(true);
      expect(shouldDiscardPending('stale')).toBe(true);
      expect(shouldDiscardPending('forbidden')).toBe(true);
      expect(shouldDiscardPending('not-found')).toBe(true);
    });
  });

  describe('利用者に伝えるか', () => {
    /**
     * ⚠️ **権限拒否と stale で扱いを分ける。**
     * どちらも未送信分を破棄するが、意味が違う（7.5.10）。
     * - 権限拒否 … 利用者の操作が通らなかった。黙って消してはいけない
     * - stale … 他の変更が先に確定しただけ。競合であってエラーではない
     */
    test('⚠️ 権限拒否だけ伝える', () => {
      expect(shouldNotifyUser('forbidden')).toBe(true);
      expect(shouldNotifyUser('stale')).toBe(false);
      expect(shouldNotifyUser('retry')).toBe(false);
      expect(shouldNotifyUser('done')).toBe(false);
      expect(shouldNotifyUser('not-found')).toBe(false);
    });
  });

  /**
   * ⚠️ **stale の反映は、そのフィールドだけに限ること。**
   *
   * 応答には題とゴミ箱の両方が入っているが、両方を書くと
   * **送信中に利用者が変えた別のフィールドを巻き戻す**
   * （題を送っている間にゴミ箱へ入れた、など）。
   *
   * 段階3 は 7.5.8 以降ずっとフィールド単位で通している。
   */
  describe('stale の反映範囲', () => {
    /** entities/workspace.ts が組み立てるのと同じ規則 */
    const patchFor = (
      field: 'title' | 'trash' | 'tags',
      result: { currentTitle?: string; currentTrash?: boolean }
    ) =>
      field === 'title'
        ? result.currentTitle !== undefined
          ? { title: result.currentTitle }
          : undefined
        : field === 'trash'
          ? result.currentTrash !== undefined
            ? { trash: result.currentTrash }
            : undefined
          : undefined;

    test('⚠️ 題が stale なら、題だけを反映する', () => {
      const patch = patchFor('title', {
        currentTitle: 'サーバーの題',
        currentTrash: true,
      });
      expect(patch).toEqual({ title: 'サーバーの題' });
      expect(patch).not.toHaveProperty('trash');
    });

    test('⚠️ ゴミ箱が stale なら、ゴミ箱だけを反映する', () => {
      const patch = patchFor('trash', {
        currentTitle: 'サーバーの題',
        currentTrash: true,
      });
      expect(patch).toEqual({ trash: true });
      expect(patch).not.toHaveProperty('title');
    });

    /**
     * ⚠️ タグは操作型で版数を見ないため stale にならない（7.5.10）。
     */
    test('タグでは何も反映しない', () => {
      expect(patchFor('tags', { currentTitle: 'x', currentTrash: true })).toBeUndefined();
    });
  });

  /**
   * ⚠️ **実地確認で見つかった不具合**（2026-08-24）。
   * オフラインで題を「オフラインで変えた題」まで打ったのに、
   * 復帰後にサーバーへ届いたのは「オフ」だった。
   *
   * ```
   * 控え     題 = "オフ"（打ち始め）
   * 再送     "オフ" を送る → オフラインなので失敗
   * 利用者   打ち続けて 控え = "オフラインで変えた題" になる
   *          ↓ さきほどの再送の失敗が、いま返ってくる
   * 書き戻し mergePending("オフラインで変えた題", "オフ") → 値型は後勝ち
   * 結果     控えが "オフ" に**巻き戻る**
   * ```
   */
  describe('控えに書き戻すか', () => {
    test('⚠️ 再送の失敗では書き戻さない（古い値で巻き戻る）', () => {
      expect(shouldKeepPending('retry', true)).toBe(false);
    });

    test('新しい変更が送れなかったら書き戻す', () => {
      expect(shouldKeepPending('retry', false)).toBe(true);
    });

    /**
     * 再送は控えを消していない（消すのは受理・拒否・stale のときだけ）ので、
     * そもそも書き戻す必要が無い。
     */
    test('再送以外の結果では書き戻さない', () => {
      for (const outcome of ['done', 'stale', 'forbidden', 'not-found'] as const) {
        expect(shouldKeepPending(outcome, false)).toBe(false);
        expect(shouldKeepPending(outcome, true)).toBe(false);
      }
    });
  });
});

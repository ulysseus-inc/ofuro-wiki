import { describe, expect, test } from 'vitest';

import { decideRootDocState } from '../root-doc-state';

/**
 * #128: **永久にスケルトンのまま、利用者が自力で復旧できない**を直す。
 *
 * ⚠️ ここで守っているのは、**間違えると画面が出ないか、逆に正常な待ちを
 * 「壊れている」と誤って告げる**性質のもの。
 *
 * 詳細は docs/workspace-load-failure.md
 */
describe('ルートドキュメントの読み込み状態（#128）', () => {
  const state = (over: Partial<Parameters<typeof decideRootDocState>[0]> = {}) =>
    decideRootDocState({
      ready: false,
      loaded: true,
      initialSyncDone: true,
      known: false,
      syncRetrying: false,
      ...over,
    });

  test('中身が取り込めていれば ready', () => {
    expect(state({ ready: true })).toBe('ready');
  });

  /**
   * ⚠️ **これが #128 の状態そのもの。**
   * ロードも同期も終わったのに ready にならない。ここを `loading` のままに
   * すると、**スケルトンから永久に出られない**。
   */
  test('⚠️ ロードもサーバーの受け取りも終わって ready でなければ unloadable', () => {
    expect(state()).toBe('unloadable');
  });

  describe('⚠️ まだ待つべき場合（誤って「読み込めない」と言わない）', () => {
    test('手元の保存から取り込めていない', () => {
      expect(state({ loaded: false })).toBe('loading');
    });

    /**
     * ⚠️ **回線が遅いだけの場合がここ。** サーバーの状態を受け取り終えるまで
     * 立たないので、秒数で決め打ちする必要がない。
     *
     * ⚠️ ここを飛ばすと、**サーバーにだけ中身があるワークスペースを新しい
     * 端末で開いたとき**に「読み込めませんでした」と誤って告げる。
     */
    test('⚠️ サーバーの状態をまだ受け取り終えていない', () => {
      expect(state({ initialSyncDone: false })).toBe('loading');
    });

    /** ⚠️ 再試行中は回線の問題。戻れば入ってくる */
    test('⚠️ 同期を再試行中', () => {
      expect(state({ syncRetrying: true })).toBe('loading');
    });

    /**
     * ⚠️ **これが Codex に指摘された穴そのもの。**
     *
     * `initialSyncDone` は「サーバーに何が有るかを知った」時点で立ち、
     * **取りに行くジョブはこれから走る**。ここを待たないと、
     * **サーバーにだけ中身があるワークスペースを新しい端末で開いたとき**に、
     * 正常なワークスペースへ削除ボタン付きの
     * 「読み込めませんでした」を出してしまう。
     */
    test('⚠️ 同期ピアが doc を把握している（＝中身はこれから届く）', () => {
      expect(state({ known: true })).toBe('loading');
    });

    test('待ちの理由が重なっていても loading', () => {
      expect(
        state({
          loaded: false,
          initialSyncDone: false,
          known: true,
          syncRetrying: true,
        })
      ).toBe('loading');
    });
  });

  /** ⚠️ 取り込めているなら、同期の途中でも画面を出す（待たせない） */
  test('⚠️ ready なら、受け取りの途中でも ready', () => {
    expect(
      state({
        ready: true,
        initialSyncDone: false,
        known: true,
        syncRetrying: true,
      })
    ).toBe('ready');
  });
});

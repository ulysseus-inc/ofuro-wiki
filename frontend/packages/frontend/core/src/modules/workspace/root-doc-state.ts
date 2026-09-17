/**
 * ルートドキュメントが「まだ読み込み中」なのか「読み込めなかった」のかを決める（#128）。
 *
 * ⚠️ **画面に条件を書かないこと。** ここ1か所に置く。
 * 詳細は docs/workspace-load-failure.md
 */

export type RootDocLoadState =
  /** 中身が取り込めている。画面を出してよい */
  | 'ready'
  /** まだ待つ。⚠️ 回線が遅いだけの場合もここ */
  | 'loading'
  /**
   * ⚠️ ロードも同期も終わったのに `ready` にならなかった。
   *
   * **「空のワークスペース」とは呼ばない。** いま分かっているきっかけは
   * 初期化の中断だが、`ready` が false になる理由は他にもあり得る。
   * 原因を決めつけず、**状態の名前で扱う**。
   */
  | 'unloadable';

export interface RootDocStateInput {
  /** 中身が取り込めているか */
  ready: boolean;
  /** 手元の保存から取り込み済みか */
  loaded: boolean;
  /**
   * ⚠️ **サーバーの状態を一通り受け取り終えたか**（#128 で同期層に足した）。
   *
   * これが立つまでは「サーバーに何が有るか」を知らない。
   */
  initialSyncDone: boolean;
  /**
   * ⚠️ **この doc の存在を同期ピアが把握しているか**（#128 で同期層に足した）。
   *
   * true なら**中身はこれから届く**ので、まだ待つ。
   */
  known: boolean;
  /** 同期を再試行中か（＝回線の問題） */
  syncRetrying: boolean;
}

/**
 * ⚠️ **秒数で決め打ちしない。**
 *
 * `initialSyncDone` が立つまでは `loading` のままなので、**回線が遅いだけなら
 * 待ち続ける**。時間で切ると、遅い回線を「壊れている」と誤判定する。
 *
 * ⚠️ **`syncing` / `synced` を判定に使わないこと**（実測・2026-09-10）。
 * - 一度も書かれていない doc は同期ピアの管理下に入らないため、
 *   **`syncing` は永久に true のまま**になる
 * - `synced` は `jobMap` が空かどうかを見るので、**接続直後・ジョブが積まれる
 *   前にも true になる**
 *
 * ⚠️ **`initialSyncDone` だけでも足りない。** あれは「サーバーに何が有るかを
 * 知った」時点で立ち、**取りに行くジョブはこれから走る**。`known` を見ないと、
 * サーバーにだけ中身があるワークスペースを新しい端末で開いたときに、その窓で
 * 「読み込めませんでした」と誤って告げる（Codex 指摘・2026-09-10）。
 */
export function decideRootDocState({
  ready,
  loaded,
  initialSyncDone,
  known,
  syncRetrying,
}: RootDocStateInput): RootDocLoadState {
  if (ready) {
    return 'ready';
  }

  // ⚠️ 同期ピアが把握しているなら、中身はこれから届く。待つ
  if (known) {
    return 'loading';
  }

  // ⚠️ 再試行中は「読み込めなかった」と決めない。回線が戻れば入ってくる
  if (!loaded || !initialSyncDone || syncRetrying) {
    return 'loading';
  }

  return 'unloadable';
}

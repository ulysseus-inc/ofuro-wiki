import { classifyFailure } from './decide';
import type { DocMetaWriteResult } from './stores/doc-meta-write';

/**
 * #151 段階3: **書き込みの結果をどう扱うか。**
 *
 * ⚠️ **「失敗」を1つにまとめないこと。** 扱いが正反対になる（7.5.10）。
 *
 * | 結果 | 未送信分 | 画面の値 | 利用者へ伝える |
 * |---|---|---|---|
 * | 成功 | 破棄してよい | そのまま | しない |
 * | 通信できない | **保持して再送** | そのまま | しない |
 * | サーバー障害（5xx） | **保持して再送** | そのまま | しない |
 * | **権限がない** | **破棄** | サーバー値へ戻す | **する** |
 * | **stale** | **破棄** | サーバーの最新値を採用 | しない |
 * | 台帳に行が無い | 破棄 | 再取得する | しない |
 *
 * ⚠️ **権限拒否と stale で扱いを分ける理由。**
 * どちらも未送信分を破棄するが、意味が違う（7.5.10）。
 * - 権限拒否 … **利用者の操作が通らなかった**。黙って消してはいけない
 * - stale … **他の変更が先に確定しただけ**。競合であってエラーではない
 *
 * ⚠️ **判定だけをここに置く**（副作用なし）。DI から切り離すことで、
 * 仕様の中核を単体で検証できる（`decide.ts` / `plan-meta-write.ts` と同じ方針）。
 */
export function classifyWriteOutcome(input: {
  /** 応答が返った場合の中身 */
  result?: DocMetaWriteResult;
  /** 例外が投げられた場合 */
  error?: unknown;
}): WriteOutcome {
  const { result, error } = input;

  if (error !== undefined) {
    // ⚠️ **「拒否された」と「繋がらない」を必ず区別する。**
    // 混ぜると、権限が無いのに再送し続けるか、
    // 通信が切れただけで利用者の変更を捨てることになる
    //
    // ⚠️ GraphQL の拒否は HTTP 200 で返る。`extensions.code` を見る
    // （実測: 権限拒否は `FORBIDDEN`）
    return classifyFailure(error) === 'rejected' ? 'forbidden' : 'retry';
  }

  if (!result) return 'retry';

  switch (result.status) {
    case 'ok':
      return 'done';
    case 'stale':
      return 'stale';
    case 'not-found':
      return 'not-found';
    default:
      // 知らない状態は**捨てない**。再送に倒す
      return 'retry';
  }
}

/**
 * 書き込みのあと何をするか。
 *
 * | | 未送信分 | 画面 | 通知 |
 * |---|---|---|---|
 * | `done` | 破棄 | そのまま | しない |
 * | `retry` | **保持** | そのまま | しない |
 * | `forbidden` | 破棄 | サーバー値へ戻す | **する** |
 * | `stale` | 破棄 | **サーバー値を取ってから**捨てる | しない |
 * | `not-found` | 破棄 | 再取得する | しない |
 */
export type WriteOutcome =
  | 'done'
  | 'retry'
  | 'forbidden'
  | 'stale'
  | 'not-found';

/** 未送信分を捨ててよいか。 */
export function shouldDiscardPending(outcome: WriteOutcome): boolean {
  return outcome !== 'retry';
}

/**
 * 利用者に伝えるべきか。
 *
 * ⚠️ **stale では伝えない。** 競合であってエラーではなく、
 * 毎回出すと「よく分からない警告」に慣れて本当の失敗を見逃す。
 */
export function shouldNotifyUser(outcome: WriteOutcome): boolean {
  return outcome === 'forbidden';
}

/**
 * 送れなかったとき、控えに**書き戻す**必要があるか。
 *
 * ## ⚠️ 再送の失敗では書き戻してはいけない
 *
 * **実地確認で見つかった不具合**（2026-08-24）。オフライン中に題を
 * 「オフラインで変えた題」まで打ったのに、復帰後にサーバーへ届いたのは
 * 「オフ」だった。
 *
 * ```
 * 控え     題 = "オフ"（打ち始め）
 * 再送     "オフ" を送る → オフラインなので失敗
 * 利用者   打ち続けて 控え = "オフラインで変えた題" になる
 *          ↓ さきほどの再送の失敗が、いま返ってくる
 * 書き戻し mergePending("オフラインで変えた題", "オフ") → **値型は後勝ち**
 * 結果     控えが "オフ" に**巻き戻る**
 * ```
 *
 * ⚠️ **再送は控えを消していない**（消すのは受理・拒否・stale のときだけ）。
 * したがって書き戻す必要がそもそも無く、書き戻せば
 * **自分の古い出力を自分の入力に戻す**ことになる。
 *
 * 新しい変更（`resent === false`）はまだ控えていないので、書き戻す。
 */
export function shouldKeepPending(outcome: WriteOutcome, resent: boolean): boolean {
  return outcome === 'retry' && !resent;
}

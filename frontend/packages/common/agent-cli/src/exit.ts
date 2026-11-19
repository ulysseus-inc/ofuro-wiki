/**
 * 標準出力・標準エラーを送り切ってから、プロセスを終える。
 *
 * ⚠️ 終了は必ずここを通す。blocksuite の同期エンジンのタイマーが残り、
 * process.exit しないとプロセスが終わらない（設計書 §3.0）。
 *
 * ⚠️ 書いた直後に process.exit しない（#291）。パイプへの書き込みは、
 * パイプの空き（64KB）を超えた分が後回しになり、exit で捨てられる。
 *
 * ```
 * write(大) ─▶ 64KB はパイプへ・残りは後回し
 * write('', cb) ─▶ 後回しの分が送り終わってから cb（書き込みは順に終わる）
 * ```
 */
/** 送り切るのを待つ上限。読み手が読まないまま止まっていても、ここで終える */
const FLUSH_TIMEOUT_MS = 10_000;

export function exitAfterFlush(code: number): void {
  process.exitCode = code;

  // 読み手が先に閉じた（| head 等）ときの EPIPE で落ちないように。
  // 送れなかった分は捨ててよい（読み手が要らないと言っている）
  process.stdout.on('error', () => {});
  process.stderr.on('error', () => {});

  // 保険: cb が呼ばれない（ストリームが壊れている）ときも、いつかは終える
  setTimeout(() => process.exit(code), FLUSH_TIMEOUT_MS).unref();

  process.stdout.write('', () => {
    process.stderr.write('', () => process.exit(code));
  });
}

import * as fs from 'fs';

/**
 * #139: 非同期な処理の完了を待つための共通処理。
 *
 * ⚠️ **固定時間のスリープで待ってはいけない。**
 *
 * `await new Promise((r) => setTimeout(r, 50))` は、そのときのマシンの負荷で
 * 足りたり足りなかったりする。**他のテストが重い日にだけ落ちる**テストになり、
 * 「再実行すれば通る」という扱いが定着して、やがて本物の失敗も見逃される。
 *
 * 実際に #139 として起票され、#117 で重いテスト（bcrypt を含むもの）を
 * 追加したことで再現した。
 *
 * 条件が満たされるまで短い間隔で調べ、期限までに満たされなければ失敗させる。
 * 速いときは即座に返るため、実行時間はむしろ縮む。
 */

const DEFAULT_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 10;

/** 条件が真になるまで待つ。ならなければ例外。 */
export async function waitFor(
  condition: () => boolean,
  message: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (condition()) return;
    if (Date.now() >= deadline) {
      throw new Error(`${message}（${timeoutMs}ms 待っても満たされなかった）`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

/**
 * ファイルに `needle` が現れるまで待って、中身を返す。
 *
 * ストリームを閉じても、実際にディスクへ書かれるのは非同期である。
 *
 * ⚠️ **「空でなくなったら返す」では駄目。** 理由は2つある。
 *
 * 1. ログファイルは**テストをまたいで追記される**（同じ日付のファイルを共有する）。
 *    空でないことを条件にすると、**前のテストが書いた内容を読んで即座に返る**
 * 2. 書き出しが分割されると、**途中まで書かれた状態**を読んでしまう
 *
 * 「これから書かれるはずの文字列」を指定して待つ。
 */
export async function readWhenContains(
  file: string,
  needle: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  let text = '';
  await waitFor(
    () => {
      if (!fs.existsSync(file)) return false;
      text = fs.readFileSync(file, 'utf-8');
      return text.includes(needle);
    },
    `ログファイルに「${needle}」が現れなかった: ${file}`,
    timeoutMs,
  );
  return text;
}

/** モックが呼ばれるまで待つ（撃ちっぱなしの非同期処理の確認用）。 */
export async function waitForCall(
  mock: { mock: { calls: unknown[] } },
  message: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  await waitFor(() => mock.mock.calls.length > 0, message, timeoutMs);
}

/**
 * 「起きないこと」を確かめる前に、保留中の非同期処理を流しきる。
 *
 * ⚠️ 否定形（`.not.toHaveBeenCalled()`）では `waitForCall` を使えない。
 * 待っても永久に呼ばれないのが期待値だからである。
 *
 * ここは**待ち時間が足りなくても CI が不安定にはならない**
 * （見逃す方向に倒れるだけで、ランダムに落ちることはない）。
 * それでも取りこぼしを減らすため、イベントループを数回まわす。
 */
export async function flushAsync(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

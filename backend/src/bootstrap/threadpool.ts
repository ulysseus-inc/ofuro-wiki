import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Node のスレッドプール（libuv）の大きさを決める。
 *
 * ⚠️ **このモジュールは `main.ts` の一番最初に import すること。**
 * プールは「最初に使われた時点」で確定するため、bcrypt などが
 * 読み込まれた後に設定しても**静かに無視される**（エラーにならない）。
 * 順序は `test/common/threadpool.spec.ts` が守っている。
 *
 * ## なぜ要るか
 *
 * `UV_THREADPOOL_SIZE` の既定は **4**（libuv のハードコード。CPU 数と無関係）。
 * パスワード照合（bcrypt, cost=12）は1回およそ 300ms かかり、
 * **この 4 スレッドを奪い合う**。
 *
 * | 同時ログイン | 最後の利用者の待ち時間（既定=4） |
 * |---|---|
 * | 4 件 | 約 0.3 秒 |
 * | 16 件 | 約 1.2 秒 |
 * | 32 件 | **約 2.5 秒** |
 *
 * 始業時の一斉ログインで実際に起きる。しかも同じプールを
 * ファイル I/O・gzip（画像アップロード、ログ、バックアップ圧縮）が共有するため、
 * それらの最中はログインがさらに遅くなる。
 *
 * ## 値の決め方
 *
 * bcrypt は CPU を使い切るため、**コア数を超えても速くならない**
 * （待ち行列が伸びるだけ）。コア数に合わせるのが妥当。
 */

/** 下限。1〜2 コアの小さなサーバーでも、ログインが直列にならない程度は確保する。 */
const MIN_SIZE = 4;

/**
 * 上限。これ以上増やしてもログインは速くならず、
 * スレッドの取り合いでかえって遅くなる。
 */
const MAX_SIZE = 16;

/**
 * 設定すべき値を返す（副作用なし。テストから検証できるように分けてある）。
 *
 * @param cpuCount CPU コア数
 * @param configured 環境変数で明示指定された値（あれば優先する）
 */
export function resolveThreadPoolSize(
  cpuCount: number,
  configured?: string,
): number {
  // 明示指定を尊重する。運用側が実測して決めた値を上書きしない
  if (configured) {
    const n = Number(configured);
    // ⚠️ 不正な値で 0 や NaN を渡すと Node が既定に戻る。
    // 設定したつもりで効いていない状態になるため、読めない値は捨てる
    if (Number.isInteger(n) && n > 0) return n;
  }

  const cores = Number.isInteger(cpuCount) && cpuCount > 0 ? cpuCount : MIN_SIZE;
  return Math.min(Math.max(cores, MIN_SIZE), MAX_SIZE);
}

/**
 * `.env` から `UV_THREADPOOL_SIZE` だけを先読みする。
 *
 * ⚠️ **`dotenv/config` を待てない。** このモジュールは `main.ts` の
 * 一番最初に読み込まれる必要があり（プールが先に確定してしまうため）、
 * その時点では `.env` がまだ読まれていない。
 *
 * 以前これを怠り、**`.env` に書いても静かに無視される**状態だった
 * （docs/deploy/README.md に「設定できる」と書いてあるのに効かない）。
 * dotenv の副作用（他の変数まで読み込む）を避けるため、この1件だけを拾う。
 */
function readFromDotenv(): string | undefined {
  // 環境変数が既にあれば、そちらが優先（compose / シェルからの指定）
  if (process.env.UV_THREADPOOL_SIZE) return process.env.UV_THREADPOOL_SIZE;

  for (const file of ['.env', path.join('backend', '.env')]) {
    try {
      const full = path.resolve(process.cwd(), file);
      if (!fs.existsSync(full)) continue;
      const text = fs.readFileSync(full, 'utf-8');
      const m = /^\s*UV_THREADPOOL_SIZE\s*=\s*"?([^"\s#]+)"?/m.exec(text);
      if (m) return m[1];
    } catch {
      // 読めなくても既定で動く。ここで落とさない
    }
  }
  return undefined;
}

/**
 * 実際に `process.env` へ設定する。
 *
 * 戻り値は決定した値（起動ログに出すため）。
 */
export function configureThreadPool(): number {
  const size = resolveThreadPoolSize(os.cpus().length, readFromDotenv());
  process.env.UV_THREADPOOL_SIZE = String(size);
  return size;
}

// import された時点で設定する。**import の順序がすべて**（冒頭の注記を参照）
export const THREAD_POOL_SIZE = configureThreadPool();

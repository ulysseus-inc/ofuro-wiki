/**
 * #291: 標準出力をパイプで受けると、64KB で切れていた。
 *
 * パイプへの書き込みは、パイプの空き（64KB）を超えた分が後回しになる。
 * 書き終わる前に process.exit すると、後回しの分が捨てられる。
 * ファイルへの書き込みは同期なので切れない（だから手元では気付きにくい）。
 *
 * このファイル自身を子プロセスとして起こし、パイプで受けて長さを比べる。
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { exitAfterFlush } from '../src/exit';

/** 子プロセスとして起こされたときの印 */
const CHILD = 'OFURO_EXIT_SPEC_CHILD';

/** パイプの空き（64KB）を超える長さ */
const BIG = 200_000;
const CHILD_EXIT_CODE = 3;

if (process.env[CHILD]) {
  // 子: 大きく書いて、すぐ終了を頼む
  process.stdout.write('o'.repeat(BIG));
  process.stderr.write('e'.repeat(BIG));
  exitAfterFlush(CHILD_EXIT_CODE);
} else {
  describe('exitAfterFlush（#291: パイプで出力が切れる）', () => {
    it('標準出力・標準エラーとも、書いた分を全部送ってから終わる', () => {
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
        env: { ...process.env, [CHILD]: '1' },
        maxBuffer: BIG * 2,
      });

      assert.equal(child.stdout.length, BIG);
      assert.equal(child.stderr.length, BIG);
      assert.equal(child.status, CHILD_EXIT_CODE);
    });

    it('読み手が先に閉じても（| head）、落ちずに終わる', async () => {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
        env: { ...process.env, [CHILD]: '1' },
      });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      // 最初の塊だけ読んで閉じる
      child.stdout.once('data', () => child.stdout.destroy());

      const status = await new Promise<number | null>(resolve =>
        child.on('close', code => resolve(code))
      );

      // EPIPE の例外（uncaught）ではなく、頼んだ終了コードで終わる
      assert.equal(status, CHILD_EXIT_CODE);
      assert.doesNotMatch(stderr, /EPIPE|Error/);
    });
  });
}

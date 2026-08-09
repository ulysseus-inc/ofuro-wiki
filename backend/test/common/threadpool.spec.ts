import * as fs from 'fs';
import * as path from 'path';
import {
  resolveThreadPoolSize,
} from '../../src/bootstrap/threadpool';

/**
 * Node のスレッドプール設定。
 *
 * ⚠️ **効かなくなっても誰も気づけない。** エラーは出ず、
 * 「始業時にログインが遅い」という形でしか現れないため、
 * ここで機械的に守る。
 */
describe('スレッドプールの大きさ', () => {
  describe('値の決め方', () => {
    it.each([
      [1, 4],
      [2, 4],
      [4, 4],
      [8, 8],
      [16, 16],
      // ⚠️ コア数を超えて増やしても bcrypt は速くならない（待ち行列が伸びるだけ）
      [64, 16],
    ])('コア数 %s → %s', (cores, expected) => {
      expect(resolveThreadPoolSize(cores)).toBe(expected);
    });

    it('環境変数の明示指定を優先する', () => {
      // 運用側が実測して決めた値を、コア数で上書きしない
      expect(resolveThreadPoolSize(16, '32')).toBe(32);
      expect(resolveThreadPoolSize(16, '2')).toBe(2);
    });

    /**
     * ⚠️ 不正な値をそのまま渡すと Node が既定(4)に戻る。
     * 「設定したつもりで効いていない」状態になるため、読めない値は捨てる。
     */
    it.each(['0', '-1', 'abc', '1.5', ''])(
      '不正な指定 %s は無視してコア数から決める',
      (bad) => {
        expect(resolveThreadPoolSize(8, bad)).toBe(8);
      },
    );

    it('コア数が取れない場合も下限で動く', () => {
      expect(resolveThreadPoolSize(0)).toBe(4);
      expect(resolveThreadPoolSize(NaN)).toBe(4);
    });
  });

  /**
   * ⚠️ **順序がすべて。** プールは「最初に使われた時点」で確定するため、
   * bcrypt などが読み込まれた後に設定しても**静かに無視される**。
   */
  describe('main.ts での読み込み順序', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../src/main.ts'),
      'utf-8',
    );

    it('threadpool が最初の import である', () => {
      const imports = [...source.matchAll(/^import .*?['"](.+?)['"];?$/gm)].map(
        (m) => m[1],
      );
      expect(imports.length).toBeGreaterThan(1);
      expect(imports[0]).toContain('bootstrap/threadpool');
    });

    it('起動時に決定した値を出力する', () => {
      // 効いているかを運用側が確認できないと、遅さの原因を追えない
      expect(source).toContain('THREAD_POOL_SIZE');
    });
  });

  /**
   * ⚠️ **上書き手段が実際に働くこと。**
   *
   * このモジュールは `dotenv/config` より前に読み込まれるため、
   * `.env` は**まだ読まれていない**。それを踏まえずに
   * `process.env` だけを見ていたため、**`.env` に書いても静かに
   * 無視される**状態だった（ドキュメントには「設定できる」と書いてあった）。
   */
  describe('上書きの経路', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    it('.env に書いた値が読める', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-'));
      fs.writeFileSync(path.join(dir, '.env'), 'UV_THREADPOOL_SIZE=7\n');
      const cwd = process.cwd();
      const saved = process.env.UV_THREADPOOL_SIZE;
      try {
        process.chdir(dir);
        delete process.env.UV_THREADPOOL_SIZE;
        // モジュールを読み直して、.env 先読みの経路を通す
        jest.resetModules();
        const mod = require('../../src/bootstrap/threadpool');
        expect(mod.configureThreadPool()).toBe(7);
      } finally {
        process.chdir(cwd);
        if (saved) process.env.UV_THREADPOOL_SIZE = saved;
      }
    });

    it('環境変数が .env より優先される（compose 経由）', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-'));
      fs.writeFileSync(path.join(dir, '.env'), 'UV_THREADPOOL_SIZE=7\n');
      const cwd = process.cwd();
      const saved = process.env.UV_THREADPOOL_SIZE;
      try {
        process.chdir(dir);
        process.env.UV_THREADPOOL_SIZE = '9';
        jest.resetModules();
        const mod = require('../../src/bootstrap/threadpool');
        expect(mod.configureThreadPool()).toBe(9);
      } finally {
        process.chdir(cwd);
        if (saved) process.env.UV_THREADPOOL_SIZE = saved;
        else delete process.env.UV_THREADPOOL_SIZE;
      }
    });

    /** ⚠️ Docker では compose が渡せないと上書き手段が無くなる。 */
    it('compose が .env から受け取っている', () => {
      const compose = fs.readFileSync(
        path.join(__dirname, '../../../docker-compose.yml'),
        'utf-8',
      );
      expect(compose).toContain('UV_THREADPOOL_SIZE: ${UV_THREADPOOL_SIZE');
    });
  });

  /**
   * 実際にプールが広がっていること。
   *
   * ⚠️ 単体テストは `main.ts` を通らないため、ここでは
   * **設定が反映される仕組み自体**を確認する。
   */
  it('process.env に反映されている', () => {
    // import した時点で設定される
    const value = process.env.UV_THREADPOOL_SIZE;
    expect(value).toBeDefined();
    expect(Number(value)).toBeGreaterThanOrEqual(4);
  });
});

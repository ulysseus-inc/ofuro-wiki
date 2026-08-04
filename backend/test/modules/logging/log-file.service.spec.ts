import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as zlib from 'zlib';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofuro-logs-'));
process.env.LOG_STORAGE_PATH = tmpDir;
process.env.LOG_RETENTION_DAYS = '90';

import { LogFileService } from '../../../src/modules/logging/log-file.service';
import { readWhenContains } from '../../helpers/wait-for';

/** 指定日数前の日付のログファイルを作る */
function makeLogFile(kind: string, daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const name = `${kind}-${d.toISOString().slice(0, 10)}.log`;
  fs.writeFileSync(path.join(tmpDir, name), 'x\n');
  return name;
}

describe('LogFileService (#90)', () => {
  let service: LogFileService;

  beforeEach(() => {
    for (const f of fs.readdirSync(tmpDir)) {
      fs.unlinkSync(path.join(tmpDir, f));
    }
    service = new LogFileService();
  });

  afterEach(() => service.onModuleDestroy());

  it('日付ごとのファイルへ追記する', async () => {
    service.write('access', 'line-1');
    service.write('access', 'line-2');
    service.onModuleDestroy();

    const today = new Date().toISOString().slice(0, 10);
    const file = path.join(tmpDir, `access-${today}.log`);
    // 分割して書かれる可能性があるため、最後の行が現れるまで待つ
    expect(await readWhenContains(file, 'line-2')).toBe('line-1\nline-2\n');
  });

  it('種別ごとに別のファイルへ書く', async () => {
    service.write('access', 'a');
    service.write('app', 'b');
    service.onModuleDestroy();

    const today = new Date().toISOString().slice(0, 10);
    expect(
      await readWhenContains(path.join(tmpDir, `access-${today}.log`), 'a'),
    ).toBe('a\n');
    expect(
      await readWhenContains(path.join(tmpDir, `app-${today}.log`), 'b'),
    ).toBe('b\n');
  });

  // 「90日保持しています」と言える状態にするのが目的（docs/logging.md 5章）
  it('保持期間を過ぎたファイルだけ削除する', () => {
    const old1 = makeLogFile('access', 91);
    const old2 = makeLogFile('app', 200);
    const keep1 = makeLogFile('access', 89);
    const keep2 = makeLogFile('app', 1);

    const deleted = service.cleanupOldLogs();

    expect(deleted).toBe(2);
    expect(fs.existsSync(path.join(tmpDir, old1))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, old2))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, keep1))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, keep2))).toBe(true);
  });

  it('境界（ちょうど90日前）は残す', () => {
    const boundary = makeLogFile('access', 90);
    service.cleanupOldLogs();
    expect(fs.existsSync(path.join(tmpDir, boundary))).toBe(true);
  });

  // 想定外のファイルを消すと、同じディレクトリに置かれた別の資産を壊す
  it('ログ以外のファイルは削除しない', () => {
    fs.writeFileSync(path.join(tmpDir, 'README.txt'), 'keep me');
    fs.writeFileSync(path.join(tmpDir, 'access-not-a-date.log'), 'keep me');

    service.cleanupOldLogs();

    expect(fs.existsSync(path.join(tmpDir, 'README.txt'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'access-not-a-date.log'))).toBe(true);
  });

  describe('圧縮', () => {
    it('前日以前のログを gzip 圧縮し、元ファイルを消す', () => {
      const old = makeLogFile('access', 3);

      const compressed = service.compressOldLogs();

      expect(compressed).toBe(1);
      expect(fs.existsSync(path.join(tmpDir, old))).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, `${old}.gz`))).toBe(true);
    });

    it('圧縮しても中身が読める', () => {
      const name = makeLogFile('app', 2);
      fs.writeFileSync(path.join(tmpDir, name), 'hello\nworld\n');

      service.compressOldLogs();

      const restored = zlib
        .gunzipSync(fs.readFileSync(path.join(tmpDir, `${name}.gz`)))
        .toString();
      expect(restored).toBe('hello\nworld\n');
    });

    // 書き込み中のファイルを圧縮すると、以降の追記が失われる
    it('当日分は圧縮しない', () => {
      const today = makeLogFile('access', 0);
      expect(service.compressOldLogs()).toBe(0);
      expect(fs.existsSync(path.join(tmpDir, today))).toBe(true);
    });

    it('すでに圧縮済みのものは二重に処理しない', () => {
      makeLogFile('access', 3);
      service.compressOldLogs();
      expect(service.compressOldLogs()).toBe(0);
    });

    it('ログ以外のファイルは圧縮しない', () => {
      fs.writeFileSync(path.join(tmpDir, 'README.txt'), 'keep');
      service.compressOldLogs();
      expect(fs.existsSync(path.join(tmpDir, 'README.txt'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'README.txt.gz'))).toBe(false);
    });

    // 圧縮済みも保持期間の対象。消し漏れると際限なく溜まる
    it('圧縮済みのファイルも保持期間で削除される', () => {
      const old = makeLogFile('access', 100);
      service.compressOldLogs();
      expect(fs.existsSync(path.join(tmpDir, `${old}.gz`))).toBe(true);

      const deleted = service.cleanupOldLogs();

      expect(deleted).toBe(1);
      expect(fs.existsSync(path.join(tmpDir, `${old}.gz`))).toBe(false);
    });

    it('日次処理は圧縮と削除の両方を行う', () => {
      makeLogFile('access', 3);
      makeLogFile('app', 100);

      const result = service.maintainLogs();

      // 100日前のものは圧縮された後、同じ実行で削除される
      expect(result.compressed).toBe(2);
      expect(result.deleted).toBe(1);
    });
  });

  describe('開きっぱなしのストリーム', () => {
    // ストリームは書き込み時にしか開き直さない。日付が変わっても書き込みが
    // 無ければ前日のファイルを掴んだままで、それを圧縮・削除すると
    // 以降の書き込みが削除済みの inode へ流れて黙って失われる
    it('日付をまたいだ後の書き込みが、圧縮後も失われない', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yName = `access-${yesterday.toISOString().slice(0, 10)}.log`;

      // 「前日のファイルを掴んだまま日付が変わった」状態を作る
      (service as any).streams.set('access', {
        date: yesterday.toISOString().slice(0, 10),
        stream: fs.createWriteStream(path.join(tmpDir, yName), { flags: 'a' }),
      });

      service.compressOldLogs();

      // 圧縮後に書いた内容が、当日のファイルへ入ること
      service.write('access', 'after-rotation');
      service.onModuleDestroy();

      const today = new Date().toISOString().slice(0, 10);
      const todayFile = path.join(tmpDir, `access-${today}.log`);
      expect(await readWhenContains(todayFile, 'after-rotation')).toContain(
        'after-rotation',
      );
    });

    it('削除時も掴んだままのストリームを閉じる', () => {
      const old = new Date();
      old.setDate(old.getDate() - 100);
      const name = `app-${old.toISOString().slice(0, 10)}.log`;
      fs.writeFileSync(path.join(tmpDir, name), 'x\n');
      (service as any).streams.set('app', {
        date: old.toISOString().slice(0, 10),
        stream: fs.createWriteStream(path.join(tmpDir, name), { flags: 'a' }),
      });

      service.cleanupOldLogs();

      expect((service as any).streams.has('app')).toBe(false);
    });
  });

  describe('書き込み失敗時の扱い', () => {
    // 失敗を Logger で報告すると、それが FileLogger を通って write() を
    // 呼び戻す。streamFor() が同期で失敗し続ける状況では無限再帰になる
    it('書き込めない状況でも落ちず、要求を失敗させない', () => {
      jest
        .spyOn(service as any, 'streamFor')
        .mockImplementation(() => {
          throw new Error('EACCES: permission denied');
        });
      const stderr = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      expect(() => service.write('app', 'x')).not.toThrow();
      // 報告は1回だけ（再入して積み上がらないこと）
      expect(stderr).toHaveBeenCalledTimes(1);

      stderr.mockRestore();
      (service as any).streamFor.mockRestore();
    });

    it('報告は Nest の Logger を経由しない（書き戻しを避けるため）', () => {
      jest.spyOn(service as any, 'streamFor').mockImplementation(() => {
        throw new Error('ENOSPC: no space left on device');
      });
      const stderr = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);
      const warn = jest.spyOn((service as any).logger, 'warn');

      service.write('access', 'x');

      expect(warn).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalled();

      warn.mockRestore();
      stderr.mockRestore();
      (service as any).streamFor.mockRestore();
    });
  });

  it('ディレクトリが無くても落ちない', () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    expect(() => service.cleanupOldLogs()).not.toThrow();
    fs.mkdirSync(tmpDir, { recursive: true });
  });
});

describe('resolveLogLevels (#90)', () => {
  const original = process.env.LOG_LEVEL;
  afterEach(() => {
    if (original === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = original;
  });

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { resolveLogLevels } = require('../../../src/modules/logging/file-logger');

  it('既定では debug / verbose を出さない', () => {
    delete process.env.LOG_LEVEL;
    expect(resolveLogLevels()).toEqual(['fatal', 'error', 'warn', 'log']);
  });

  it('LOG_LEVEL=debug で詳細を出す', () => {
    process.env.LOG_LEVEL = 'debug';
    expect(resolveLogLevels()).toContain('debug');
    expect(resolveLogLevels()).not.toContain('verbose');
  });

  // fatal を落とすと最も重要なログが消える
  it('どの水準でも fatal は必ず含む', () => {
    for (const level of ['error', 'warn', 'log', 'debug', 'verbose', 'unknown']) {
      process.env.LOG_LEVEL = level;
      expect(resolveLogLevels()).toContain('fatal');
    }
  });

  it('未知の値は既定として扱う（起動を失敗させない）', () => {
    process.env.LOG_LEVEL = 'nonsense';
    expect(resolveLogLevels()).toEqual(['fatal', 'error', 'warn', 'log']);
  });
});

describe('LOG_RETENTION_DAYS の解釈 (#90)', () => {
  const load = (value?: string) => {
    jest.resetModules();
    if (value === undefined) delete process.env.LOG_RETENTION_DAYS;
    else process.env.LOG_RETENTION_DAYS = value;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../../../src/modules/logging/log-file.service')
      .LOG_RETENTION_DAYS;
  };

  afterAll(() => {
    process.env.LOG_RETENTION_DAYS = '90';
  });

  it('未設定なら90日', () => {
    expect(load(undefined)).toBe(90);
  });

  it('数値ならその値', () => {
    expect(load('30')).toBe(30);
  });

  // NaN になると setDate(NaN) -> toISOString() が RangeError を投げ、
  // 日次バッチが毎晩失敗して古いログが消えなくなる
  it.each(['abc', '', '-1', '0', 'NaN'])(
    '不正な値 %s は既定の90日として扱う',
    (value) => {
      expect(load(value)).toBe(90);
    },
  );
});

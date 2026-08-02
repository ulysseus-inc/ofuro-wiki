import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofuro-stack-'));
process.env.LOG_STORAGE_PATH = tmpDir;

import { LogFileService } from '../../../src/modules/logging/log-file.service';
import { FileLogger } from '../../../src/modules/logging/file-logger';

describe('FileLogger の値の整形 (#90)', () => {
  const read = () => {
    const today = new Date().toISOString().slice(0, 10);
    return fs.readFileSync(path.join(tmpDir, `app-${today}.log`), 'utf-8');
  };

  // JSON.stringify は循環参照で例外を投げる。printMessages は write() の
  // try/catch の外側にあるため、logger.log した箇所まで例外が伝わり、
  // ログを出そうとしただけで処理が失敗する
  it('循環参照を含む値でも例外を投げない', async () => {
    const service = new LogFileService();
    FileLogger.attach(service);
    const logger = new FileLogger();

    const circular: any = { name: 'ワークスペース' };
    circular.self = circular;

    expect(() => logger.log(circular)).not.toThrow();

    service.onModuleDestroy();
    await new Promise((r) => setTimeout(r, 50));
    expect(read()).toContain('ワークスペース');
  });

  // JSON.stringify(new Error('x')) は '{}' になり、メッセージが消える
  it('Error を渡してもメッセージが残る', async () => {
    const service = new LogFileService();
    FileLogger.attach(service);
    const logger = new FileLogger();

    logger.log(new Error('接続できませんでした'));

    service.onModuleDestroy();
    await new Promise((r) => setTimeout(r, 50));
    expect(read()).toContain('接続できませんでした');
  });
});

describe('FileLogger のスタックトレース (#90)', () => {
  it('logger.error(message, stack) のスタックがファイルに残る', async () => {
    const service = new LogFileService();
    FileLogger.attach(service);
    const logger = new FileLogger();

    logger.error('何かが壊れました', 'Error: boom\n    at somewhere.ts:42:7');
    service.onModuleDestroy();
    await new Promise((r) => setTimeout(r, 50));

    const today = new Date().toISOString().slice(0, 10);
    const content = fs.readFileSync(
      path.join(tmpDir, `app-${today}.log`),
      'utf-8',
    );
    expect(content).toContain('何かが壊れました');
    // 障害調査で最も必要な情報。落とすと原因が追えない
    expect(content).toContain('at somewhere.ts:42:7');
  });
});

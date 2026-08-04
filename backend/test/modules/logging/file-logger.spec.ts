import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofuro-stack-'));
process.env.LOG_STORAGE_PATH = tmpDir;

import { LogFileService } from '../../../src/modules/logging/log-file.service';
import { FileLogger } from '../../../src/modules/logging/file-logger';
import { readWhenContains } from '../../helpers/wait-for';

describe('FileLogger の値の整形 (#90)', () => {
  // ⚠️ ログファイルはテストをまたいで追記される。「空でないこと」で待つと
  // 前のテストが書いた内容を読んでしまうため、必ず期待する文字列で待つ
  const read = (needle: string) => {
    const today = new Date().toISOString().slice(0, 10);
    return readWhenContains(path.join(tmpDir, `app-${today}.log`), needle);
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
    expect(await read('ワークスペース')).toContain('ワークスペース');
  });

  // JSON.stringify(new Error('x')) は '{}' になり、メッセージが消える
  it('Error を渡してもメッセージが残る', async () => {
    const service = new LogFileService();
    FileLogger.attach(service);
    const logger = new FileLogger();

    logger.log(new Error('接続できませんでした'));

    service.onModuleDestroy();
    expect(await read('接続できませんでした')).toContain('接続できませんでした');
  });
});

describe('FileLogger のスタックトレース (#90)', () => {
  it('logger.error(message, stack) のスタックがファイルに残る', async () => {
    const service = new LogFileService();
    FileLogger.attach(service);
    const logger = new FileLogger();

    logger.error('何かが壊れました', 'Error: boom\n    at somewhere.ts:42:7');
    service.onModuleDestroy();

    const today = new Date().toISOString().slice(0, 10);
    const content = await readWhenContains(
      path.join(tmpDir, `app-${today}.log`),
      'at somewhere.ts:42:7',
    );
    expect(content).toContain('何かが壊れました');
    // 障害調査で最も必要な情報。落とすと原因が追えない
    expect(content).toContain('at somewhere.ts:42:7');
  });
});

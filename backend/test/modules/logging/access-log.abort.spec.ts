import { EventEmitter } from 'events';
import { AccessLogMiddleware } from '../../../src/modules/logging/access-log.middleware';

/** res を模したもの。finish / close を任意に発火できる。 */
class FakeRes extends EventEmitter {
  statusCode = 200;
  writableFinished = false;
}

describe('中断された要求の記録 (#90)', () => {
  const makeReq = (url = '/api/workspaces') =>
    ({
      originalUrl: url,
      method: 'GET',
      ip: '10.0.0.1',
      headers: { 'user-agent': 'curl/8.5.0' },
    }) as any;

  const setup = () => {
    const written: string[] = [];
    const logFile = { write: (_: string, line: string) => written.push(line) };
    return {
      written,
      middleware: new AccessLogMiddleware(logFile as any),
    };
  };

  // 通信断や利用者による中止では finish が起きず close だけが起きる。
  // finish しか購読していないと、走査や中止が1件も残らない
  it('応答を返しきれなかった要求を ABORTED として記録する', () => {
    const { written, middleware } = setup();
    const res = new FakeRes();

    middleware.use(makeReq(), res as any, () => {});
    res.emit('close'); // finish は起きない

    expect(written).toHaveLength(1);
    expect(written[0]).toContain('ABORTED');
    expect(written[0]).toContain('/api/workspaces');
  });

  it('正常終了した要求は通常どおり記録する', () => {
    const { written, middleware } = setup();
    const res = new FakeRes();
    res.statusCode = 200;

    middleware.use(makeReq(), res as any, () => {});
    res.writableFinished = true;
    res.emit('finish');

    expect(written).toHaveLength(1);
    expect(written[0]).toContain(' 200 ');
    expect(written[0]).not.toContain('ABORTED');
  });

  // close は正常終了の後にも起きる。二重に書くと件数が倍になる
  it('finish の後に close が来ても二重に書かない', () => {
    const { written, middleware } = setup();
    const res = new FakeRes();

    middleware.use(makeReq(), res as any, () => {});
    res.writableFinished = true;
    res.emit('finish');
    res.emit('close');

    expect(written).toHaveLength(1);
  });

  // 静的ファイルの読み込み中断まで拾うと、1画面で数百行になる
  it('静的ファイルの中断は記録しない', () => {
    const { written, middleware } = setup();
    const res = new FakeRes();

    middleware.use(makeReq('/js/index.js'), res as any, () => {});
    res.emit('close');

    expect(written).toHaveLength(0);
  });
});

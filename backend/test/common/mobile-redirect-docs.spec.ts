import { MobileRedirectMiddleware } from '../../src/common/middleware/mobile-redirect.middleware';

/** #324: スマホで /docs/ を開いても、スマホ版の画面に差し替えない */
describe('スマホの振り分けとガイド (#324)', () => {
  const MOBILE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

  function run(path: string) {
    const mw = new MobileRedirectMiddleware();
    // スマホ版のビルドがある状態にする
    (mw as unknown as { mobileHtmlContent: string }).mobileHtmlContent = '<html>mobile</html>';

    const res = { setHeader: jest.fn(), send: jest.fn(), type: jest.fn() };
    res.type.mockReturnValue(res);
    const next = jest.fn();
    const req = { path, headers: { accept: 'text/html', 'user-agent': MOBILE_UA } };

    mw.use(req as any, res as any, next);
    return { next, res };
  }

  it.each(['/docs', '/docs/', '/docs/user/editor'])('%s はガイドへ通す', (path) => {
    const { next, res } = run(path);
    expect(next).toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });

  it('画面のパスは、今までどおりスマホ版にする', () => {
    const { next, res } = run('/workspace/abc');
    expect(next).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalled();
  });
});

import {
  clearAllOidcStateCookies,
  oidcStateCookieName,
  setOidcStateCookie,
} from '../../../src/modules/auth/auth-cookie.util';

/**
 * #89: 認証が同時に2つ始まっても、互いを壊さないこと。
 *
 * 開発時の React StrictMode は effect を二重に実行するため、1回のクリックで
 * 認証が2つ始まる。利用者もボタンを2度押す。1つのクッキーを共有していると
 * 先に始めた方の state が消え、「サインインできませんでした」が繰り返される。
 */
describe('OIDC の state クッキー (#89)', () => {
  const makeRes = () => {
    const jar: Record<string, string> = {};
    return {
      jar,
      cookie: jest.fn((name: string, value: string) => {
        jar[name] = value;
      }),
      clearCookie: jest.fn((name: string) => {
        delete jar[name];
      }),
    };
  };

  it('【重要】同時に始まった認証が互いを上書きしない', () => {
    const res = makeRes();

    setOidcStateCookie(res as never, 'state-1');
    setOidcStateCookie(res as never, 'state-2');

    expect(res.jar[oidcStateCookieName('state-1')]).toBe('state-1');
    expect(res.jar[oidcStateCookieName('state-2')]).toBe('state-2');
  });

  it('state ごとに名前が変わる', () => {
    expect(oidcStateCookieName('state-1')).not.toBe(
      oidcStateCookieName('state-2')
    );
    // 同じ state なら同じ名前（コールバックで引けること）
    expect(oidcStateCookieName('state-1')).toBe(oidcStateCookieName('state-1'));
  });

  it('途中で離脱した試行のクッキーもまとめて片付ける', () => {
    // コールバックに到達しなかった試行のクッキーは個別には消えないため、
    // 溜まると Cookie ヘッダが膨らむ
    const res = makeRes();
    const cookies = {
      [oidcStateCookieName('abandoned-1')]: 'abandoned-1',
      [oidcStateCookieName('abandoned-2')]: 'abandoned-2',
      ofuro_token: 'keep-me',
    };

    clearAllOidcStateCookies(res as never, cookies);

    expect(res.clearCookie).toHaveBeenCalledWith(
      oidcStateCookieName('abandoned-1'),
      { path: '/' }
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      oidcStateCookieName('abandoned-2'),
      { path: '/' }
    );
    // 無関係なクッキーは消さない
    expect(res.clearCookie).not.toHaveBeenCalledWith(
      'ofuro_token',
      expect.anything()
    );
  });

  it('httpOnly で発行する（XSS で読み出させない）', () => {
    const res = makeRes();
    setOidcStateCookie(res as never, 'state-1');

    expect(res.cookie).toHaveBeenCalledWith(
      oidcStateCookieName('state-1'),
      'state-1',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' })
    );
  });
});

import { OidcService } from '../../../src/modules/oidc/oidc.service';
import type { OidcConfigService } from '../../../src/modules/oidc/oidc-config.service';

/**
 * #330: 接続テストで、保存済みのクライアント ID とシークレットも確かめる（docs/sso-setup.md）。
 * わざと無効な認可コードで IdP にトークンを求め、答えで見分ける。
 * 応答の形は Keycloak 26.0 と Google の実物（2026-11-11 採取）
 */
describe('接続テスト: クライアント ID とシークレット (#330)', () => {
  const ISSUER = 'https://idp.example.com';
  const TOKEN = 'https://idp.example.com/token';
  const discovery = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: TOKEN,
    jwks_uri: `${ISSUER}/jwks`,
  };

  let credentials: { issuer: string; clientId: string; clientSecret: string } | null;
  let service: OidcService;
  let fetchMock: jest.Mock;

  /** 1 回目はディスカバリ文書、2 回目はトークンの窓口の答え */
  const tokenAnswers = (status: number, body: Record<string, unknown>) => {
    fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => discovery })
      .mockResolvedValueOnce({ ok: status < 400, status, json: async () => body });
    global.fetch = fetchMock as unknown as typeof fetch;
  };

  beforeEach(() => {
    credentials = { issuer: ISSUER, clientId: 'ofuro-wiki', clientSecret: 'dev-client-secret' };
    const configService = {
      getCredentials: jest.fn(async () => credentials),
      getRedirectUri: jest.fn().mockReturnValue('https://wiki.example.com/oauth/callback'),
    };
    service = new OidcService(configService as unknown as OidcConfigService);
  });

  afterEach(() => {
    // @ts-expect-error テスト用に差し替えた fetch を戻す
    delete global.fetch;
  });

  it('正しい: 400 invalid_grant（コードだけが無効）', async () => {
    tokenAnswers(400, { error: 'invalid_grant', error_description: 'Code not valid' });

    const result = await service.testConnection(ISSUER);

    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/正しく受け付けられました/);
    expect(result.message).toMatch(/リダイレクト URI/);
  });

  it.each([
    ['Keycloak のシークレット違い', 401, { error: 'unauthorized_client' }],
    ['Keycloak・Google の ID 違い', 401, { error: 'invalid_client' }],
    ['401 で本文が無い', 401, {}],
    ['400 でも invalid_client', 400, { error: 'invalid_client' }],
  ])('違う: %s', async (_label, status, body) => {
    tokenAnswers(status as number, body);

    const result = await service.testConnection(ISSUER);

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/クライアント ID かシークレットが違います/);
  });

  it('判定できない答えは、状態コードと error をそのまま出す', async () => {
    tokenAnswers(500, { error: 'server_error' });

    const result = await service.testConnection(ISSUER);

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/500/);
    expect(result.message).toMatch(/server_error/);
  });

  it('未保存なら送らない', async () => {
    credentials = null;
    tokenAnswers(400, { error: 'invalid_grant' });

    const result = await service.testConnection(ISSUER);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.message).toMatch(/保存すると確かめられます/);
  });

  it('【重要】保存済みの ID とシークレットを Basic で送り、無効なコードを使う', async () => {
    tokenAnswers(400, { error: 'invalid_grant' });

    await service.testConnection(ISSUER);

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(TOKEN);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(
      'Basic ' + Buffer.from('ofuro-wiki:dev-client-secret').toString('base64'),
    );
    const body = new URLSearchParams(init.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBeTruthy();
  });

  it('【重要】入力中の発行者 URL が保存済みと違えば、シークレットを送らない（抜き取りを防ぐ）', async () => {
    // システム管理者が自分のサーバーを発行者として入れても、保存済みのシークレットは届かない
    const evil = 'https://evil.example';
    fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ...discovery, issuer: evil, token_endpoint: `${evil}/token` }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await service.testConnection(evil);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.message).toMatch(/発行者 URL を保存すると確かめられます/);
  });

  it('【重要】トークンの窓口のリダイレクトは追わない', async () => {
    tokenAnswers(400, { error: 'invalid_grant' });

    await service.testConnection(ISSUER);

    expect(fetchMock.mock.calls[1][1].redirect).toBe('manual');
  });

  it('末尾のスラッシュの違いは、同じ発行者とみなす', async () => {
    tokenAnswers(400, { error: 'invalid_grant' });
    credentials = { ...credentials!, issuer: `${ISSUER}/` };

    const result = await service.testConnection(ISSUER);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('【重要】シークレットを結果に含めない', async () => {
    tokenAnswers(401, { error: 'invalid_client' });

    const result = await service.testConnection(ISSUER);

    expect(JSON.stringify(result)).not.toContain('dev-client-secret');
  });

  it('発行者 URL が取れなければ、トークンの窓口には送らない', async () => {
    fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await service.testConnection(ISSUER);

    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

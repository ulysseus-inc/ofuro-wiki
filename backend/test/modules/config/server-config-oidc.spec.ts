import { ConfigService } from '../../../src/modules/config/config.service';
import type { OidcConfigService } from '../../../src/modules/oidc/oidc-config.service';

/**
 * #89: SSO ボタンの文言は管理画面で設定できる。
 * これが serverConfig で配信されないと、フロントは既定文言
 * （"Continue with OIDC"）のままになり、設定項目が事実上死ぬ。
 */
describe('ConfigService — SSO ボタン文言の配信 (#89)', () => {
  const build = (oidcConfig: any) =>
    new ConfigService(
      {
        serverSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      } as any,
      {
        getConfig: jest.fn().mockResolvedValue(oidcConfig),
      } as unknown as OidcConfigService
    );

  it('設定した文言を返す', async () => {
    const config = await build({
      buttonLabel: 'Keycloak でサインイン',
    }).getServerConfig();

    expect(config.oauthProviders).toContain('OIDC');
    expect(config.oidcButtonLabel).toBe('Keycloak でサインイン');
  });

  it('SSO が無効なら null（フロントは既定文言を使う）', async () => {
    const config = await build(null).getServerConfig();

    expect(config.oauthProviders).toEqual([]);
    expect(config.oidcButtonLabel).toBeNull();
  });
});

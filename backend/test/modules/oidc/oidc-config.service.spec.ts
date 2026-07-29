import {
  OIDC_SETTING_KEYS,
  OidcConfigService,
} from '../../../src/modules/oidc/oidc-config.service';
import type { PrismaService } from '../../../src/prisma.service';
import { encryptSecret } from '../../../src/common/secret-box';

/**
 * #89: OIDC 設定は `.env` ではなく管理画面（DB）に置く。
 * 方針: `.env` は起動に最低限必要なものだけ。機能拡張系の設定は管理画面へ。
 */
describe('OidcConfigService (#89)', () => {
  let service: OidcConfigService;
  let store: Map<string, string>;
  const originalJwt = process.env.JWT_SECRET;
  const originalBase = process.env.BASE_URL;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-jwt-secret-value-for-unit-test-0123456789';
    process.env.BASE_URL = 'https://wiki.example.com';
    store = new Map();

    const prisma = {
      serverSetting: {
        findMany: jest.fn().mockImplementation(async ({ where }: any) => {
          const keys: string[] = where?.key?.in ?? [];
          return keys
            .filter(key => store.has(key))
            .map(key => ({ key, value: store.get(key)! }));
        }),
        upsert: jest.fn().mockImplementation(async ({ where, create }: any) => {
          store.set(where.key, create.value);
          return { key: where.key, value: create.value };
        }),
      },
    };

    service = new OidcConfigService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    if (originalJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwt;
    if (originalBase === undefined) delete process.env.BASE_URL;
    else process.env.BASE_URL = originalBase;
  });

  const setupComplete = async () => {
    await service.updateConfig({
      enabled: true,
      issuer: 'https://accounts.example.com',
      clientId: 'client-123',
      clientSecret: 'super-secret',
    });
  };

  describe('リダイレクトURI', () => {
    it('IdP に登録するURIはフロントの /oauth/callback を指す', () => {
      // /api/oauth/callback ではない（フローの調査で確定）
      expect(service.getRedirectUri()).toBe(
        'https://wiki.example.com/oauth/callback',
      );
    });

    it('BASE_URL 末尾のスラッシュを重複させない', () => {
      process.env.BASE_URL = 'https://wiki.example.com/';
      expect(service.getRedirectUri()).toBe(
        'https://wiki.example.com/oauth/callback',
      );
    });
  });

  describe('設定の読み書き', () => {
    it('必要な項目が揃っていれば有効になる', async () => {
      await setupComplete();

      const config = await service.getConfig();
      expect(config).not.toBeNull();
      expect(config?.clientId).toBe('client-123');
      expect(config?.clientSecret).toBe('super-secret');
    });

    it('【重要】シークレットは暗号化して保存される', async () => {
      await setupComplete();

      const stored = store.get(OIDC_SETTING_KEYS.clientSecret)!;
      expect(stored).not.toContain('super-secret');
      expect(stored.startsWith('enc.v1.')).toBe(true);
    });

    it('【重要】画面向けの応答にシークレットの値を含めない', async () => {
      await setupComplete();

      const view = await service.getConfigView();
      expect(view.clientSecretSet).toBe(true);
      expect(JSON.stringify(view)).not.toContain('super-secret');
    });

    it('シークレット未指定の更新では既存値を維持する', async () => {
      await setupComplete();

      await service.updateConfig({ buttonLabel: 'Google でサインイン' });

      const config = await service.getConfig();
      expect(config?.clientSecret).toBe('super-secret');
      expect(config?.buttonLabel).toBe('Google でサインイン');
    });

    it('明示的な null は「変更なし」として扱う（500 にしない）', async () => {
      // @IsOptional() は null も通すため、!== undefined 判定だと
      // null.trim() で 500 になったり、'null' が保存されたりする
      await setupComplete();

      await service.updateConfig({
        issuer: null,
        clientId: null,
        buttonLabel: null,
        emailClaims: null,
        enabled: null,
        autoCreateUser: null,
      } as any);

      const config = await service.getConfig();
      expect(config?.issuer).toBe('https://accounts.example.com');
      expect(config?.clientId).toBe('client-123');
      expect(config?.autoCreateUser).toBe(false);
    });

    it('【重要】空白だけのシークレットで既存値を消さない', async () => {
      // trim 後に空になる入力を「変更あり」と判定すると、既存のシークレットを
      // 空で上書きし、SSO が無言で無効になる（原因が分かりにくい）
      await setupComplete();

      await service.updateConfig({ clientSecret: '   ' });

      expect((await service.getConfig())?.clientSecret).toBe('super-secret');
    });
  });

  describe('無効として扱う条件', () => {
    it('enabled が false なら null', async () => {
      await setupComplete();
      await service.updateConfig({ enabled: false });

      expect(await service.getConfig()).toBeNull();
    });

    it('中途半端な設定の警告を、呼び出しのたびに出さない', async () => {
      // getConfig() は未認証のサーバー設定取得からも呼ばれるため、
      // 毎回 warn するとページ表示のたびにログが埋まる
      const warn = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => {});

      await service.updateConfig({
        enabled: true,
        issuer: 'https://accounts.example.com',
        clientId: 'client-123',
      });

      await service.getConfig();
      await service.getConfig();
      await service.getConfig();

      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it('項目が欠けている場合は有効にしない（中途半端な状態でボタンを出さない）', async () => {
      await service.updateConfig({
        enabled: true,
        issuer: 'https://accounts.example.com',
        clientId: 'client-123',
        // clientSecret が無い
      });

      expect(await service.getConfig()).toBeNull();
    });

    it('JWT_SECRET が変わって復号できない場合も無効として扱う', async () => {
      await setupComplete();

      process.env.JWT_SECRET = 'a-totally-different-secret-value-0123456789';

      expect(await service.getConfig()).toBeNull();
    });

    it('【重要】復号できない場合、画面上も「未設定」と表示する', async () => {
      // 「暗号文の有無」で判定すると、JWT_SECRET 変更後に
      // 「設定済みなのにボタンが出ない」という分かりにくい状態になる
      await setupComplete();
      expect((await service.getConfigView()).clientSecretSet).toBe(true);

      process.env.JWT_SECRET = 'a-totally-different-secret-value-0123456789';

      expect((await service.getConfigView()).clientSecretSet).toBe(false);
    });
  });

  describe('メールクレームの解決', () => {
    it('【重要】既定は email のみ', async () => {
      // preferred_username / upn を既定に含めると、利用者が自分で値を
      // 設定できる IdP で他人のアドレスを名乗れてしまう（乗っ取り）。
      // 必要な場合は管理者が明示的に追加する。
      await setupComplete();

      const config = await service.getConfig();
      expect(config?.emailClaims).toEqual(['email']);
    });

    it('管理画面から指定できる（Entra ID 対策）', async () => {
      await setupComplete();
      await service.updateConfig({ emailClaims: 'upn, email' });

      const config = await service.getConfig();
      expect(config?.emailClaims).toEqual(['upn', 'email']);
    });
  });
});

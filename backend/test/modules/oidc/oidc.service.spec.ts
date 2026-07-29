import { UnauthorizedException } from '@nestjs/common';
import { OidcService } from '../../../src/modules/oidc/oidc.service';
import type { OidcConfigService } from '../../../src/modules/oidc/oidc-config.service';

/**
 * #89: OIDC 認証処理のうち、**外部通信なしで検証できる防御**のテスト。
 *
 * ID Token の検証そのものは jose に委ねているため、ここでは
 * 「呼び出し側で守るべき部分」を対象にする。
 */
describe('OidcService — ログインCSRF対策とクレーム検証 (#89)', () => {
  let service: OidcService;

  const config = {
    enabled: true,
    issuer: 'https://idp.example.com',
    clientId: 'client-1',
    clientSecret: 'secret',
    buttonLabel: 'SSO',
    emailClaims: ['email'],
    autoCreateUser: false,
  };

  beforeEach(() => {
    const configService = {
      getConfig: jest.fn().mockResolvedValue(config),
      getRedirectUri: jest.fn().mockReturnValue('https://wiki.example.com/oauth/callback'),
    };
    service = new OidcService(configService as unknown as OidcConfigService);
  });

  /** state を1件登録した状態を作る（認可URL生成の代わり） */
  const registerPending = (state: string) => {
    (service as any).pending.set(state, {
      codeVerifier: 'verifier',
      nonce: 'nonce',
      createdAt: Date.now(),
    });
  };

  describe('ディスカバリ文書の検証', () => {
    const mockDiscovery = (doc: Record<string, unknown>) => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => doc,
      }) as unknown as typeof fetch;
    };

    const valid = {
      issuer: 'https://idp.example.com',
      authorization_endpoint: 'https://idp.example.com/authorize',
      token_endpoint: 'https://idp.example.com/token',
      jwks_uri: 'https://idp.example.com/jwks',
    };

    afterEach(() => {
      // @ts-expect-error テスト用に差し替えた fetch を戻す
      delete global.fetch;
    });

    it('妥当な文書は取得できる', async () => {
      mockDiscovery(valid);
      await expect(
        service.getDiscovery('https://idp.example.com'),
      ).resolves.toMatchObject({ issuer: 'https://idp.example.com' });
    });

    it('末尾スラッシュの差異は許容する', async () => {
      mockDiscovery({ ...valid, issuer: 'https://idp.example.com/' });
      await expect(
        service.getDiscovery('https://idp.example.com'),
      ).resolves.toBeDefined();
    });

    it('【重要】issuer が無い文書は拒否する', async () => {
      // issuer が undefined のまま jwtVerify に渡ると、jose は issuer の照合を
      // **スキップ**する＝別の発行者が署名したトークンを受理しうる。
      const { issuer: _omitted, ...withoutIssuer } = valid;
      mockDiscovery(withoutIssuer);

      await expect(
        service.getDiscovery('https://idp.example.com'),
      ).rejects.toThrow(/必要な項目がありません/);
    });

    it('【重要】issuer が設定値と一致しない文書は拒否する', async () => {
      mockDiscovery({ ...valid, issuer: 'https://evil.example.com' });

      await expect(
        service.getDiscovery('https://idp.example.com'),
      ).rejects.toThrow(/一致しません/);
    });

    it('取得結果はキャッシュされ、再取得しない', async () => {
      mockDiscovery(valid);

      await service.getDiscovery('https://idp.example.com');
      await service.getDiscovery('https://idp.example.com');

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('接続テストはキャッシュを汚さない（保存前の入力を残さない）', async () => {
      mockDiscovery(valid);

      await service.testConnection('https://idp.example.com');

      expect((service as any).discoveryCache.size).toBe(0);
    });

    it('接続テストはキャッシュを使わず毎回取得する', async () => {
      mockDiscovery(valid);

      await service.getDiscovery('https://idp.example.com');
      await service.testConnection('https://idp.example.com');

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('JWKS のキャッシュ', () => {
    it('【重要】jwks_uri をキーにする（issuer ではなく）', async () => {
      // issuer をキーにすると、IdP 側で jwks_uri が変わっても古い URL の
      // JWKS を使い続け、プロセスを再起動するまで誰もサインインできなくなる。
      const discovery = {
        issuer: 'https://idp.example.com',
        authorization_endpoint: 'https://idp.example.com/authorize',
        token_endpoint: 'https://idp.example.com/token',
        jwks_uri: 'https://idp.example.com/jwks/v2',
      };

      // 署名検証自体は失敗してよい（キャッシュ登録はその手前で起きる）
      await expect(
        (service as any).verifyIdToken(discovery, config, 'not-a-jwt', 'nonce'),
      ).rejects.toBeDefined();

      const keys = [...(service as any).jwksCache.keys()];
      expect(keys).toEqual(['https://idp.example.com/jwks/v2']);
    });
  });

  describe('ログイン CSRF（state のブラウザ束縛）', () => {
    it('【重要】クッキーが無いコールバックは拒否する', async () => {
      registerPending('state-1');

      await expect(
        service.verifyCallback('code', 'state-1', undefined),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('【重要】クッキーの値が一致しないコールバックは拒否する', async () => {
      registerPending('state-1');

      // 攻撃者が取得した state を被害者に踏ませても、
      // 被害者のブラウザには対応するクッキーが無い（または別の値）
      await expect(
        service.verifyCallback('code', 'state-1', 'state-of-another-browser'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('拒否しても state を消費しない（正規の利用者が続行できる）', async () => {
      registerPending('state-1');

      await expect(
        service.verifyCallback('code', 'state-1', 'wrong'),
      ).rejects.toThrow(UnauthorizedException);

      expect((service as any).pending.has('state-1')).toBe(true);
    });

    it('【重要】並行して始めた認証が互いを無効化しない', async () => {
      // 利用者はボタンを2度押したり、複数タブでサインインを始めたりする。
      // クッキーが state を1つしか持てないと、先に始めた認証が必ず失敗し、
      // 「サインインできませんでした」が繰り返される（原因も分からない）。
      registerPending('state-1');
      registerPending('state-2');

      // 後から始めた state-2 が居ても、state-1 のコールバックは受理される
      // （state 照合を通過し、この先の ID Token 検証で落ちる＝別の理由）
      await expect(
        service.verifyCallback('code', 'state-1', 'state-1'),
      ).rejects.not.toThrow(/サインインを完了できませんでした/);
    });

    it('未知の state は拒否する（使い回し・期限切れ）', async () => {
      await expect(
        service.verifyCallback('code', 'unknown-state', 'unknown-state'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('メールアドレスの解決', () => {
    const resolve = (claims: Record<string, unknown>) =>
      (service as any).resolveEmail(claims, config);

    it('設定されたクレームを優先順に探す', () => {
      const withFallbacks = { ...config, emailClaims: ['email', 'upn'] };
      const resolveWith = (claims: Record<string, unknown>) =>
        (service as any).resolveEmail(claims, withFallbacks);

      expect(resolveWith({ email: 'a@example.com' })).toBe('a@example.com');
      expect(resolveWith({ upn: 'c@example.com' })).toBe('c@example.com');
    });

    it('【重要】既定では email 以外のクレームを使わない', () => {
      // preferred_username / upn は利用者が自分で設定できる IdP がある。
      // 紐付けはメール一致なので、既定で見に行くと他人のアドレスを名乗って
      // 既存アカウント（管理者を含む）を乗っ取れてしまう。
      expect(resolve({ preferred_username: 'admin@example.com' })).toBeNull();
      expect(resolve({ upn: 'admin@example.com' })).toBeNull();
    });

    it('大文字は小文字に正規化する', () => {
      expect(resolve({ email: 'A@Example.COM' })).toBe('a@example.com');
    });

    it('【重要】email_verified が false のときは受け入れない（アカウント乗っ取りの防止）', () => {
      // IdP で任意のアドレスを名乗って登録するだけで、
      // 既存アカウント（Admin を含む）を乗っ取れてしまうため
      expect(() =>
        resolve({ email: 'admin@example.com', email_verified: false })
      ).toThrow(UnauthorizedException);
    });

    it('未確認と、クレームが無いのを取り違えない（原因を誤って案内しない）', () => {
      // 「クレーム名を確認してください」と案内してしまうと、
      // 原因が違うため管理者は永久に解決できない
      expect(() =>
        resolve({ email: 'a@example.com', email_verified: false })
      ).toThrow(/確認済みでない/);

      // クレームが無い場合は従来どおり null（呼び出し側でクレーム名を案内）
      expect(resolve({})).toBeNull();
    });

    it('【重要】email_verified が文字列 "false" でも受け入れない', () => {
      // 仕様上は真偽値だが、文字列で返す IdP がある
      expect(() =>
        resolve({ email: 'admin@example.com', email_verified: 'false' })
      ).toThrow(UnauthorizedException);
    });

    it('email_verified が無い IdP は通す（Entra ID 等が返さないため）', () => {
      expect(resolve({ email: 'a@example.com' })).toBe('a@example.com');
    });

    it('メールアドレスの体裁でない値は使わない', () => {
      expect(resolve({ email: 'not-an-email' })).toBeNull();
    });
  });
});

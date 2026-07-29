import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { OidcConfig, OidcConfigService } from './oidc-config.service';

/**
 * #89: OIDC（シングルサインオン）の認証処理。
 *
 * 認可コードフロー + PKCE(S256) を使う。ID Token の検証（署名・issuer・audience・nonce）は
 * 自前実装せず `jose` に任せる（JWKS のキャッシュ・鍵ローテーション・alg 混同攻撃への
 * 対処を誤ると認証を回避されるため）。
 */

/** ディスカバリ文書のうち、利用する項目 */
interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
}

/** 認可リクエスト1回分の一時情報（コールバックで突き合わせる） */
interface PendingAuth {
  codeVerifier: string;
  nonce: string;
  createdAt: number;
}

/** 認可リクエストの有効期間。IdP での認証にかかる時間を考慮して10分。 */
const PENDING_TTL_MS = 10 * 60 * 1000;

/** ディスカバリ文書のキャッシュ期間。IdP 側の変更に追随しつつ、毎回取りに行かない。 */
const DISCOVERY_TTL_MS = 10 * 60 * 1000;

/** 外部への HTTP 取得のタイムアウト。IdP が応答しないときにリクエストを滞留させない。 */
const FETCH_TIMEOUT_MS = 10_000;

/** 長さの違いを含めて、比較時間から情報が漏れないように突き合わせる */
function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);

  /** state → 一時情報。プロセス内メモリで保持する（単一インスタンス構成が前提） */
  private readonly pending = new Map<string, PendingAuth>();

  /** issuer → ディスカバリ文書のキャッシュ */
  private readonly discoveryCache = new Map<
    string,
    { doc: OidcDiscovery; fetchedAt: number }
  >();

  /**
   * jwks_uri → JWKS（jose が内部でキャッシュ・鍵ローテーションを処理する）
   *
   * ⚠️ issuer ではなく **jwks_uri** をキーにすること。
   * JWKS はプロセスが生きている限り保持される一方、ディスカバリ文書は
   * {@link DISCOVERY_TTL_MS} で再取得される。issuer をキーにすると、IdP 側で
   * jwks_uri が変わったときに古い URL の JWKS を使い続け、再起動するまで
   * 全員がサインインできなくなる。
   */
  private readonly jwksCache = new Map<
    string,
    ReturnType<typeof createRemoteJWKSet>
  >();

  constructor(private configService: OidcConfigService) {}

  /** タイムアウト付きの fetch。IdP の応答待ちでリクエストが滞留するのを防ぐ。 */
  private async fetchWithTimeout(
    url: string,
    init?: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * ディスカバリ文書を取得する。
   *
   * issuer をそのまま指定させる方式にしている（利用者が v2 エンドポイント等を
   * 明示できるようにするため。Microsoft Entra ID の v1/v2 問題への対策）。
   */
  async getDiscovery(issuer: string): Promise<OidcDiscovery> {
    const cached = this.discoveryCache.get(issuer);
    if (cached && Date.now() - cached.fetchedAt < DISCOVERY_TTL_MS) {
      return cached.doc;
    }

    const doc = await this.fetchDiscovery(issuer);
    this.discoveryCache.set(issuer, { doc, fetchedAt: Date.now() });
    return doc;
  }

  /** ディスカバリ文書を取得して検証する（キャッシュを読み書きしない）。 */
  private async fetchDiscovery(issuer: string): Promise<OidcDiscovery> {
    const url = `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
    const res = await this.fetchWithTimeout(url);

    if (!res.ok) {
      throw new BadRequestException(
        `OIDC ディスカバリ文書を取得できませんでした（${res.status}）: ${url}`,
      );
    }

    const doc = (await res.json()) as OidcDiscovery;

    // ⚠️ issuer の欠落を通すと、ID トークン検証時に jose が issuer の照合を
    // **スキップ**してしまい、別の発行者が署名したトークンを受理しうる。
    if (
      !doc.issuer ||
      !doc.authorization_endpoint ||
      !doc.token_endpoint ||
      !doc.jwks_uri
    ) {
      throw new BadRequestException(
        `OIDC ディスカバリ文書に必要な項目がありません` +
          `（issuer / authorization_endpoint / token_endpoint / jwks_uri）: ${url}`,
      );
    }

    // OIDC Discovery の仕様上、issuer は取得元の URL と一致しなければならない。
    // 一致しない文書を信用すると、設定した IdP とは別の発行者を信頼することになる。
    const normalize = (value: string) => value.replace(/\/+$/, '');
    if (normalize(doc.issuer) !== normalize(issuer)) {
      throw new BadRequestException(
        `OIDC ディスカバリ文書の issuer が設定値と一致しません` +
          `（設定: ${issuer} / 応答: ${doc.issuer}）`,
      );
    }

    return doc;
  }

  /** 管理画面の「接続をテスト」用。設定を保存する前に疎通と項目を確認する。 */
  async testConnection(issuer: string): Promise<{
    ok: boolean;
    issuer?: string;
    authorizationEndpoint?: string;
    tokenEndpoint?: string;
    message: string;
  }> {
    try {
      // 疎通確認は「その場の入力」を確かめるだけの操作なので、
      // キャッシュを読まないだけでなく、**書き込みもしない**。
      // 保存前の（打ち間違いを含む）issuer をキャッシュに残すと、
      // 実際の設定と食い違ったまま TTL のあいだ使われうる。
      const doc = await this.fetchDiscovery(issuer);

      return {
        ok: true,
        issuer: doc.issuer,
        authorizationEndpoint: doc.authorization_endpoint,
        tokenEndpoint: doc.token_endpoint,
        message: 'ディスカバリ文書を取得できました。',
      };
    } catch (err) {
      return {
        ok: false,
        message: `接続できませんでした: ${(err as Error).message}`,
      };
    }
  }

  /** 期限切れの一時情報を掃除する（メモリの肥大化を防ぐ） */
  private prunePending(): void {
    const now = Date.now();
    for (const [key, value] of this.pending) {
      if (now - value.createdAt > PENDING_TTL_MS) {
        this.pending.delete(key);
      }
    }
  }

  /**
   * 認可URLを生成する（サインインボタン押下時）。
   *
   * フロントの `/oauth/callback` ページは `state` を **JSON として解析**するため、
   * `{"state":"...","provider":"OIDC"}` の形で渡す必要がある。
   */
  async createAuthorizationUrl(): Promise<{ url: string; state: string }> {
    const config = await this.requireConfig();
    const discovery = await this.getDiscovery(config.issuer);

    const state = crypto.randomBytes(32).toString('base64url');
    const nonce = crypto.randomBytes(32).toString('base64url');
    const codeVerifier = crypto.randomBytes(64).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    this.prunePending();
    this.pending.set(state, { codeVerifier, nonce, createdAt: Date.now() });

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: this.configService.getRedirectUri(),
      scope: 'openid email profile',
      // フロント側が JSON.parse するため、この形式を崩さないこと
      state: JSON.stringify({ state, provider: 'OIDC' }),
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return {
      url: `${discovery.authorization_endpoint}?${params.toString()}`,
      // 呼び出し側（コントローラ）が httpOnly クッキーに書いてブラウザに束縛する
      state,
    };
  }

  /**
   * 認可コードを検証し、利用者のメールアドレスと識別子を返す。
   *
   * @param code IdP から返された認可コード
   * @param state 認可リクエスト時に発行した state（JSON ではなく内側の値）
   * @param stateFromCookie この state 専用の httpOnly クッキーの値
   */
  async verifyCallback(
    code: string,
    state: string,
    stateFromCookie?: string,
  ): Promise<{ email: string; name?: string }> {
    const config = await this.requireConfig();

    // ログイン CSRF 対策: 認証を開始したブラウザと同一かを確認する。
    // これが無いと、攻撃者が取得した code/state を被害者に踏ませることで、
    // 被害者を攻撃者のアカウントでサインインさせられる。
    // クッキーは state ごとに別名で発行しているため、同時に認証が始まっても
    // 互いを上書きしない（先に始めた方が消えて失敗する、という事故を防ぐ）。
    if (!stateFromCookie || !timingSafeEqualString(stateFromCookie, state)) {
      this.logger.warn(
        'OIDC callback rejected: state does not match the browser that started sign-in',
      );
      throw new UnauthorizedException(
        'サインインを完了できませんでした。もう一度お試しください。',
      );
    }

    const pending = this.pending.get(state);
    if (!pending) {
      // 使い回し・期限切れ・改ざんのいずれか
      throw new UnauthorizedException(
        'サインインの有効期限が切れています。もう一度お試しください。',
      );
    }
    // 1回限り（リプレイ防止）
    this.pending.delete(state);

    if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
      throw new UnauthorizedException(
        'サインインの有効期限が切れています。もう一度お試しください。',
      );
    }

    const discovery = await this.getDiscovery(config.issuer);
    const idToken = await this.exchangeCode(
      discovery,
      config,
      code,
      pending.codeVerifier,
    );
    const claims = await this.verifyIdToken(
      discovery,
      config,
      idToken,
      pending.nonce,
    );

    const email = this.resolveEmail(claims, config);
    if (!email) {
      // Entra ID で `email` が返らない場合など。設定で解決できるよう案内する。
      throw new UnauthorizedException(
        'IdP からメールアドレスを取得できませんでした。' +
          '管理画面の「メールアドレスのクレーム名」を確認してください。',
      );
    }

    // sub の存在確認（ID Token は必ず利用者を特定できる形でなければならない）。
    // ⚠️ アカウントの紐付けは **メールアドレス**で行っており、sub は使っていない。
    //    sub で紐付けるほうが堅いが、既存アカウントとの突き合わせができなくなる
    //    ため、現状はメール一致方式のまま（前提は docs/sso-setup.md に記載）。
    if (!String(claims.sub ?? '')) {
      throw new UnauthorizedException(
        'IdP から識別子（sub）を取得できませんでした。',
      );
    }

    const name =
      typeof claims.name === 'string' && claims.name.trim()
        ? claims.name.trim()
        : undefined;

    return { email, name };
  }

  /** 認可コードを ID Token に交換する。 */
  private async exchangeCode(
    discovery: OidcDiscovery,
    config: OidcConfig,
    code: string,
    codeVerifier: string,
  ): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.configService.getRedirectUri(),
      code_verifier: codeVerifier,
      client_id: config.clientId,
    });

    const res = await this.fetchWithTimeout(discovery.token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // client_secret_basic。多くの IdP が既定で受け付ける方式。
        Authorization:
          'Basic ' +
          Buffer.from(
            `${encodeURIComponent(config.clientId)}:${encodeURIComponent(
              config.clientSecret,
            )}`,
          ).toString('base64'),
      },
      body: body.toString(),
    });

    if (!res.ok) {
      // ⚠️ 応答本文にはクライアント情報が含まれ得るため、ログには載せない
      this.logger.warn(`Token exchange failed: HTTP ${res.status}`);
      throw new UnauthorizedException('IdP との認証に失敗しました。');
    }

    const json = (await res.json()) as { id_token?: string };
    if (!json.id_token) {
      throw new UnauthorizedException('IdP から ID トークンが返されませんでした。');
    }
    return json.id_token;
  }

  /** ID Token の署名・issuer・audience・nonce を検証する。 */
  private async verifyIdToken(
    discovery: OidcDiscovery,
    config: OidcConfig,
    idToken: string,
    nonce: string,
  ): Promise<Record<string, unknown>> {
    let jwks = this.jwksCache.get(discovery.jwks_uri);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
      this.jwksCache.set(discovery.jwks_uri, jwks);
    }

    try {
      const { payload } = await jwtVerify(idToken, jwks, {
        // issuer はディスカバリ文書の値と照合する（取得時に設定値との一致を
        // 確認済みなので、どちらを使っても同じ発行者を指す）。
        issuer: discovery.issuer,
        audience: config.clientId,
      });

      // nonce の検証（リプレイ攻撃・トークン差し替えの防止）
      if (payload.nonce !== nonce) {
        throw new Error('nonce mismatch');
      }

      return payload as Record<string, unknown>;
    } catch (err) {
      this.logger.warn(`ID token verification failed: ${(err as Error).message}`);
      throw new UnauthorizedException('IdP との認証に失敗しました。');
    }
  }

  /**
   * メールアドレスをクレームから解決する。
   *
   * Microsoft Entra ID は `email` を返さないことがあり、`preferred_username` や
   * `upn` に入る。設定された優先順で探す。
   *
   * ⚠️ **`email_verified` が明示的に false の場合は拒否する。**
   * こちら側はメールアドレスで既存アカウントに紐付けるため、IdP 側で未確認の
   * メールアドレスを受け入れると、**他人のアカウント（Admin を含む）を乗っ取れる**
   * （攻撃者が IdP で任意のアドレスを名乗って登録するだけで成立してしまう）。
   *
   * クレーム自体が無い場合は判断できないため通す（Entra ID など返さない IdP がある）。
   * その場合の安全性は「その IdP を信頼してよいか」に依存する旨をドキュメントに記載している。
   */
  private resolveEmail(
    claims: Record<string, unknown>,
    config: OidcConfig,
  ): string | null {
    // ⚠️ 仕様上は真偽値だが、文字列 "false" を返す IdP がある。
    // 厳密比較だけだと未確認のメールアドレスを受理してしまう。
    // ⚠️ ここで null を返してはいけない。呼び出し側は null を
    // 「クレームが見つからない」と解釈し、「クレーム名を確認してください」と
    // 案内してしまう。原因が違うため、管理者は永久に解決できない。
    if (claims.email_verified === false || claims.email_verified === 'false') {
      this.logger.warn(
        'OIDC sign-in rejected: the identity provider reports email_verified=false',
      );
      throw new UnauthorizedException(
        'メールアドレスが確認済みでないため、サインインできません。' +
          'ID プロバイダ側でメールアドレスの確認を完了してください。',
      );
    }

    for (const claim of config.emailClaims) {
      const value = claims[claim];
      if (typeof value === 'string' && value.includes('@')) {
        return value.trim().toLowerCase();
      }
    }
    return null;
  }

  private async requireConfig(): Promise<OidcConfig> {
    const config = await this.configService.getConfig();
    if (!config) {
      throw new BadRequestException('シングルサインオンが設定されていません。');
    }
    return config;
  }
}

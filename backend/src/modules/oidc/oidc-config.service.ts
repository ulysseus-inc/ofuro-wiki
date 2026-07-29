import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { decryptSecret, encryptSecret } from '../../common/secret-box';

/**
 * #89: OIDC（シングルサインオン）の設定。
 *
 * 方針: `.env` は起動に最低限必要なものだけ。機能拡張系の設定は管理画面（DB）に置く。
 * そのため設定は `ServerSetting` テーブルに保存し、**再起動なしで反映**できるようにする。
 */
export const OIDC_SETTING_KEYS = {
  enabled: 'oidc_enabled',
  issuer: 'oidc_issuer',
  clientId: 'oidc_client_id',
  clientSecret: 'oidc_client_secret',
  buttonLabel: 'oidc_button_label',
  /**
   * メールアドレスとして扱うクレーム名（カンマ区切りで優先順）。
   * Microsoft Entra ID は `email` を返さないことがあり、`preferred_username` や
   * `upn` に入るため、環境ごとに指定できるようにしている。
   */
  emailClaims: 'oidc_email_claims',
  /**
   * 初回サインイン時にアカウントを自動作成するか（JIT プロビジョニング）。
   *
   * **既定は false（作らない）。** IdP の性質によって正解が逆になるため、
   * 管理者が明示的に選ぶ設計にしている。
   *   - 社内の Entra ID / Keycloak → ON が便利（社員しかいない）
   *   - Google 等の一般アカウント  → **OFF でないと世界中の利用者が入れてしまう**
   *
   * 設定ミスの結果が非対称（OFF の誤りは「入れない」で気づけるが、
   * ON の誤りは「部外者が入れる」で気づきにくい）ため、安全側を既定にする。
   */
  autoCreateUser: 'oidc_auto_create_user',
} as const;

/**
 * 既定で参照するクレームは `email` **のみ**。
 *
 * ⚠️ `preferred_username` / `upn` を既定に含めてはいけない。
 * アカウントの紐付けはメールアドレスの一致で行うため、利用者が自分で
 * 値を設定できる IdP（Keycloak のユーザー名など）では、他人のアドレスを
 * 名乗って**既存アカウント（管理者を含む）を乗っ取れる**。
 *
 * Entra ID のように `email` を返さない IdP では、管理画面で明示的に
 * 追加してもらう（手順書に記載）。「その値を信頼してよいか」を
 * 管理者が判断したうえで有効になる、という形にする。
 */
const DEFAULT_EMAIL_CLAIMS = 'email';

export interface OidcConfig {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret: string;
  buttonLabel: string;
  emailClaims: string[];
  autoCreateUser: boolean;
}

/** 画面に返す設定（シークレットは含めない）。 */
export interface OidcConfigView {
  enabled: boolean;
  issuer: string;
  clientId: string;
  /** 設定済みかどうかだけを示す。値そのものは返さない。 */
  clientSecretSet: boolean;
  buttonLabel: string;
  emailClaims: string;
  autoCreateUser: boolean;
  /** IdP 側に登録するリダイレクト URI（利用者が最もつまずく箇所なので画面に表示する） */
  redirectUri: string;
}

@Injectable()
export class OidcConfigService {
  private readonly logger = new Logger(OidcConfigService.name);

  /** 設定が中途半端な旨を警告済みか（同じ警告をログに繰り返さない） */
  private warnedIncomplete = false;

  constructor(private prisma: PrismaService) {}

  /** IdP 側に登録させるリダイレクト URI。フロントの `/oauth/callback` ページを指す。 */
  getRedirectUri(): string {
    const baseUrl = (process.env.BASE_URL || 'http://localhost:3010').replace(
      /\/+$/,
      '',
    );
    return `${baseUrl}/oauth/callback`;
  }

  private async readAll(): Promise<Record<string, string>> {
    const rows = await this.prisma.serverSetting.findMany({
      where: { key: { in: Object.values(OIDC_SETTING_KEYS) } },
    });
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  /** 内部利用（認証処理）向け。シークレットを復号して返す。 */
  async getConfig(): Promise<OidcConfig | null> {
    const values = await this.readAll();

    const enabled = values[OIDC_SETTING_KEYS.enabled] === 'true';
    if (!enabled) return null;

    const issuer = values[OIDC_SETTING_KEYS.issuer]?.trim() ?? '';
    const clientId = values[OIDC_SETTING_KEYS.clientId]?.trim() ?? '';
    const clientSecret =
      decryptSecret(values[OIDC_SETTING_KEYS.clientSecret])?.trim() ?? '';

    // 必須項目が欠けている設定は「無効」として扱う（中途半端な状態でボタンを出さない）
    if (!issuer || !clientId || !clientSecret) {
      // getConfig() は未認証でも呼ばれるサーバー設定取得の経路にも乗るため、
      // そのまま warn すると閲覧のたびにログが埋まる。状態が変わったときだけ出す。
      if (!this.warnedIncomplete) {
        this.warnedIncomplete = true;
        this.logger.warn(
          'OIDC is enabled but issuer / clientId / clientSecret are incomplete; treating as disabled',
        );
      }
      return null;
    }
    this.warnedIncomplete = false;

    const claims = (
      values[OIDC_SETTING_KEYS.emailClaims]?.trim() || DEFAULT_EMAIL_CLAIMS
    )
      .split(',')
      .map((claim) => claim.trim())
      .filter(Boolean);

    return {
      enabled: true,
      issuer,
      clientId,
      clientSecret,
      buttonLabel: values[OIDC_SETTING_KEYS.buttonLabel]?.trim() || 'SSO',
      emailClaims: claims.length ? claims : DEFAULT_EMAIL_CLAIMS.split(','),
      // 既定は false（未設定なら作らない）
      autoCreateUser: values[OIDC_SETTING_KEYS.autoCreateUser] === 'true',
    };
  }

  /** 管理画面向け。シークレットは「設定済みか」だけを返す。 */
  async getConfigView(): Promise<OidcConfigView> {
    const values = await this.readAll();
    return {
      enabled: values[OIDC_SETTING_KEYS.enabled] === 'true',
      issuer: values[OIDC_SETTING_KEYS.issuer] ?? '',
      clientId: values[OIDC_SETTING_KEYS.clientId] ?? '',
      // ⚠️ 「暗号文が存在するか」ではなく「復号できるか」で判定する。
      // JWT_SECRET を変更すると復号できなくなり SSO は無効になるが、
      // 存在チェックだけだと画面に「設定済み」と表示され続け、
      // 「設定済みなのにボタンが出ない」という分かりにくい状態になる。
      clientSecretSet:
        decryptSecret(values[OIDC_SETTING_KEYS.clientSecret]) !== null,
      buttonLabel: values[OIDC_SETTING_KEYS.buttonLabel] ?? '',
      emailClaims:
        values[OIDC_SETTING_KEYS.emailClaims] || DEFAULT_EMAIL_CLAIMS,
      autoCreateUser: values[OIDC_SETTING_KEYS.autoCreateUser] === 'true',
      redirectUri: this.getRedirectUri(),
    };
  }

  /**
   * 管理画面からの更新。
   * `clientSecret` は**未指定なら既存値を維持**する（画面には値を返さないため、
   * 保存のたびに再入力させない）。
   */
  async updateConfig(input: {
    enabled?: boolean;
    issuer?: string;
    clientId?: string;
    clientSecret?: string;
    buttonLabel?: string;
    emailClaims?: string;
    autoCreateUser?: boolean;
  }): Promise<OidcConfigView> {
    const updates: Array<[string, string]> = [];

    // ⚠️ `!= null` で判定する。`@IsOptional()` は明示的な null も通すため、
    // `!== undefined` だと null が素通りし、trim() で 500 になる／
    // 文字列 'null' が保存される。
    if (input.enabled != null) {
      updates.push([OIDC_SETTING_KEYS.enabled, String(input.enabled)]);
    }
    if (input.issuer != null) {
      updates.push([OIDC_SETTING_KEYS.issuer, input.issuer.trim()]);
    }
    if (input.clientId != null) {
      updates.push([OIDC_SETTING_KEYS.clientId, input.clientId.trim()]);
    }
    // ⚠️ 空文字・空白のみは「変更なし」とみなす。
    // trim 前に判定すると、空白だけの入力で既存のシークレットを
    // 空で上書きしてしまい、SSO が無言で無効になる。
    const trimmedSecret = input.clientSecret?.trim();
    if (trimmedSecret) {
      // JWT_SECRET が無いと暗号化できない（＝保存できない）。
      // 本番では起動時に弾いているが、開発環境では未設定のまま起動できるため、
      // ここで素通りさせると原因の分からない 500 になる。
      let encrypted: string;
      try {
        encrypted = encryptSecret(trimmedSecret);
      } catch (err) {
        this.logger.error(
          `Failed to encrypt the OIDC client secret: ${String(err)}`,
        );
        throw new ServiceUnavailableException(
          'サーバーの JWT_SECRET が未設定のため、クライアントシークレットを保存できません。' +
            '環境変数を設定してから再度お試しください。',
        );
      }
      updates.push([OIDC_SETTING_KEYS.clientSecret, encrypted]);
    }
    if (input.buttonLabel != null) {
      updates.push([OIDC_SETTING_KEYS.buttonLabel, input.buttonLabel.trim()]);
    }
    if (input.emailClaims != null) {
      updates.push([OIDC_SETTING_KEYS.emailClaims, input.emailClaims.trim()]);
    }
    if (input.autoCreateUser != null) {
      updates.push([
        OIDC_SETTING_KEYS.autoCreateUser,
        String(input.autoCreateUser),
      ]);
    }

    for (const [key, value] of updates) {
      await this.prisma.serverSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
    }

    this.logger.log(
      `OIDC settings updated: ${updates.map(([key]) => key).join(', ')}`,
    );

    return this.getConfigView();
  }
}

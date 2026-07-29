import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * #89: OIDC エンドポイントの入力検証。
 *
 * ⚠️ `ValidationPipe({ whitelist: true })` が有効なため、**デコレータの無いプロパティは
 * 剥ぎ取られる**。新しい項目を足すときは必ずデコレータを付けること。
 */

/** 現時点で対応するプロバイダ。フロントの OAuthProviderType と対応する。 */
const SUPPORTED_PROVIDERS = ['OIDC'] as const;

export class OauthPreflightDto {
  @IsIn(SUPPORTED_PROVIDERS, {
    message: '対応していない認証プロバイダです',
  })
  provider!: string;

  /** 呼び出し元の種別（web / desktop 等）。動作には影響しないが、フロントが送ってくる。 */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  client?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  redirect_uri?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  client_nonce?: string;
}

export class OauthCallbackDto {
  @IsString()
  @MinLength(1, { message: '認可コードがありません' })
  @MaxLength(4096)
  code!: string;

  @IsString()
  @MinLength(1, { message: 'state がありません' })
  @MaxLength(1024)
  state!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  client_nonce?: string;
}

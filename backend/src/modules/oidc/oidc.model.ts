import { Field, InputType, ObjectType } from '@nestjs/graphql';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** #89: 管理画面に返す OIDC 設定（シークレットの値は含めない） */
@ObjectType()
export class OidcConfigType {
  @Field()
  enabled!: boolean;

  @Field()
  issuer!: string;

  @Field()
  clientId!: string;

  /** シークレットが設定済みかどうかだけを返す（値は返さない） */
  @Field()
  clientSecretSet!: boolean;

  @Field()
  buttonLabel!: string;

  @Field()
  emailClaims!: string;

  @Field()
  autoCreateUser!: boolean;

  /** IdP 側に登録するリダイレクト URI。画面に表示してコピーさせる */
  @Field()
  redirectUri!: string;
}

/** #89: 「接続をテスト」の結果 */
@ObjectType()
export class OidcTestResultType {
  @Field()
  ok!: boolean;

  @Field()
  message!: string;

  @Field({ nullable: true })
  issuer?: string;

  @Field({ nullable: true })
  authorizationEndpoint?: string;

  @Field({ nullable: true })
  tokenEndpoint?: string;
}

/**
 * #89: 設定の更新。
 *
 * ⚠️ **`@Field` だけでは足りない。** `ValidationPipe({ whitelist: true })` は
 * **class-validator のデコレータが付いていないプロパティを削除する**ため、
 * `@IsOptional()` + 型のデコレータを必ず併記すること。
 * 付け忘れると、入力が丸ごと剥ぎ取られて「保存したのに空のまま」になる。
 */
@InputType()
export class UpdateOidcConfigInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  issuer?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  clientId?: string;

  /** 未指定なら既存値を維持する（保存のたびに再入力させないため） */
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  clientSecret?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  buttonLabel?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  emailClaims?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  autoCreateUser?: boolean;
}

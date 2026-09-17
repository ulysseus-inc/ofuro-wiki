import {
  Resolver,
  Query,
  ObjectType,
  Field,
  registerEnumType,
} from '@nestjs/graphql';
import { ConfigService } from './config.service';
import { Public } from '../../common/decorators/public.decorator';

/**
 * #210: サーバーの機能。フロントエンドが値として参照する（`features.some(f => f === ServerFeature.X)`）。
 *
 * ⚠️ **フロントエンドが参照する値をすべて含める**（バックエンドが返さない `Payment` なども）。
 * 返すのは `Indexer` / `Comment` / `Email` / `OAuth`（config.service.ts）。
 * 列挙に無い値を返すと GraphQL が変換できず、サーバー設定の問い合わせが丸ごと失敗する。
 */
export enum ServerFeature {
  Captcha = 'Captcha',
  Comment = 'Comment',
  Copilot = 'Copilot',
  CopilotEmbedding = 'CopilotEmbedding',
  Email = 'Email',
  Indexer = 'Indexer',
  LocalWorkspace = 'LocalWorkspace',
  OAuth = 'OAuth',
  Payment = 'Payment',
}

registerEnumType(ServerFeature, { name: 'ServerFeature' });

/** #210: 配備の種類。ofuro-wiki は常に `Selfhosted` */
export enum ServerDeploymentType {
  Affine = 'Affine',
  Selfhosted = 'Selfhosted',
}

registerEnumType(ServerDeploymentType, { name: 'ServerDeploymentType' });

/** #210: OAuth の提供元。ofuro-wiki が返すのは `OIDC` だけ */
export enum OAuthProviderType {
  Apple = 'Apple',
  GitHub = 'GitHub',
  Google = 'Google',
  OIDC = 'OIDC',
}

registerEnumType(OAuthProviderType, { name: 'OAuthProviderType' });

@ObjectType()
class PasswordLimitsType {
  @Field()
  minLength: number;

  @Field()
  maxLength: number;
}

@ObjectType()
class CredentialsRequirementType {
  @Field(() => PasswordLimitsType)
  password: PasswordLimitsType;
}

@ObjectType()
class ServerConfigType {
  @Field()
  version: string;

  @Field()
  appVersion: string;

  @Field()
  name: string;

  @Field()
  baseUrl: string;

  @Field(() => ServerDeploymentType)
  type: ServerDeploymentType;

  @Field(() => [ServerFeature])
  features: ServerFeature[];

  @Field(() => CredentialsRequirementType)
  credentialsRequirement: CredentialsRequirementType;

  @Field(() => [OAuthProviderType])
  oauthProviders: OAuthProviderType[];

  /**
   * #89: SSO ボタンに表示する文言（管理画面で設定した値）。
   * 未設定・SSO 無効時は null を返し、フロントは既定の文言を使う。
   */
  @Field(() => String, { nullable: true })
  oidcButtonLabel?: string | null;

  @Field()
  initialized: boolean;

  @Field()
  registrationOpen: boolean;

  @Field(() => [String])
  calendarProviders: string[];

  @Field(() => [String])
  calendarCalDAVProviders: string[];

  @Field({ nullable: true })
  defaultLanguage?: string;
}

@Resolver()
export class ConfigResolver {
  constructor(private configService: ConfigService) {}

  @Public()
  @Query(() => ServerConfigType)
  serverConfig() {
    return this.configService.getServerConfig();
  }
}

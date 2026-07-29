import { Resolver, Query, ObjectType, Field } from '@nestjs/graphql';
import { ConfigService } from './config.service';
import { Public } from '../../common/decorators/public.decorator';

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

  @Field()
  type: string;

  @Field(() => [String])
  features: string[];

  @Field(() => CredentialsRequirementType)
  credentialsRequirement: CredentialsRequirementType;

  @Field(() => [String])
  oauthProviders: string[];

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

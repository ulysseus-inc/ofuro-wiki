import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminOnly } from '../../common/decorators/admin.decorator';
import { OidcConfigService } from './oidc-config.service';
import { OidcService } from './oidc.service';
import {
  OidcConfigType,
  OidcTestResultType,
  UpdateOidcConfigInput,
} from './oidc.model';

/** #89: 管理画面からの OIDC 設定。Admin 専用。 */
@Resolver()
@UseGuards(JwtAuthGuard)
export class OidcResolver {
  constructor(
    private oidcConfigService: OidcConfigService,
    private oidcService: OidcService,
  ) {}

  @AdminOnly()
  @Query(() => OidcConfigType)
  async oidcConfig(): Promise<OidcConfigType> {
    return this.oidcConfigService.getConfigView();
  }

  @AdminOnly()
  @Mutation(() => OidcConfigType)
  async updateOidcConfig(
    @Args('input', { type: () => UpdateOidcConfigInput })
    input: UpdateOidcConfigInput,
  ): Promise<OidcConfigType> {
    return this.oidcConfigService.updateConfig(input);
  }

  /** 保存前に IdP との疎通を確認する（設定ミスをその場で気づけるように） */
  @AdminOnly()
  @Mutation(() => OidcTestResultType)
  async testOidcConnection(
    @Args('issuer', { type: () => String }) issuer: string,
  ): Promise<OidcTestResultType> {
    return this.oidcService.testConnection(issuer.trim());
  }
}

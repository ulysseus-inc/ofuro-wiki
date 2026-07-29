import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { OidcConfigService } from './oidc-config.service';
import { OidcController } from './oidc.controller';
import { OidcService } from './oidc.service';
import { OidcResolver } from './oidc.resolver';

/** #89: OIDC（シングルサインオン） */
@Module({
  imports: [AuthModule],
  controllers: [OidcController],
  providers: [OidcResolver, OidcService, OidcConfigService, PrismaService],
  exports: [OidcService, OidcConfigService],
})
export class OidcModule {}

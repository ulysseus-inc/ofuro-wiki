import { Module } from '@nestjs/common';
import { ConfigResolver } from './config.resolver';
import { ConfigService } from './config.service';
import { PrismaService } from '../../prisma.service';
import { OidcModule } from '../oidc/oidc.module';

@Module({
  // ⚠️ OidcConfigService は **OidcModule 経由で受け取る**（自前で provider に
  // 並べない）。並べるとインスタンスが二重化し、サービス内に持つ状態
  // （警告の抑制フラグ等）がモジュールごとに分かれてしまう。
  imports: [OidcModule],
  providers: [ConfigResolver, ConfigService, PrismaService],
})
export class ServerConfigModule {}

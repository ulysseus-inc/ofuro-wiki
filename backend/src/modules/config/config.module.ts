import { Module } from '@nestjs/common';
import { ConfigResolver } from './config.resolver';
import { ConfigService } from './config.service';
import { PrismaService } from '../../prisma.service';

@Module({
  providers: [ConfigResolver, ConfigService, PrismaService],
})
export class ServerConfigModule {}

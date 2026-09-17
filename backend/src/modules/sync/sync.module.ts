import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SyncGateway } from './sync.gateway';
import { SyncService } from './sync.service';
import { AwarenessService } from './awareness.service';
import { PrismaService } from '../../prisma.service';
import { SearchModule } from '../search/search.module';
import { DiscoveryModule } from '../discovery/discovery.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET || 'dev-secret',
      }),
    }),
    SearchModule,
    // #151: doc 削除で Index の版数を上げる
    DiscoveryModule,
  ],
  providers: [SyncGateway, SyncService, AwarenessService, PrismaService],
  exports: [SyncService, SyncGateway],
})
export class SyncModule {}

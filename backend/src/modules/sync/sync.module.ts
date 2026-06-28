import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SyncGateway } from './sync.gateway';
import { SyncService } from './sync.service';
import { AwarenessService } from './awareness.service';
import { PrismaService } from '../../prisma.service';
import { SearchModule } from '../search/search.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET || 'dev-secret',
      }),
    }),
    SearchModule,
  ],
  providers: [SyncGateway, SyncService, AwarenessService, PrismaService],
  exports: [SyncService, SyncGateway],
})
export class SyncModule {}

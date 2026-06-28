import { Module } from '@nestjs/common';
import { BlobResolver } from './blob.resolver';
import { BlobController } from './blob.controller';
import { BlobService } from './blob.service';
import { LocalStorage } from './storage/local.storage';
import { PrismaService } from '../../prisma.service';
import { WorkspaceModule } from '../workspace/workspace.module';

@Module({
  imports: [WorkspaceModule],
  controllers: [BlobController],
  providers: [
    BlobResolver,
    BlobService,
    PrismaService,
    {
      provide: 'BLOB_STORAGE',
      useClass: LocalStorage,
    },
  ],
  exports: [BlobService],
})
export class BlobModule {}

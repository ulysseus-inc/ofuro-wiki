import { Module, forwardRef } from '@nestjs/common';
import { BackupService } from './backup.service';
import { BackupController } from './backup.controller';
import { ScheduledBackupService } from './scheduled-backup.service';
import { PrismaService } from '../../prisma.service';
import { BlobModule } from '../blob/blob.module';
import { AdminModule } from '../admin/admin.module';
import { SyncModule } from '../sync/sync.module';
// #151: 取り込みで Index の内容が変わる
import { DiscoveryModule } from '../discovery/discovery.module';

@Module({
  imports: [DiscoveryModule, BlobModule, forwardRef(() => AdminModule), SyncModule],
  providers: [BackupService, ScheduledBackupService, PrismaService],
  controllers: [BackupController],
  exports: [BackupService, ScheduledBackupService],
})
export class BackupModule {}

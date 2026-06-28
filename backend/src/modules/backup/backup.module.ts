import { Module, forwardRef } from '@nestjs/common';
import { BackupService } from './backup.service';
import { BackupController } from './backup.controller';
import { ScheduledBackupService } from './scheduled-backup.service';
import { PrismaService } from '../../prisma.service';
import { BlobModule } from '../blob/blob.module';
import { AdminModule } from '../admin/admin.module';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [BlobModule, forwardRef(() => AdminModule), SyncModule],
  providers: [BackupService, ScheduledBackupService, PrismaService],
  controllers: [BackupController],
  exports: [BackupService, ScheduledBackupService],
})
export class BackupModule {}

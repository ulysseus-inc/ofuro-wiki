import { Module, forwardRef } from '@nestjs/common';
import { AdminResolver } from './admin.resolver';
import { AdminService } from './admin.service';
import { PrismaService } from '../../prisma.service';
import { BackupModule } from '../backup/backup.module';
import { MailModule } from '../mail/mail.module';
import { DiscoveryModule } from '../discovery/discovery.module';

@Module({
  // #297: 共有の持ち主を付け替えたら、一覧の版数を上げる（reassignSharedOwner）
  imports: [forwardRef(() => BackupModule), MailModule, DiscoveryModule],
  providers: [AdminResolver, AdminService, PrismaService],
  exports: [AdminService],
})
export class AdminModule {}

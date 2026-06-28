import { Module, forwardRef } from '@nestjs/common';
import { AdminResolver } from './admin.resolver';
import { AdminService } from './admin.service';
import { PrismaService } from '../../prisma.service';
import { BackupModule } from '../backup/backup.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [forwardRef(() => BackupModule), MailModule],
  providers: [AdminResolver, AdminService, PrismaService],
  exports: [AdminService],
})
export class AdminModule {}

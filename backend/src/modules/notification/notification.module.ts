import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationResolver } from './notification.resolver';
import { PrismaService } from '../../prisma.service';
import { MailModule } from '../mail/mail.module';
import { IndexReaderService } from '../discovery/index-reader.service';

@Module({
  imports: [MailModule],
  // #319: 通知のワークスペース名をルート文書から読む（Prisma だけに依存するので、ここで作る）
  providers: [NotificationService, NotificationResolver, PrismaService, IndexReaderService],
  exports: [NotificationService],
})
export class NotificationModule {}

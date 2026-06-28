import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationResolver } from './notification.resolver';
import { PrismaService } from '../../prisma.service';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [MailModule],
  providers: [NotificationService, NotificationResolver, PrismaService],
  exports: [NotificationService],
})
export class NotificationModule {}

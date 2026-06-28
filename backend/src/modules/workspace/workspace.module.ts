import { Module } from '@nestjs/common';
import { WorkspaceResolver } from './workspace.resolver';
import { WorkspaceService } from './workspace.service';
import { PrismaService } from '../../prisma.service';
import { MailModule } from '../mail/mail.module';
import { DocHistoryService } from '../doc/doc-history.service';

@Module({
  imports: [MailModule],
  providers: [WorkspaceResolver, WorkspaceService, PrismaService, DocHistoryService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}

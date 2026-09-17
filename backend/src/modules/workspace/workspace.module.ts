import { Module } from '@nestjs/common';
// #151: メンバーの増減で「誰に何が見えるか」が変わる
import { DiscoveryModule } from '../discovery/discovery.module';
import { WorkspaceResolver } from './workspace.resolver';
import { WorkspaceService } from './workspace.service';
import { PrismaService } from '../../prisma.service';
import { MailModule } from '../mail/mail.module';
import { DocHistoryService } from '../doc/doc-history.service';
import { ManualWorkspaceModule } from '../manual-workspace/manual-workspace.module';

@Module({
  imports: [DiscoveryModule, MailModule, ManualWorkspaceModule],
  providers: [
    WorkspaceResolver,
    WorkspaceService,
    PrismaService,
    DocHistoryService,
  ],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}

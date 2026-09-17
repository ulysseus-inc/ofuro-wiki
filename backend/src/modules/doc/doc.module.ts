import { forwardRef, Module } from '@nestjs/common';
// #151: Index に影響する変更で版数を上げる
import { DiscoveryModule } from '../discovery/discovery.module';
import { DocResolver } from './doc.resolver';
import { DocController } from './doc.controller';
import { InternalDocController } from './internal-doc.controller';
import { DocService } from './doc.service';
import { DocHistoryService } from './doc-history.service';
import { DocHistorySchedulerService } from './doc-history-scheduler.service';
import { PrismaService } from '../../prisma.service';

@Module({
  // ⚠️ **forwardRef が要る**（#151 段階3 で循環が生まれた）:
  //   DocModule → DiscoveryModule → PermissionModule → DocModule
  // 外すと起動時に UndefinedModuleException で落ちる
  imports: [forwardRef(() => DiscoveryModule)],
  controllers: [DocController, InternalDocController],
  providers: [
    DocResolver,
    DocService,
    DocHistoryService,
    DocHistorySchedulerService,
    PrismaService,
  ],
  exports: [DocService, DocHistoryService],
})
export class DocModule {}

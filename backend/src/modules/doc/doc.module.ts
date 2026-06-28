import { Module } from '@nestjs/common';
import { DocResolver } from './doc.resolver';
import { DocController } from './doc.controller';
import { InternalDocController } from './internal-doc.controller';
import { DocService } from './doc.service';
import { DocHistoryService } from './doc-history.service';
import { DocHistorySchedulerService } from './doc-history-scheduler.service';
import { PrismaService } from '../../prisma.service';

@Module({
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

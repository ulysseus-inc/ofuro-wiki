import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { ManualRemovalService } from './manual-removal.service';

/** #324: 以前の「📖 Manual」ワークスペースを起動時に消す */
@Module({
  providers: [ManualRemovalService, PrismaService],
  exports: [ManualRemovalService],
})
export class ManualRemovalModule {}

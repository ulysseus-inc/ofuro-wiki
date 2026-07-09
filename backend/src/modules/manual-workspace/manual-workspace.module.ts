import { Module } from '@nestjs/common';

import { PrismaService } from '../../prisma.service';
import { ManualWorkspaceService } from './manual-workspace.service';

/**
 * #72 マニュアルWSの共有ロジック（遅延 Reader 参加）。
 * Prisma のみに依存し、WorkspaceModule から安全に import できる（循環なし）。
 */
@Module({
  providers: [ManualWorkspaceService, PrismaService],
  exports: [ManualWorkspaceService],
})
export class ManualWorkspaceModule {}

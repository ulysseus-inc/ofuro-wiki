import { Module } from '@nestjs/common';

import { PrismaService } from '../../prisma.service';
import { BackupModule } from '../backup/backup.module';
import { ManualSeedService } from './manual-seed.service';
import { ManualWorkspaceModule } from './manual-workspace.module';

/**
 * #72 マニュアルWSの起動時シード。BackupModule に依存するため独立モジュールとし、
 * AppModule からのみ読み込む（WorkspaceModule 経由の循環を避ける）。
 */
@Module({
  imports: [BackupModule, ManualWorkspaceModule],
  providers: [ManualSeedService, PrismaService],
  exports: [ManualSeedService],
})
export class ManualSeedModule {}

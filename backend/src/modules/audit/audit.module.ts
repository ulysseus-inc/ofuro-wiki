import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from '../../prisma.module';
import { AuditService } from './audit.service';
import { AuditInterceptor } from './audit.interceptor';
import { DocEditAggregator } from './doc-edit-aggregator';
import { DocViewRecorder } from './doc-view-recorder';
import { FolderAuditService } from './folder-audit.service';
import { AuditQueryService } from './audit-query.service';

/**
 * #90: 監査ログ。記録は認証・Guard・Gateway・Interceptor の4経路から行うため、
 * どこからでも注入できるよう Global にしている。
 */
@Global()
@Module({
  // #90: Prisma を別モジュールから受け取る。同一モジュールに置くと、
  // 停止時に「監査ログの書き出し」と「接続の切断」が同時に走る
  imports: [PrismaModule],
  providers: [
    AuditService,
    AuditQueryService,
    DocEditAggregator,
    DocViewRecorder,
    FolderAuditService,
    // 成功した更新操作を横断的に記録する（拒否・認証失敗は別経路）
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [
    AuditService,
    AuditQueryService,
    DocEditAggregator,
    DocViewRecorder,
    FolderAuditService,
  ],
})
export class AuditModule {}

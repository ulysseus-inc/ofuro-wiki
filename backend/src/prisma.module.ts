import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * #90: Prisma を**別モジュール**として提供する。
 *
 * ⚠️ Nest は `onModuleDestroy` を**同一モジュール内の provider については同時に**
 * 呼ぶ（`Promise.all`）。監査ログの書き出しと `PrismaService.$disconnect()` が
 * 同じモジュールに並んでいると、**書き出しの途中で接続が閉じられ**、
 * 停止時のフラッシュが fail-open で無言に落ちる。
 *
 * import する側（AuditModule）は import される側より**先に**破棄されるため、
 * 分けることで「書き出し → 切断」の順序が保証される。
 */
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}

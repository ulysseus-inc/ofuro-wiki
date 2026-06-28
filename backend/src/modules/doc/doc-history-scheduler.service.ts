import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma.service';

// 履歴保存間隔（Cron と重複チェック窓を合わせること）
const CRON_SCHEDULE = CronExpression.EVERY_HOUR;
const INTERVAL_MS = 60 * 60 * 1000;

/**
 * 定期的にアクティブなドキュメントの DocHistory を保存する。
 * パフォーマンス用の rebuildSnapshot とは独立して動作する。
 */
@Injectable()
export class DocHistorySchedulerService {
  private readonly logger = new Logger(DocHistorySchedulerService.name);

  constructor(private prisma: PrismaService) {}

  @Cron(CRON_SCHEDULE)
  async saveHistory() {
    const intervalAgo = new Date(Date.now() - INTERVAL_MS);

    // 直近インターバル以内に更新されたスナップショットを対象にする
    const snapshots = await this.prisma.docSnapshot.findMany({
      where: { timestamp: { gte: intervalAgo } },
    });

    if (snapshots.length === 0) return;

    this.logger.log(`Saving history for ${snapshots.length} docs`);

    for (const snapshot of snapshots) {
      // 直近インターバル以内にすでに保存済みの履歴があればスキップ
      const existing = await this.prisma.docHistory.findFirst({
        where: {
          workspaceId: snapshot.workspaceId,
          docId: snapshot.docId,
          timestamp: { gte: intervalAgo },
        },
        select: { id: true },
      });

      if (existing) continue;

      await this.prisma.docHistory.create({
        data: {
          workspaceId: snapshot.workspaceId,
          docId: snapshot.docId,
          blob: snapshot.blob,
          timestamp: new Date(),
          editorId: snapshot.editorId,
        },
      });
    }

    this.logger.log(`History saved for ${snapshots.length} docs`);
  }
}

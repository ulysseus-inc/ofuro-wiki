import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { PrismaService } from '../../prisma.service';
import { IndexerService } from './indexer.service';

/**
 * 最後の編集からこれだけ静まったら作り直す（ミリ秒）。
 *
 * ⚠️ 打鍵のたびに作り直さないための待ち。短くすると連続編集の最中に
 * 何度も走り、長くすると「リンクを張ったのに出ない」時間が延びる。
 */
const QUIET_MS = 3000;

/** 1回の巡回で扱う件数。詰まったときに1周が長くなりすぎないための上限 */
const BATCH_SIZE = 20;

/** 巡回の間隔（ミリ秒） */
const INTERVAL_MS = 5000;

/**
 * #101: 索引の作り直し待ちを処理する（docs/search-index.md 5章）。
 *
 * 本文の保存と同一トランザクションで印が立つ（`SyncService.pushUpdate`）。
 * ここは、静まった行だけを作り直して印を消す側。
 */
@Injectable()
export class SearchIndexQueueService {
  private readonly logger = new Logger(SearchIndexQueueService.name);
  /** 巡回の重なりを避ける。前回が長引いているときは次を走らせない */
  private running = false;

  constructor(
    private prisma: PrismaService,
    private indexer: IndexerService,
  ) {}

  @Interval(INTERVAL_MS)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.processPending();
    } catch (err) {
      // 巡回そのものが落ちても、印は残るので次の巡回で拾える
      this.logger.error(`索引の巡回に失敗しました: ${err}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * 作り直しが要る行を処理する。
   *
   * ⚠️ **控えた世代（pendingGeneration）までしか印を進めない。**
   * 作り直しの最中に届いた編集を「取り込んだ」ことにすると、
   * **その編集は永久に索引へ載らない。**
   */
  async processPending(): Promise<void> {
    const quietBefore = new Date(Date.now() - QUIET_MS);

    const rows = await this.prisma.searchIndexQueue.findMany({
      where: {
        pendingAt: { lte: quietBefore },
        // 「作り直しが要る」= pending > indexed
        pendingGeneration: { gt: this.prisma.searchIndexQueue.fields.indexedGeneration },
      },
      orderBy: { pendingAt: 'asc' },
      take: BATCH_SIZE,
    });

    for (const row of rows) {
      // ⚠️ 作り直しの前に控える。後で読むと、最中に届いた編集まで含んでしまう
      const generation = row.pendingGeneration;
      try {
        await this.indexer.indexDocument(row.workspaceId, row.docId);
      } catch (err) {
        // ⚠️ 印を消さない。次の巡回で再試行する
        this.logger.warn(
          `索引の作り直しに失敗しました（${row.workspaceId}/${row.docId}）: ${err}`,
        );
        continue;
      }

      await this.prisma.searchIndexQueue.updateMany({
        // ⚠️ 進んでいるときだけ書く。別の巡回が先に進めていたら戻さない
        where: {
          workspaceId: row.workspaceId,
          docId: row.docId,
          indexedGeneration: { lt: generation },
        },
        data: { indexedGeneration: generation },
      });
    }
  }
}

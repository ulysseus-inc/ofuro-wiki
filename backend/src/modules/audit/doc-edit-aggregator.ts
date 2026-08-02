import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * #90: ドキュメント編集の監査ログを、一定時間ごとに1件へ集約する。
 *
 * **エディタは打鍵のたびに差分を送る**（`space:push-doc-update`）。
 * 1回ごとに1行残すと、10人が1時間編集しただけで数万行になり運用できない
 * （docs/logging.md 2.6）。
 *
 * (利用者 × ドキュメント) ごとに窓を持ち、窓が閉じるときに1件だけ記録する。
 * `detail.meta.updates` に、その窓の中で何回更新があったかを持つ。
 */

/** 集約の窓。docs/logging.md のとおり15分。 */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;

interface EditWindow {
  actorId: string;
  actorEmail: string;
  actorName?: string;
  workspaceId: string;
  docId: string;
  updates: number;
  firstAt: Date;
  timer: NodeJS.Timeout;
}

@Injectable()
export class DocEditAggregator implements OnModuleDestroy {
  private readonly logger = new Logger(DocEditAggregator.name);
  private windows = new Map<string, EditWindow>();

  constructor(private audit: AuditService) {}

  /**
   * 編集を1回数える。窓が無ければ開き、15分後に記録して閉じる。
   *
   * ⚠️ **窓の途中でサーバーが落ちると、その窓の記録は失われる。**
   * 記録の粒度と引き換えに受け入れている（onModuleDestroy で
   * 停止時には吐き出すため、通常の再起動では失われない）。
   */
  track(params: {
    actorId: string;
    actorEmail: string;
    actorName?: string;
    workspaceId: string;
    docId: string;
  }): void {
    const key = `${params.actorId}:${params.workspaceId}:${params.docId}`;
    const existing = this.windows.get(key);
    if (existing) {
      existing.updates++;
      return;
    }

    const timer = setTimeout(() => {
      void this.flush(key);
    }, EDIT_WINDOW_MS);
    // 記録待ちのタイマーでプロセスの終了を妨げない
    timer.unref?.();

    this.windows.set(key, {
      ...params,
      updates: 1,
      firstAt: new Date(),
      timer,
    });
  }

  /** 窓を閉じて1件記録する。 */
  private async flush(key: string): Promise<void> {
    const window = this.windows.get(key);
    if (!window) return;
    this.windows.delete(key);
    clearTimeout(window.timer);

    await this.audit.record({
      action: 'doc.update',
      actor: {
        id: window.actorId,
        email: window.actorEmail,
        name: window.actorName,
      },
      targetType: 'doc',
      targetId: window.docId,
      workspaceId: window.workspaceId,
      detail: {
        meta: {
          updates: window.updates,
          windowMinutes: EDIT_WINDOW_MS / 60000,
          startedAt: window.firstAt.toISOString(),
        },
      },
    });
  }

  /** 停止時に、開いている窓をすべて記録する（通常の再起動で失わないため）。 */
  async onModuleDestroy(): Promise<void> {
    const keys = [...this.windows.keys()];
    if (keys.length > 0) {
      this.logger.log(`編集中の監査ログを ${keys.length}件 記録します`);
    }
    for (const key of keys) {
      await this.flush(key);
    }
  }
}

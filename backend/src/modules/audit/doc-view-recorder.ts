import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { WorkspaceKind } from '../../common/workspace-kind';
import { AuditService } from './audit.service';

/**
 * #100: ページの閲覧を監査ログに残す（docs/logging.md 2.11）。
 *
 * - 既定は記録しない。サーバー設定を `'true'` にしたときだけ
 * - 利用者 × ページ × 1 日で 1 件。**同じ日の 2 回目以降は記録しない**
 * - プライベートでの閲覧は記録しない（本人しか開けない）
 *
 * 合図は `space:join-awareness`（画面でページを開いた）。
 * ページを開く処理を遅くしないよう、呼び出し側は結果を待たない。
 */

/** 記録するかの設定キー。`'true'` のときだけ有効。 */
export const DOC_VIEW_SETTING_KEY = 'audit_log_doc_view_enabled';

/** 設定・ワークスペースの種類を覚えておく時間。開くたびに DB を引かないため。 */
export const SETTING_CACHE_MS = 60 * 1000;

const DOC_VIEW_ACTION = 'doc.view';

export interface DocView {
  actorId: string;
  actorEmail: string;
  actorName?: string;
  workspaceId: string;
  docId: string;
  ip?: string;
}

interface Cached<T> {
  value: T;
  at: number;
}

@Injectable()
export class DocViewRecorder {
  private readonly logger = new Logger(DocViewRecorder.name);
  private enabled?: Cached<boolean>;
  private kinds = new Map<string, Cached<string | null>>();

  // 今日すでに記録した（記録中を含む）"利用者:ワークスペース:ページ"。日が変われば空にする
  private day = '';
  private seen = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /** 閲覧を 1 回伝える。例外を外へ出さない。 */
  async record(view: DocView): Promise<void> {
    try {
      await this.recordOnce(view);
    } catch (e) {
      this.logger.error(
        `閲覧を記録できませんでした (doc=${view.docId}): ${(e as Error).message}`,
      );
    }
  }

  /** 設定を変えたときに呼ぶ。覚えた値を捨て、次の閲覧から効かせる */
  forgetSetting(): void {
    this.enabled = undefined;
  }

  private async recordOnce(view: DocView): Promise<void> {
    if (!(await this.isEnabled())) {
      return;
    }

    // 同じ日の 2 回目以降は記録しない。DB を待つ前に印を付け、同時に届いた分も弾く
    const key = `${view.actorId}:${view.workspaceId}:${view.docId}`;
    const today = startOfToday();
    this.resetIfNewDay(today);
    if (this.seen.has(key)) {
      return;
    }
    this.seen.add(key);

    // DB の失敗で記録できなかったら、印を外して次に開いたときにまた試す
    try {
      await this.recordIfNew(view, today);
    } catch (e) {
      this.seen.delete(key);
      throw e;
    }
  }

  private async recordIfNew(view: DocView, today: Date): Promise<void> {
    if ((await this.kindOf(view.workspaceId)) !== WorkspaceKind.Shared) {
      return;
    }

    // 再起動の直後はメモリが空。今日の記録が DB にあれば書かない
    const recorded = await this.prisma.auditLog.findFirst({
      where: {
        action: DOC_VIEW_ACTION,
        actorId: view.actorId,
        targetId: view.docId,
        workspaceId: view.workspaceId,
        createdAt: { gte: today },
      },
      select: { id: true },
    });
    if (recorded) {
      return;
    }

    await this.audit.record({
      action: DOC_VIEW_ACTION,
      actor: { id: view.actorId, email: view.actorEmail, name: view.actorName },
      targetType: 'doc',
      targetId: view.docId,
      workspaceId: view.workspaceId,
      ip: view.ip,
    });
  }

  private async isEnabled(): Promise<boolean> {
    if (this.enabled && Date.now() - this.enabled.at < SETTING_CACHE_MS) {
      return this.enabled.value;
    }

    const setting = await this.prisma.serverSetting.findUnique({
      where: { key: DOC_VIEW_SETTING_KEY },
    });
    const value = setting?.value === 'true';
    this.enabled = { value, at: Date.now() };
    return value;
  }

  private async kindOf(workspaceId: string): Promise<string | null> {
    const cached = this.kinds.get(workspaceId);
    if (cached && Date.now() - cached.at < SETTING_CACHE_MS) {
      return cached.value;
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { kind: true },
    });
    const value = workspace?.kind ?? null;
    this.kinds.set(workspaceId, { value, at: Date.now() });
    return value;
  }

  private resetIfNewDay(today: Date) {
    const day = today.toISOString();
    if (day === this.day) {
      return;
    }
    this.day = day;
    this.seen.clear();
    this.kinds.clear();
  }
}

/** サーバーの時刻帯（TZ）での今日の 0 時 */
function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

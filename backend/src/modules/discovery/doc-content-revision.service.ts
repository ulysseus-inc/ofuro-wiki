import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { DiscoveryRevisionService } from './discovery-revision.service';

/** ワークスペースごとに、本文の保存で版数を上げる最短の間隔 */
export const CONTENT_BUMP_INTERVAL_MS = 30_000;

/** ワークスペースごとの記録 */
interface ContentBumpState {
  /** 最後に上げた時刻 */
  lastBumpAt: number;
  /** 30 秒の終わりに上げる予定（後追い）。無ければ null */
  trailing: ReturnType<typeof setTimeout> | null;
}

/**
 * 本文の保存でも一覧の版数を上げる。ただしワークスペースごとに 30 秒に 1 回まで
 * （docs/discovery-stage3-comparison.md 7.10.6）。
 *
 * 上げないと、クライアントは一覧を取り直さず、本文だけ書き換えたページの
 * 更新日時と並び順が、いつまでも古いまま残る。保存のたびに上げると、
 * 書いている間ずっと全員が一覧を取り直す。
 *
 * ```
 * 保存 ─┬─ 前回から 30 秒以上 → すぐ上げる
 *       └─ 30 秒以内          → 30 秒の終わりに 1 回だけ上げる（後追い）
 * ```
 *
 * 記録はメモリに持つ（1 台構成が前提）。再起動で消えても、次の保存で上がるだけ。
 */
@Injectable()
export class DocContentRevisionService implements OnModuleDestroy {
  private readonly states = new Map<string, ContentBumpState>();

  constructor(private revision: DiscoveryRevisionService) {}

  /** 本文が保存されたことを伝える。待たない（保存を遅くしない） */
  touch(workspaceId: string): void {
    const now = Date.now();
    const state = this.states.get(workspaceId);

    // 前回から 30 秒以上たっていれば、すぐ上げる
    if (!state || now - state.lastBumpAt >= CONTENT_BUMP_INTERVAL_MS) {
      this.states.set(workspaceId, { lastBumpAt: now, trailing: null });
      void this.revision.bump(workspaceId, 'doc-content');
      return;
    }

    // 30 秒以内。後追いがまだ無ければ、30 秒の終わりに 1 回だけ上げる
    if (state.trailing) {
      return;
    }
    const wait = state.lastBumpAt + CONTENT_BUMP_INTERVAL_MS - now;
    state.trailing = setTimeout(() => {
      this.states.set(workspaceId, { lastBumpAt: Date.now(), trailing: null });
      void this.revision.bump(workspaceId, 'doc-content');
    }, wait);
    // 終了の処理（onModuleDestroy）が呼ばれない起動（スクリプト等）でも、
    // この後追いのためにプロセスが 30 秒残らないように
    state.trailing.unref?.();
  }

  /** 終了時に、待っている後追いを捨てる（タイマーがプロセスの終了を止めないように） */
  onModuleDestroy(): void {
    for (const state of this.states.values()) {
      if (state.trailing) {
        clearTimeout(state.trailing);
      }
    }
    this.states.clear();
  }
}

import { Injectable, Logger } from '@nestjs/common';
import * as Y from 'yjs';
import { AuditActor, AuditEntry, AuditService } from './audit.service';
import {
  diffFolders,
  FolderChange,
  FolderChangeKind,
  FolderNode,
  readFolders,
} from './folder-diff';

const FOLDER_TARGET = 'folder';

export interface FolderPush {
  actor: AuditActor;
  workspaceId: string;
  ip?: string;
  /** 差分を当てる前の、保存済みの状態 */
  before: Uint8Array;
  /** 届いた差分 */
  update: Uint8Array;
}

/**
 * #283: フォルダの操作を監査ログに残す（docs/logging.md 2.12）。
 *
 * 同期で届いた `db$<ws>$folders` の差分を、操作ごとの 1 件に直す。
 * 名前は値で残す（消えたあとでも何だったか分かるように。2.3）。
 */
@Injectable()
export class FolderAuditService {
  private readonly logger = new Logger(FolderAuditService.name);

  constructor(private audit: AuditService) {}

  /** 例外を外へ出さない（記録のために同期を止めない。2.5） */
  async record(push: FolderPush): Promise<void> {
    let entries: AuditEntry[];
    try {
      entries = this.entriesOf(push);
    } catch (e) {
      this.logger.error(
        `フォルダの操作を読み解けませんでした (ws=${push.workspaceId}): ${(e as Error).message}`,
      );
      return;
    }

    for (const entry of entries) {
      await this.audit.record(entry);
    }
  }

  private entriesOf(push: FolderPush): AuditEntry[] {
    const changes = diffFolders(push.before, push.update);
    if (changes.length === 0) {
      return [];
    }

    // 親の名前は、あと（同じ差分で作ったフォルダ）→ 前（消えたフォルダ）の順に引く
    const prev = readFolders(push.before);
    const next = readFolders(Y.mergeUpdates([push.before, push.update]));
    const nameOf = (id: string | null) =>
      id ? (next.get(id)?.data ?? prev.get(id)?.data ?? null) : null;

    const base = {
      actor: push.actor,
      workspaceId: push.workspaceId,
      ip: push.ip,
    };
    return changes.map((change) => ({
      ...base,
      action: change.kind,
      ...this.targetOf(change.node),
      ...this.detailOf(change, nameOf),
    }));
  }

  /** フォルダはフォルダ自身、中身は入れたもの（ページ等）を対象にする */
  private targetOf(node: FolderNode) {
    if (node.type === FOLDER_TARGET) {
      return { targetType: FOLDER_TARGET, targetId: node.id, targetName: node.data };
    }
    return { targetType: node.type, targetId: node.data };
  }

  private detailOf(
    change: FolderChange,
    nameOf: (id: string | null) => string | null,
  ): Pick<AuditEntry, 'detail'> {
    const { node, before } = change;

    switch (change.kind) {
      case FolderChangeKind.Rename:
        return { detail: { before: { name: before?.data }, after: { name: node.data } } };
      case FolderChangeKind.Move:
        return {
          detail: {
            before: { parent: nameOf(before?.parentId ?? null) },
            after: { parent: nameOf(node.parentId) },
          },
        };
      case FolderChangeKind.Delete:
        return { detail: { meta: { items: change.items } } };
      case FolderChangeKind.ItemAdd:
      case FolderChangeKind.ItemRemove:
        return { detail: { meta: { folder: nameOf(node.parentId), type: node.type } } };
      case FolderChangeKind.ItemMove:
        return {
          detail: {
            before: { folder: nameOf(before?.parentId ?? null) },
            after: { folder: nameOf(node.parentId) },
          },
        };
      default:
        return {};
    }
  }
}

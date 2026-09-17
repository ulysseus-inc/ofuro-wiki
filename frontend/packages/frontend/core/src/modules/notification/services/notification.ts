import type { DocMode } from '@blocksuite/affine/model';
import { Service } from '@toeverything/infra';

import type { NotificationStore } from '../stores/notification';

export class NotificationService extends Service {
  constructor(private readonly store: NotificationStore) {
    super();
  }

  async mentionUser(
    userId: string,
    workspaceId: string,
    doc: {
      id: string;
      title: string;
      blockId?: string;
      elementId?: string;
      mode: DocMode;
    }
    // #210: バックエンドは Boolean! を返す（通知の ID ではない）。扱いは #217
  ): Promise<boolean> {
    return this.store.mentionUser(userId, workspaceId, doc);
  }
}

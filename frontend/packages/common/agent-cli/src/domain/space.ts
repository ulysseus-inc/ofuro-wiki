import type { BlobClient } from '../transport/blob';
import type { GraphqlClient } from '../transport/graphql';
import type { FetchBlob } from './assets';
import { Ledger } from './ledger';

/**
 * マニュアル用ワークスペースの ID の頭（backend/src/common/manual-workspace-id.ts と同じ）。
 * 全員が Reader で自動参加する読み取り専用の場所なので、既定の対象から外す（設計書 §4.2）
 */
const MANUAL_WORKSPACE_ID_PREFIX = 'ffffffff-ffff-4fff-bfff-';

/** アカウントが入れるワークスペース1つ */
export class Space {
  readonly ledger: Ledger;
  /** 画面に出ている名前を読んだか（Session.withNames） */
  named = false;

  constructor(
    readonly id: string,
    public name: string,
    private readonly serverUrl: string,
    graphql: GraphqlClient,
    private readonly blobs: BlobClient
  ) {
    this.ledger = new Ledger(graphql, id);
  }

  /** このワークスペースの Blob（画像・添付）を取る。鍵はページの中から取ること（§6.8） */
  get fetchBlob(): FetchBlob {
    return key => this.blobs.get(this.id, key);
  }

  /** 画像を送る（#278）。本文より先に呼ぶこと */
  uploadBlob(key: string, data: Uint8Array, mime: string): Promise<void> {
    return this.blobs.put(this.id, key, data, mime);
  }

  get manual(): boolean {
    return this.id.startsWith(MANUAL_WORKSPACE_ID_PREFIX);
  }

  /** 例: `https://wiki.example.com/workspace/<ws>`。ページ参照のリンクの基準 */
  get url(): string {
    return `${this.serverUrl}/workspace/${this.id}`;
  }

  /** 例: `https://wiki.example.com/workspace/<ws>/<docId>` */
  pageUrl(docId: string): string {
    return `${this.url}/${docId}`;
  }

  /** 例: `社内Wiki（74418457-…）` */
  get label(): string {
    return `${this.name}（${this.id}）`;
  }
}

import type { WorkspaceServerService } from '../../cloud';
import {
  getDiscoveryRevisionQuery,
  getDiscoverySnapshotQuery,
} from '@ofuro/graphql';
import { Store } from '@toeverything/infra';

import type { DiscoveryCacheEntry } from './discovery-cache';

/**
 * #151: サーバーから Discovery Index を取る。
 *
 * ⚠️ **ここは「取る」だけ。** キャッシュの正当性判定は
 * `DiscoveryCacheStore` と、それを束ねるサービスが持つ。
 */
export class DiscoveryStore extends Store {
  constructor(private readonly workspaceServerService: WorkspaceServerService) {
    super();
  }

  private get server() {
    const server = this.workspaceServerService.server;
    if (!server) throw new Error('No Server');
    return server;
  }

  /**
   * 版数だけを取る。**キャッシュが最新かの確認に使う。**
   *
   * 一覧全体より軽いので、起動時・復帰時はまずこれを見る。
   */
  async fetchRevision(workspaceId: string): Promise<string> {
    const data = await this.server.gql({
      query: getDiscoveryRevisionQuery,
      variables: { workspaceId },
    });
    const revision = data.discoveryRevision;
    // ⚠️ **null/空を素通りさせない。** decideDiscoverySource は
    // `serverRevision === null` を「サーバーに繋がらない」と解釈するため、
    // **オンラインなのに古いキャッシュを使い続ける**ことになる
    if (typeof revision !== 'string' || revision === '') {
      // ⚠️ **専用の型にする。** ただの Error だと呼び出し側の catch が
      // 「通信できない」と同じに扱い、**オフライン扱いで古いキャッシュを
      // 使ってしまう**（検査した意味が無くなる）
      throw new InvalidRevisionError();
    }
    return revision;
  }

  /** 認可済み Snapshot を取る。 */
  async fetchSnapshot(workspaceId: string): Promise<DiscoveryCacheEntry> {
    const data = await this.server.gql({
      query: getDiscoverySnapshotQuery,
      variables: { workspaceId },
    });
    const s = data.discoverySnapshot;
    return {
      workspaceId: s.workspaceId,
      // ⚠️ サーバーが返す userId をそのまま持つ。
      // 「誰にとって認可された結果か」はサーバーの判断が正
      userId: s.userId,
      revision: s.revision,
      fetchedAt: s.fetchedAt,
      documents: s.documents.map((d: (typeof s.documents)[number]) => ({
        id: d.id,
        title: d.title,
        tagIds: d.tagIds,
        mode: d.mode,
        trash: d.trash,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        createdBy: d.createdBy,
        updatedBy: d.updatedBy,
        // #151 段階3: 書き込み時の baseRevision に要る
        titleRevision: d.titleRevision,
        trashRevision: d.trashRevision,
        tagsRevision: d.tagsRevision,
      })),
    };
  }
}

/**
 * サーバーの応答が壊れている（版数が文字列でない）。
 *
 * ⚠️ **通信できないことと区別するために型を分ける。**
 * 同じ `Error` にすると、呼び出し側が「オフライン」と扱い、
 * 古いキャッシュを使い続けることになる。
 */
export class InvalidRevisionError extends Error {
  constructor() {
    super('Discovery Index の版数が不正です');
    this.name = 'InvalidRevisionError';
  }
}

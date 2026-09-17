import { getWorkspacePageByIdQuery } from '@ofuro/graphql';
import { Store } from '@toeverything/infra';

import type { WorkspaceServerService } from '../../cloud';

export class ShareStore extends Store {
  constructor(private readonly workspaceServerService: WorkspaceServerService) {
    super();
  }

  async getShareInfoByDocId(
    workspaceId: string,
    docId: string,
    signal?: AbortSignal
  ) {
    if (!this.workspaceServerService.server) {
      throw new Error('No Server');
    }
    const data = await this.workspaceServerService.server.gql({
      query: getWorkspacePageByIdQuery,
      variables: {
        pageId: docId,
        workspaceId,
      },
      context: {
        signal,
      },
    });
    return data.workspace.doc ?? undefined;
  }
}

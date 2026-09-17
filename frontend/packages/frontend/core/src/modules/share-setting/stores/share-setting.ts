import type { WorkspaceServerService } from '@ofuro/core/modules/cloud';
import { getWorkspaceConfigQuery } from '@ofuro/graphql';
import { Store } from '@toeverything/infra';

export class WorkspaceShareSettingStore extends Store {
  constructor(private readonly workspaceServerService: WorkspaceServerService) {
    super();
  }

  async fetchWorkspaceConfig(workspaceId: string, signal?: AbortSignal) {
    if (!this.workspaceServerService.server) {
      throw new Error('No Server');
    }
    const data = await this.workspaceServerService.server.gql({
      query: getWorkspaceConfigQuery,
      variables: {
        id: workspaceId,
      },
      context: {
        signal,
      },
    });
    return data.workspace;
  }
}

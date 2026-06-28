import { ServerDeploymentType } from '@ofuro/graphql';
import { Service } from '@toeverything/infra';

import type { Server } from '../entities/server';
import type { ServersService } from './servers';

export class DefaultServerService extends Service {
  readonly server: Server;

  constructor(private readonly serversService: ServersService) {
    super();

    // Keep servers$ subscribed to prevent ObjectPool GC from disposing the Server.
    // LiveData.from uses lazy subscription: without an active watcher, reading .value
    // triggers a temporary subscribe/unsubscribe cycle that releases ObjectPool refs,
    // causing the Server entity (and its ServerScope) to be disposed after 1 second.
    const subscription = this.serversService.servers$.subscribe(() => {});
    this.disposables.push(() => subscription.unsubscribe());

    // global server is always ofuro-cloud
    const server = this.serversService.server$('ofuro-cloud').value;
    if (!server) {
      throw new Error('No server found');
    }
    this.server = server;
  }

  async waitForSelfhostedServerConfig() {
    if (this.server.config$.value.type === ServerDeploymentType.Selfhosted) {
      await this.server.waitForConfigRevalidation();
    }
  }
}

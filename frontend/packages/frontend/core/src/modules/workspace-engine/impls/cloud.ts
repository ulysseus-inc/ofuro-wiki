import { DebugLogger } from '@ofuro/debug';
import {
  createDocMetaMutation,
  createWorkspaceMutation,
  deleteWorkspaceMutation,
  getWorkspaceInfoQuery,
  getWorkspacesQuery,
  Permission,
  ServerDeploymentType,
  ServerFeature,
} from '@ofuro/graphql';
import type {
  BlobStorage,
  DocStorage,
  ListedBlobRecord,
} from '@ofuro/nbstore';
import { CloudBlobStorage, StaticCloudDocStorage } from '@ofuro/nbstore/cloud';
import {
  IndexedDBBlobStorage,
  IndexedDBBlobSyncStorage,
  IndexedDBDocStorage,
  IndexedDBDocSyncStorage,
  IndexedDBIndexerStorage,
  IndexedDBIndexerSyncStorage,
} from '@ofuro/nbstore/idb';
import {
  IndexedDBV1BlobStorage,
  IndexedDBV1DocStorage,
} from '@ofuro/nbstore/idb/v1';
import {
  SqliteBlobStorage,
  SqliteBlobSyncStorage,
  SqliteDocStorage,
  SqliteDocSyncStorage,
  SqliteIndexerStorage,
  SqliteIndexerSyncStorage,
} from '@ofuro/nbstore/sqlite';
import {
  SqliteV1BlobStorage,
  SqliteV1DocStorage,
} from '@ofuro/nbstore/sqlite/v1';
import type { WorkerInitOptions } from '@ofuro/nbstore/worker/client';
import {
  catchErrorInto,
  effect,
  exhaustMapSwitchUntilChanged,
  fromPromise,
  LiveData,
  ObjectPool,
  onComplete,
  onStart,
  Service,
} from '@toeverything/infra';
import { isEqual } from 'lodash-es';
import { map, Observable, switchMap, tap } from 'rxjs';
import {
  applyUpdate,
  type Array as YArray,
  Doc as YDoc,
  encodeStateAsUpdate,
  type Map as YMap,
} from 'yjs';

import type { Server, ServersService } from '../../cloud';
import {
  AccountChanged,
  AuthService,
  GraphQLService,
  WorkspaceServerService,
} from '../../cloud';
import type { GlobalState } from '../../storage';
import type {
  Workspace,
  WorkspaceFlavourProvider,
  WorkspaceFlavoursProvider,
  WorkspaceMetadata,
  WorkspaceProfileInfo,
} from '../../workspace';
import { WorkspaceImpl } from '../../workspace/impls/workspace';
import { getWorkspaceProfileWorker } from './out-worker';

const getCloudWorkspaceCacheKey = (serverId: string) => {
  if (serverId === 'ofuro-cloud') {
    return 'cloud-workspace:'; // FOR BACKWARD COMPATIBILITY
  }
  return `selfhosted-workspace-${serverId}:`;
};

const logger = new DebugLogger('ofuro:cloud-workspace-flavour-provider');

class CloudWorkspaceFlavourProvider implements WorkspaceFlavourProvider {
  private readonly authService: AuthService;
  private readonly graphqlService: GraphQLService;
  private readonly unsubscribeAccountChanged: () => void;

  constructor(
    private readonly globalState: GlobalState,
    private readonly server: Server
  ) {
    this.authService = server.scope.get(AuthService);
    this.graphqlService = server.scope.get(GraphQLService);
    this.unsubscribeAccountChanged = this.server.scope.eventBus.on(
      AccountChanged,
      () => {
        this.revalidate();
      }
    );
  }

  readonly flavour = this.server.id;

  DocStorageType =
    BUILD_CONFIG.isElectron || BUILD_CONFIG.isIOS || BUILD_CONFIG.isAndroid
      ? SqliteDocStorage
      : IndexedDBDocStorage;
  DocStorageV1Type = BUILD_CONFIG.isElectron
    ? SqliteV1DocStorage
    : BUILD_CONFIG.isWeb || BUILD_CONFIG.isMobileWeb
      ? IndexedDBV1DocStorage
      : undefined;
  BlobStorageType =
    BUILD_CONFIG.isElectron || BUILD_CONFIG.isIOS || BUILD_CONFIG.isAndroid
      ? SqliteBlobStorage
      : IndexedDBBlobStorage;
  BlobStorageV1Type = BUILD_CONFIG.isElectron
    ? SqliteV1BlobStorage
    : BUILD_CONFIG.isWeb || BUILD_CONFIG.isMobileWeb
      ? IndexedDBV1BlobStorage
      : undefined;
  DocSyncStorageType =
    BUILD_CONFIG.isElectron || BUILD_CONFIG.isIOS || BUILD_CONFIG.isAndroid
      ? SqliteDocSyncStorage
      : IndexedDBDocSyncStorage;
  BlobSyncStorageType =
    BUILD_CONFIG.isElectron || BUILD_CONFIG.isIOS || BUILD_CONFIG.isAndroid
      ? SqliteBlobSyncStorage
      : IndexedDBBlobSyncStorage;
  IndexerStorageType =
    BUILD_CONFIG.isElectron || BUILD_CONFIG.isIOS || BUILD_CONFIG.isAndroid
      ? SqliteIndexerStorage
      : IndexedDBIndexerStorage;
  IndexerSyncStorageType = BUILD_CONFIG.isElectron
    ? SqliteIndexerSyncStorage
    : IndexedDBIndexerSyncStorage;

  async deleteWorkspace(id: string): Promise<void> {
    await this.graphqlService.gql({
      query: deleteWorkspaceMutation,
      variables: {
        id: id,
      },
    });
    // TODO(@forehalo): when deleting cloud workspace, should we delete the workspace folder in local?
    this.revalidate();
    await this.waitForLoaded();
  }

  async createWorkspace(
    initial: (
      docCollection: WorkspaceImpl,
      blobStorage: BlobStorage,
      docStorage: DocStorage
    ) => Promise<void>
  ): Promise<WorkspaceMetadata> {
    // create workspace on cloud, get workspace id
    const {
      createWorkspace: { id: workspaceId },
    } = await this.graphqlService.gql({
      query: createWorkspaceMutation,
    });

    // save the initial state to local storage, then sync to cloud
    const blobStorage = new this.BlobStorageType({
      id: workspaceId,
      flavour: this.flavour,
      type: 'workspace',
    });
    blobStorage.connection.connect();
    await blobStorage.connection.waitForConnected();
    const docStorage = new this.DocStorageType({
      id: workspaceId,
      flavour: this.flavour,
      type: 'workspace',
    });
    docStorage.connection.connect();
    await docStorage.connection.waitForConnected();

    const docList = new Set<YDoc>();

    const docCollection = new WorkspaceImpl({
      id: workspaceId,
      rootDoc: new YDoc({ guid: workspaceId }),
      blobSource: {
        get: async key => {
          const record = await blobStorage.get(key);
          return record ? new Blob([record.data], { type: record.mime }) : null;
        },
        delete: async () => {
          return;
        },
        list: async () => {
          return [];
        },
        set: async (id, blob) => {
          await blobStorage.set({
            key: id,
            data: new Uint8Array(await blob.arrayBuffer()),
            mime: blob.type,
          });
          return id;
        },
        name: 'blob',
        readonly: false,
      },
      onLoadDoc: doc => {
        docList.add(doc);
      },
    });

    try {
      // apply initial state
      await initial(docCollection, blobStorage, docStorage);

      // #151 stage 3: the template pages created above go straight into the
      // root doc's shared index, which is delivered to every member. Every
      // other page goes through the ledger (PR5-a), so this creation path was
      // the one place where titles still leaked into the shared index.
      //
      // WARNING: order matters. The ledger must own these rows BEFORE the
      // index is cleared - the server learns about index-only pages by reading
      // that index, so clearing first would make the template pages vanish
      // instead of merely becoming private. If the ledger write fails we keep
      // the index untouched: a leaked title is recoverable, a lost page is not.
      const templateDocs = readInitialIndex(docCollection.doc);
      const registered = await this.registerInitialDocs(
        workspaceId,
        templateDocs
      );
      if (registered) {
        clearInitialIndex(docCollection.doc);
      }

      // save workspace to local storage, should be vary fast
      for (const subdocs of docList) {
        await docStorage.pushDocUpdate({
          docId: subdocs.guid,
          bin: encodeStateAsUpdate(subdocs),
        });
      }

      const accountId = this.authService.session.account$.value?.id;
      await this.writeInitialDocProperties(
        docStorage,
        accountId ?? '',
        // #151 stage 3: this used to re-read the ids from the shared index,
        // which we have just emptied. Pass what we captured before clearing.
        templateDocs.map(d => d.id)
      );

      docStorage.connection.disconnect();
      blobStorage.connection.disconnect();

      this.revalidate();
      await this.waitForLoaded();
    } finally {
      docCollection.dispose();
    }

    return {
      id: workspaceId,
      flavour: this.server.id,
    };
  }
  revalidate = effect(
    map(() => {
      return { accountId: this.authService.session.account$.value?.id };
    }),
    exhaustMapSwitchUntilChanged(
      (a, b) => a.accountId === b.accountId,
      ({ accountId }) => {
        return fromPromise(async signal => {
          if (!accountId) {
            return null; // no cloud workspace if no account
          }

          const { workspaces } = await this.graphqlService.gql({
            query: getWorkspacesQuery,
            context: {
              signal,
            },
          });

          const ids = workspaces.map(({ id, initialized }) => ({
            id,
            initialized,
          }));
          return {
            accountId,
            workspaces: ids.map(({ id, initialized }) => ({
              id,
              flavour: this.server.id,
              initialized,
            })),
          };
        }).pipe(
          tap(data => {
            if (data) {
              const { accountId, workspaces } = data;
              const sorted = workspaces.sort((a, b) => {
                return a.id.localeCompare(b.id);
              });
              this.globalState.set(
                getCloudWorkspaceCacheKey(this.server.id) + accountId,
                sorted
              );
              if (!isEqual(this.workspaces$.value, sorted)) {
                this.workspaces$.next(sorted);
              }
            } else {
              this.workspaces$.next([]);
            }
          }),
          catchErrorInto(this.error$, err => {
            logger.error('error to revalidate cloud workspaces', err);
          }),
          onStart(() => this.isRevalidating$.next(true)),
          onComplete(() => this.isRevalidating$.next(false))
        );
      },
      ({ accountId }) => {
        if (accountId) {
          this.workspaces$.next(
            this.globalState.get(
              getCloudWorkspaceCacheKey(this.server.id) + accountId
            ) ?? []
          );
        } else {
          this.workspaces$.next([]);
        }
      }
    )
  );

  error$ = new LiveData<any>(null);
  isRevalidating$ = new LiveData(false);
  workspaces$ = new LiveData<WorkspaceMetadata[]>([]);

  async getWorkspaceProfile(
    id: string,
    signal?: AbortSignal
  ): Promise<WorkspaceProfileInfo | undefined> {
    // get information from both cloud and local storage

    // we use affine 'static' storage here, which use http protocol, no need to websocket.
    const cloudStorage = new StaticCloudDocStorage({
      id: id,
      serverBaseUrl: this.server.serverMetadata.baseUrl,
    });
    const docStorage = new this.DocStorageType({
      id: id,
      flavour: this.flavour,
      type: 'workspace',
      readonlyMode: true,
    });
    docStorage.connection.connect();
    await docStorage.connection.waitForConnected();
    // download root doc
    const localData = (await docStorage.getDoc(id))?.bin;
    const cloudData = (await cloudStorage.getDoc(id))?.bin;

    const isEmpty = isEmptyUpdate(localData) && isEmptyUpdate(cloudData);

    docStorage.connection.disconnect();

    const info = await this.getWorkspaceInfo(id, signal);

    if (!cloudData && !localData) {
      return {
        isOwner: info.workspace.role === Permission.Owner,
        isAdmin: info.workspace.role === Permission.Admin,
        isTeam: info.workspace.team,
        isEmpty,
      };
    }

    const client = getWorkspaceProfileWorker();

    const result = await client.call(
      'renderWorkspaceProfile',
      [localData, cloudData].filter(Boolean) as Uint8Array[]
    );

    return {
      name: result.name,
      avatar: result.avatar,
      isOwner: info.workspace.role === Permission.Owner,
      isAdmin: info.workspace.role === Permission.Admin,
      isTeam: info.workspace.team,
      isEmpty,
    };
  }

  async getWorkspaceBlob(id: string, blob: string): Promise<Blob | null> {
    const storage = new this.BlobStorageType({
      id: id,
      flavour: this.flavour,
      type: 'workspace',
    });
    storage.connection.connect();
    await storage.connection.waitForConnected();
    const localBlob = await storage.get(blob);

    storage.connection.disconnect();

    if (localBlob) {
      return new Blob([localBlob.data], { type: localBlob.mime });
    }

    const cloudBlob = await new CloudBlobStorage({
      id,
      serverBaseUrl: this.server.serverMetadata.baseUrl,
    }).get(blob);
    if (!cloudBlob) {
      return null;
    }
    return new Blob([cloudBlob.data], { type: cloudBlob.mime });
  }

  async listBlobs(id: string): Promise<ListedBlobRecord[]> {
    const cloudStorage = new CloudBlobStorage({
      id,
      serverBaseUrl: this.server.serverMetadata.baseUrl,
    });
    return cloudStorage.list();
  }

  async deleteBlob(
    id: string,
    blob: string,
    permanent: boolean
  ): Promise<void> {
    const cloudStorage = new CloudBlobStorage({
      id,
      serverBaseUrl: this.server.serverMetadata.baseUrl,
    });
    await cloudStorage.delete(blob, permanent);

    // should also delete from local storage
    const storage = new this.BlobStorageType({
      id: id,
      flavour: this.flavour,
      type: 'workspace',
    });
    storage.connection.connect();
    await storage.connection.waitForConnected();
    await storage.delete(blob, permanent);
    storage.connection.disconnect();
  }

  onWorkspaceInitialized(workspace: Workspace): void {
    // bind the workspace to the affine cloud server
    workspace.scope.get(WorkspaceServerService).bindServer(this.server);
  }

  private async getWorkspaceInfo(workspaceId: string, signal?: AbortSignal) {
    return await this.graphqlService.gql({
      query: getWorkspaceInfoQuery,
      variables: {
        workspaceId,
      },
      context: { signal },
    });
  }

  getEngineWorkerInitOptions(workspaceId: string): WorkerInitOptions {
    return {
      local: {
        doc: {
          name: this.DocStorageType.identifier,
          opts: {
            flavour: this.flavour,
            type: 'workspace',
            id: workspaceId,
          },
        },
        blob: {
          name: this.BlobStorageType.identifier,
          opts: {
            flavour: this.flavour,
            type: 'workspace',
            id: workspaceId,
          },
        },
        docSync: {
          name: this.DocSyncStorageType.identifier,
          opts: {
            flavour: this.flavour,
            type: 'workspace',
            id: workspaceId,
          },
        },
        blobSync: {
          name: this.BlobSyncStorageType.identifier,
          opts: {
            flavour: this.flavour,
            type: 'workspace',
            id: workspaceId,
          },
        },
        awareness: {
          name: 'BroadcastChannelAwarenessStorage',
          opts: {
            id: `${this.flavour}:${workspaceId}`,
          },
        },
        indexer: {
          name: this.IndexerStorageType.identifier,
          opts: {
            flavour: this.flavour,
            type: 'workspace',
            id: workspaceId,
          },
        },
        indexerSync: {
          name: this.IndexerSyncStorageType.identifier,
          opts: {
            flavour: this.flavour,
            type: 'workspace',
            id: workspaceId,
          },
        },
      },
      remotes: {
        [`cloud:${this.flavour}`]: {
          doc: {
            name: 'CloudDocStorage',
            opts: {
              type: 'workspace',
              id: workspaceId,
              serverBaseUrl: this.server.serverMetadata.baseUrl,
              isSelfHosted:
                this.server.config$.value.type ===
                ServerDeploymentType.Selfhosted,
            },
          },
          blob: {
            name: 'CloudBlobStorage',
            opts: {
              id: workspaceId,
              serverBaseUrl: this.server.serverMetadata.baseUrl,
            },
          },
          awareness: {
            name: 'CloudAwarenessStorage',
            opts: {
              type: 'workspace',
              id: workspaceId,
              serverBaseUrl: this.server.serverMetadata.baseUrl,
              isSelfHosted:
                this.server.config$.value.type ===
                ServerDeploymentType.Selfhosted,
            },
          },
          indexer: this.server.config$.value.features.includes(
            ServerFeature.Indexer
          )
            ? {
                name: 'CloudIndexerStorage',
                opts: {
                  flavour: this.flavour,
                  type: 'workspace',
                  id: workspaceId,
                  serverBaseUrl: this.server.serverMetadata.baseUrl,
                },
              }
            : undefined,
        },
        v1: {
          doc: this.DocStorageV1Type
            ? {
                name: this.DocStorageV1Type.identifier,
                opts: {
                  id: workspaceId,
                  type: 'workspace',
                },
              }
            : undefined,
          blob: this.BlobStorageV1Type
            ? {
                name: this.BlobStorageV1Type.identifier,
                opts: {
                  id: workspaceId,
                  type: 'workspace',
                },
              }
            : undefined,
        },
      },
    };
  }

  /**
   * #151 stage 3: register the workspace's template pages in the server
   * ledger, so their titles never have to travel through the shared index.
   *
   * Returns whether every row was written. The caller must not clear the
   * index unless this returns true.
   */
  private async registerInitialDocs(
    workspaceId: string,
    docs: Array<{ id: string; title: string }>
  ): Promise<boolean> {
    try {
      for (const doc of docs) {
        // `as never`: createDocMetaMutation is hand-written and so is missing
        // from codegen's schema map (#131), which types gql() as never. The
        // same workaround is used in discovery/stores/doc-meta-write.ts.
        await this.graphqlService.gql({
          query: createDocMetaMutation,
          variables: {
            workspaceId,
            docId: doc.id,
            title: doc.title,
            mode: 'page',
          },
        } as never);
      }
      return true;
    } catch (error) {
      // Keep the index. The pages stay visible to everyone, which is the old
      // behaviour - worse for privacy, but nothing is lost. A later purge run
      // cleans it up once the ledger has caught up.
      //
      // Partial success needs no unwinding: createDocMeta is an idempotent
      // upsert that leaves an existing row untouched, so the rows already
      // written are simply correct, and the server fills in the rest by
      // reading the index we just kept. Retrying cannot duplicate them.
      logger.error('failed to register initial docs in the ledger', error);
      return false;
    }
  }

  async writeInitialDocProperties(
    docStorage: DocStorage,
    creatorId: string,
    docIds: string[]
  ) {
    try {
      const propertiesDBBuffer = await docStorage.getDoc('db$docProperties');
      const propertiesDB = new YDoc({ guid: 'db$docProperties' });
      if (propertiesDBBuffer) {
        applyUpdate(propertiesDB, propertiesDBBuffer.bin);
      }

      for (const docId of docIds) {
        const docProperties = propertiesDB.getMap(docId);
        docProperties.set('id', docId);
        docProperties.set('createdBy', creatorId);
      }

      await docStorage.pushDocUpdate({
        docId: 'db$docProperties',
        bin: encodeStateAsUpdate(propertiesDB),
      });
    } catch (error) {
      logger.error('error to write initial doc properties', error);
    }
  }

  private waitForLoaded() {
    return this.isRevalidating$.waitFor(loading => !loading);
  }

  dispose() {
    this.revalidate.unsubscribe();
    this.unsubscribeAccountChanged();
  }
}

export class CloudWorkspaceFlavoursProvider
  extends Service
  implements WorkspaceFlavoursProvider
{
  constructor(
    private readonly globalState: GlobalState,
    private readonly serversService: ServersService
  ) {
    super();
  }

  workspaceFlavours$ = LiveData.from<WorkspaceFlavourProvider[]>(
    this.serversService.servers$.pipe(
      switchMap(servers => {
        const refs = servers.map(server => {
          const exists = this.pool.get(server.id);
          if (exists) {
            return exists;
          }
          const provider = new CloudWorkspaceFlavourProvider(
            this.globalState,
            server
          );
          provider.revalidate();
          const ref = this.pool.put(server.id, provider);
          return ref;
        });

        return new Observable<WorkspaceFlavourProvider[]>(subscribe => {
          subscribe.next(refs.map(ref => ref.obj));
          return () => {
            refs.forEach(ref => {
              ref.release();
            });
          };
        });
      })
    ),
    [] as any
  );

  private readonly pool = new ObjectPool<string, CloudWorkspaceFlavourProvider>(
    {
      onDelete(obj) {
        obj.dispose();
      },
    }
  );
}

export function isEmptyUpdate(binary: Uint8Array | undefined) {
  if (!binary) {
    return true;
  }
  return (
    binary.byteLength === 0 ||
    (binary.byteLength === 2 && binary[0] === 0 && binary[1] === 0)
  );
}

/**
 * #151 stage 3: read the pages the workspace template just put in the shared
 * index, so they can be handed to the ledger before the index is cleared.
 */
function readInitialIndex(rootDoc: YDoc): Array<{ id: string; title: string }> {
  const pages = rootDoc.getMap('meta').get('pages') as
    | YArray<YMap<string>>
    | undefined;
  if (!pages) return [];
  const docs: Array<{ id: string; title: string }> = [];
  for (const page of pages) {
    const id = page.get('id');
    if (typeof id !== 'string' || !id) continue;
    docs.push({ id, title: page.get('title') ?? '' });
  }
  return docs;
}

/**
 * #151 stage 3: empty the shared index.
 *
 * WARNING: only safe once the ledger owns these pages. See the call site.
 */
function clearInitialIndex(rootDoc: YDoc) {
  const pages = rootDoc.getMap('meta').get('pages') as
    | YArray<YMap<string>>
    | undefined;
  if (!pages || pages.length === 0) return;
  pages.delete(0, pages.length);
}

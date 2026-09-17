import { FeatureFlagService } from '@ofuro/core/modules/feature-flag';

export type { WorkspaceProfileInfo } from './entities/profile';
export { Workspace } from './entities/workspace';
export { WorkspaceEngineBeforeStart, WorkspaceInitialized } from './events';
export { getAFFiNEWorkspaceSchema } from './global-schema';
export type { WorkspaceMetadata } from './metadata';
export type { WorkspaceOpenOptions } from './open-options';
export type { WorkspaceFlavourProvider } from './providers/flavour';
export { WorkspaceFlavoursProvider } from './providers/flavour';
export type { RootDocLoadState } from './root-doc-state';
export { decideRootDocState } from './root-doc-state';
export { WorkspaceLocalCache, WorkspaceLocalState } from './providers/storage';
export { WorkspaceScope } from './scopes/workspace';
export { WorkspaceService } from './services/workspace';
export { WorkspacesService } from './services/workspaces';

import type { Framework } from '@toeverything/infra';

import { GlobalCache, GlobalState, NbstoreService } from '../storage';
import { WorkspaceEngine } from './entities/engine';
import { WorkspaceList } from './entities/list';
import { WorkspaceProfile } from './entities/profile';
import { Workspace } from './entities/workspace';
import {
  WorkspaceLocalCacheImpl,
  WorkspaceLocalStateImpl,
} from './impls/storage';
import { WorkspaceFlavoursProvider } from './providers/flavour';
import { WorkspaceLocalCache, WorkspaceLocalState } from './providers/storage';
import { WorkspaceScope } from './scopes/workspace';
// ⚠️ バレルから読まないこと（循環参照になる）
import { DocMetaWriteService } from '../discovery/services/doc-meta-write';
import { WorkspaceDestroyService } from './services/destroy';
import { WorkspaceEngineService } from './services/engine';
import { WorkspaceFactoryService } from './services/factory';
import { WorkspaceFlavoursService } from './services/flavours';
import { WorkspaceListService } from './services/list';
import { WorkspaceProfileService } from './services/profile';
import { WorkspaceRepositoryService } from './services/repo';
import { WorkspaceTransformService } from './services/transform';
import { WorkspaceService } from './services/workspace';
import { WorkspacesService } from './services/workspaces';
import { WorkspaceProfileCacheStore } from './stores/profile-cache';

export function configureWorkspaceModule(framework: Framework) {
  framework
    .service(WorkspacesService, [
      WorkspaceFlavoursService,
      WorkspaceListService,
      WorkspaceProfileService,
      WorkspaceTransformService,
      WorkspaceRepositoryService,
      WorkspaceFactoryService,
      WorkspaceDestroyService,
    ])
    .service(WorkspaceFlavoursService, [[WorkspaceFlavoursProvider]])
    .service(WorkspaceDestroyService, [WorkspaceFlavoursService])
    .service(WorkspaceListService)
    .entity(WorkspaceList, [WorkspaceFlavoursService])
    .service(WorkspaceProfileService)
    .store(WorkspaceProfileCacheStore, [GlobalCache])
    .entity(WorkspaceProfile, [
      WorkspaceProfileCacheStore,
      WorkspaceFlavoursService,
    ])
    .service(WorkspaceFactoryService, [WorkspaceFlavoursService])
    .service(WorkspaceTransformService, [
      WorkspaceFactoryService,
      WorkspaceDestroyService,
    ])
    .service(WorkspaceRepositoryService, [
      WorkspaceFlavoursService,
      WorkspaceProfileService,
      WorkspaceListService,
    ])
    .scope(WorkspaceScope)
    .service(WorkspaceService)
    // #151 段階3: DocMetaWriteService はメタデータの変更をサーバーへ送る
    .entity(Workspace, [WorkspaceScope, FeatureFlagService, DocMetaWriteService])
    .service(WorkspaceEngineService, [WorkspaceScope])
    .entity(WorkspaceEngine, [
      WorkspaceService,
      NbstoreService,
      FeatureFlagService,
    ])
    .impl(WorkspaceLocalState, WorkspaceLocalStateImpl, [
      WorkspaceService,
      GlobalState,
    ])
    .impl(WorkspaceLocalCache, WorkspaceLocalCacheImpl, [
      WorkspaceService,
      GlobalCache,
    ]);
}

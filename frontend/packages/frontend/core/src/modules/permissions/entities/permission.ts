import { Permission, WorkspaceKind } from '@ofuro/graphql';
import {
  backoffRetry,
  effect,
  Entity,
  exhaustMapWithTrailing,
  fromPromise,
  LiveData,
  onComplete,
  onStart,
} from '@toeverything/infra';
import { tap } from 'rxjs';

import type { WorkspaceService } from '../../workspace';
import type { WorkspacePermissionStore } from '../stores/permission';

export class WorkspacePermission extends Entity {
  private readonly cache$ = LiveData.from(
    this.store.watchWorkspacePermissionCache(),
    undefined
  );
  isOwner$ = this.cache$.map(cache => cache?.isOwner ?? null);
  isAdmin$ = this.cache$.map(cache => cache?.isAdmin ?? null);
  isOwnerOrAdmin$ = this.cache$.map(
    cache => (cache?.isOwner ?? null) || (cache?.isAdmin ?? null)
  );
  isTeam$ = this.cache$.map(cache => cache?.isTeam ?? null);
  /** #297: 共有ワークスペースか（docs/workspace-model.md 12.8.3）。画面の出し分けに使う */
  isShared$ = this.cache$.map(cache => cache?.isShared ?? null);
  isRevalidating$ = new LiveData(false);

  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly store: WorkspacePermissionStore
  ) {
    super();
  }

  revalidate = effect(
    exhaustMapWithTrailing(() => {
      return fromPromise(async signal => {
        if (
          this.workspaceService.workspace.flavour !== 'local' &&
          !this.workspaceService.workspace.openOptions.isSharedMode
        ) {
          const info = await this.store.fetchWorkspaceInfo(
            this.workspaceService.workspace.id,
            signal
          );

          return {
            isOwner: info.workspace.role === Permission.Owner,
            isAdmin: info.workspace.role === Permission.Admin,
            isTeam: info.workspace.team,
            isShared: info.workspace.kind === WorkspaceKind.Shared,
          };
        } else {
          return { isOwner: true, isAdmin: false, isTeam: false, isShared: false };
        }
      }).pipe(
        backoffRetry({
          count: Infinity,
        }),
        tap(({ isOwner, isAdmin, isTeam, isShared }) => {
          this.store.setWorkspacePermissionCache({
            isOwner,
            isAdmin,
            isTeam,
            isShared,
          });
        }),
        onStart(() => this.isRevalidating$.setValue(true)),
        onComplete(() => this.isRevalidating$.setValue(false))
      );
    })
  );

  async waitForRevalidation(signal?: AbortSignal) {
    this.revalidate();
    await this.isRevalidating$.waitFor(
      isRevalidating => !isRevalidating,
      signal
    );
  }

  override dispose(): void {
    this.revalidate.unsubscribe();
  }
}

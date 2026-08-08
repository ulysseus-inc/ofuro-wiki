import {
  type GetDocRolePermissionsQuery,
  getDocRolePermissionsQuery,
  type GetWorkspaceInfoQuery,
  getWorkspaceInfoQuery,
} from '@ofuro/graphql';
import { Store } from '@toeverything/infra';

import type { WorkspaceServerService } from '../../cloud';
import type { WorkspaceService } from '../../workspace';

export type WorkspacePermissionActions = keyof Omit<
  GetWorkspaceInfoQuery['workspace']['permissions'],
  '__typename'
>;

export type DocPermissionActions = keyof Omit<
  NonNullable<GetDocRolePermissionsQuery['workspace']['doc']['permissions']>,
  '__typename'
>;

export class GuardStore extends Store {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceServerService: WorkspaceServerService
  ) {
    super();
  }

  async getWorkspacePermissions(): Promise<
    Record<WorkspacePermissionActions, boolean>
  > {
    if (!this.workspaceServerService.server) {
      throw new Error('No server');
    }
    const data = await this.workspaceServerService.server.gql({
      query: getWorkspaceInfoQuery,
      variables: {
        workspaceId: this.workspaceService.workspace.id,
      },
    });
    return data.workspace.permissions;
  }

  async getDocPermissions(
    docId: string
  ): Promise<Record<DocPermissionActions, boolean>> {
    if (!this.workspaceServerService.server) {
      throw new Error('No server');
    }
    const data = await this.workspaceServerService.server.gql({
      query: getDocRolePermissionsQuery,
      variables: {
        workspaceId: this.workspaceService.workspace.id,
        docId,
      },
    });
    // #97: ⚠️ 読めない doc は `doc: null` が返る（存在を伝えないため）。
    // ここで例外にせず、**すべて不可**として扱う。
    // そのまま `.permissions` を読むと TypeError になり、
    // 画面が「権限の判定に失敗した」ではなく**壊れた**状態になる。
    const permissions = data.workspace.doc?.permissions;
    if (!permissions) return denyAll();
    return permissions;
  }
}

/**
 * すべてのアクションを不可として返す。
 *
 * ⚠️ **キーはクエリが返す項目から作らない**（null のときは何も返らない）。
 * 判定できないときに「不可」へ倒すのが安全側である。
 */
function denyAll(): Record<DocPermissionActions, boolean> {
  const actions = [
    'Doc_Copy',
    'Doc_Delete',
    'Doc_Duplicate',
    'Doc_Properties_Read',
    'Doc_Properties_Update',
    'Doc_Publish',
    'Doc_Read',
    'Doc_Restore',
    'Doc_TransferOwner',
    'Doc_Trash',
    'Doc_Update',
    'Doc_Users_Manage',
    'Doc_Users_Read',
    'Doc_Comments_Create',
    'Doc_Comments_Read',
    'Doc_Comments_Delete',
    'Doc_Comments_Resolve',
  ] as const;
  return Object.fromEntries(actions.map((a) => [a, false])) as Record<
    DocPermissionActions,
    boolean
  >;
}

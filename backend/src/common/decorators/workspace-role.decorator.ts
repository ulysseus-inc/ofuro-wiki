import { SetMetadata } from '@nestjs/common';

/**
 * ワークスペース内ロールの階層（数値が大きいほど強い権限）。
 * サーバ全体 Admin（user.isAdmin）はこれとは別軸で、ガード側でバイパスする。
 */
export const WORKSPACE_ROLE_RANK: Record<string, number> = {
  reader: 1,
  member: 2,
  admin: 3,
  owner: 4,
};

export type WorkspaceRoleName = 'reader' | 'member' | 'admin' | 'owner';

export const WORKSPACE_ROLE_KEY = 'workspace_role_requirement';

export interface WorkspaceRoleRequirement {
  /** 要求する最低ロール */
  minRole: WorkspaceRoleName;
  /** workspaceId を取り出す引数/パラメータ/ボディのキー名（既定: workspaceId） */
  argName: string;
}

/**
 * ハンドラに「このワークスペースの最低ロール」を要求する。
 * `WorkspaceMemberGuard` と併用する（`@UseGuards(WorkspaceMemberGuard)`）。
 *
 * @param minRole 要求する最低ロール（既定: 'member'）
 * @param argName workspaceId を取り出すキー名（既定: 'workspaceId'）
 */
export const WorkspaceRole = (
  minRole: WorkspaceRoleName = 'member',
  argName = 'workspaceId',
) => SetMetadata(WORKSPACE_ROLE_KEY, { minRole, argName });

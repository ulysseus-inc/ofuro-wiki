/**
 * マニュアル専用ワークスペースの ID の決まり（#72 / #241）。
 *
 * `ManualWorkspaceService.workspaceIdForVersion` が
 * `ffffffff-ffff-4fff-bfff-<内容版のハッシュ>` の形で作る。
 * 末尾は内容が変わるたびに変わるため、**先頭で判定する**。
 *
 * ⚠️ 判定と生成で別々に書かない（片方だけ直すと食い違う）。
 */
export const MANUAL_WORKSPACE_ID_PREFIX = 'ffffffff-ffff-4fff-bfff-';

export function isManualWorkspace(workspaceId: string): boolean {
  return workspaceId.startsWith(MANUAL_WORKSPACE_ID_PREFIX);
}

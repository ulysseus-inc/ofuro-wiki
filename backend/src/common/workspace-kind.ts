/**
 * #297: ワークスペースの種類（docs/workspace-model.md 12.1）。
 *
 * | 種類 | 数 | 入れる人 | システム管理者 |
 * |---|---|---|---|
 * | private | 1 人 1 つ | 本人だけ | **素通りしない**（画面から開けない） |
 * | shared | いくつでも | 招待された人 | 素通りする（すべて管理できる） |
 */
export enum WorkspaceKind {
  Private = 'private',
  Shared = 'shared',
}

/**
 * システム管理者が、メンバーでなくてもこのワークスペースを素通りするか（12.2）。
 *
 * ⚠️ **規則はここ 1 か所に置く。** 素通りは 3 か所（入口のガード・ページの権限・同期）にあり、
 * 以前はどれも種類を見ずに**プライベートも通していた**。
 */
export function systemAdminBypasses(
  isAdmin: boolean | undefined,
  kind: string | undefined,
): boolean {
  return isAdmin === true && kind === WorkspaceKind.Shared;
}

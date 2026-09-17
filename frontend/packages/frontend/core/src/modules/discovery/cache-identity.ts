/**
 * #151: キャッシュの中身が、**その利用者・そのワークスペースのもの**か。
 *
 * ⚠️ **鍵が一致しても、中身の保証にはならない。**
 * 保存時の不具合や手動改変で入れ替わっていた場合、
 * **他人の一覧を見せてしまう**。読み出すすべての経路で確かめる。
 *
 * ⚠️ 「誰にとって認可された結果か」はキャッシュの正当性そのものなので、
 * 判定を1か所に置いて検査で固定する（`decide.ts` と同じ方針）。
 */
export function isEntryFor<T extends { workspaceId: string; userId: string }>(
  entry: T | undefined,
  workspaceId: string,
  userId: string,
): entry is T {
  if (!entry) return false;
  return entry.workspaceId === workspaceId && entry.userId === userId;
}

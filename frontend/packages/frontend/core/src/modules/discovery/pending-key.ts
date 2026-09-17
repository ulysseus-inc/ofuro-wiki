/**
 * #151 段階3: **未送信の変更をどの鍵に置くか。**
 *
 * ⚠️ **鍵の分け方そのものが仕様**であり、間違えると
 * そのまま「利用者の変更が消える」不具合になる。だから
 * 保存処理（`stores/pending-write.ts`）から切り離して単体で検査する。
 *
 * （`@toeverything/infra` を import したファイルは検査が動かない。
 * `decide.ts` / `plan-meta-write.ts` / `merge-pending.ts` と同じ方針）
 *
 * 詳細は docs/discovery-stage3-comparison.md 7.5.8 / 7.5.9
 */

export const PENDING_PREFIX = 'discovery:pending:';

/**
 * ⚠️ **フィールドごとに別の鍵にする。**
 * 1つの鍵にまとめると、題とタグを続けて変えたときに
 * **後に書いたほうが勝ち、片方の変更が消える**（7.5.9）。
 * `AsyncMemento.set` は値をまるごと置き換えるだけでマージしない。
 *
 * ⚠️ **`userId` を含める。** 共用 PC で、別の利用者の未送信分を
 * 自分の名前で送ってしまわないため（スナップショットの鍵と同じ理由）。
 */
export function pendingKey(target: {
  workspaceId: string;
  userId: string;
  docId: string;
  field: string;
}): string {
  return `${PENDING_PREFIX}${target.workspaceId}:${target.userId}:${target.docId}:${target.field}`;
}

/**
 * その利用者・そのワークスペースの控えの鍵か。
 *
 * ⚠️ **同じキャッシュにはスナップショットなど別のものが同居している。**
 * 前方一致を緩めると、関係ない鍵を未送信分として送ろうとする。
 */
export function pendingScopePrefix(scope: {
  workspaceId: string;
  userId: string;
}): string {
  return `${PENDING_PREFIX}${scope.workspaceId}:${scope.userId}:`;
}

/** 一覧に含める鍵だけを選ぶ。 */
export function selectPendingKeys(
  keys: string[],
  scope: { workspaceId: string; userId: string }
): string[] {
  const prefix = pendingScopePrefix(scope);
  return keys.filter(k => k.startsWith(prefix));
}

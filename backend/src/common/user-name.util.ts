/**
 * 表示名の既定値を求める。
 *
 * ofuro-wiki のサインアップは名前を収集しないため name が空になりがちで、
 * データベースのメンバー列・コメント・メンバー一覧などで「名前が無い＝誰か
 * 分からない」状態になる。name 未設定時は email のローカル部（@ の前）を
 * 既定の表示名として使い、常に識別可能にする。
 */
export function deriveUserName(email: string, name?: string | null): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  const local = email.split('@')[0]?.trim();
  return local || email;
}

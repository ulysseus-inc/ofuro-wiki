/** 招待のページ（/invite/<UUID>）。招待メールの URL と同じ形 */
const INVITE_PATH = /^\/invite\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * #195: サインインのあとに戻る先が招待のページなら、その招待の ID。
 * サーバーは、本人宛てのメール招待なら新規登録を閉じていてもアカウントを作る
 * （docs/signin-registration.md 4.3）。例: '/invite/1111…' → '1111…'
 */
export function inviteIdFromRedirect(
  redirectUrl: string | null | undefined
): string | undefined {
  return redirectUrl?.match(INVITE_PATH)?.[1];
}

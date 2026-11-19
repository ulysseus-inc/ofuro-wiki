import { describe, expect, test } from 'vitest';

import { inviteIdFromRedirect } from '../invite-redirect';

/** #195: 招待のページから来たサインインは、招待の ID をサーバーへ一緒に送る */
describe('inviteIdFromRedirect', () => {
  const id = '11111111-1111-4111-8111-111111111111';

  test('/invite/<ID> から ID を取る', () => {
    expect(inviteIdFromRedirect(`/invite/${id}`)).toBe(id);
  });

  test.each([
    [null],
    [''],
    ['/workspace/abc/all'],
    [`/invite/${id}/extra`],
    ['/invite/not-a-uuid'],
    [`https://evil.example.com/invite/${id}`],
  ])('招待のページでなければ undefined: %s', redirect => {
    expect(inviteIdFromRedirect(redirect)).toBeUndefined();
  });
});

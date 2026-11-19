import { InviteOutcome } from '@ofuro/graphql';
import { describe, expect, test } from 'vitest';

import { inviteUrl, summarizeInvites } from '../invite-result';

/** #299: 招待の結果を、宛先ごとの outcome で数える（メールを送れたかでは数えない） */
describe('summarizeInvites', () => {
  test('追加・すでにメンバー・アカウントなし（メールを送れた／送れない）に分ける', () => {
    const summary = summarizeInvites([
      { email: 'a@x', outcome: InviteOutcome.Added, sentSuccess: false, inviteId: 'i' },
      { email: 'b@x', outcome: InviteOutcome.Added, sentSuccess: true, inviteId: 'i' },
      { email: 'c@x', outcome: InviteOutcome.AlreadyMember, sentSuccess: false, inviteId: 'i' },
      { email: 'd@x', outcome: InviteOutcome.Invited, sentSuccess: true, inviteId: 'inv-d' },
      { email: 'e@x', outcome: InviteOutcome.Invited, sentSuccess: false, inviteId: 'inv-e' },
    ]);

    expect(summary).toEqual({
      added: 2,
      alreadyMember: ['c@x'],
      invitedSent: [{ email: 'd@x', inviteId: 'inv-d' }],
      // M3: アカウントの無い人には、招待の URL を渡せるように ID も持つ
      invitedNotSent: [{ email: 'e@x', inviteId: 'inv-e' }],
    });
  });

  test('⚠️ メールを送れなくても、追加できた人は追加として数える', () => {
    const summary = summarizeInvites([
      { email: 'a@x', outcome: InviteOutcome.Added, sentSuccess: false, inviteId: 'i' },
    ]);

    expect(summary.added).toBe(1);
    expect(summary.invitedNotSent).toEqual([]);
  });

  test('アドレスの無い結果は、追加の人数にだけ数える', () => {
    const summary = summarizeInvites([
      { email: null, outcome: InviteOutcome.Added, sentSuccess: false, inviteId: 'i' },
      { email: null, outcome: InviteOutcome.Invited, sentSuccess: false, inviteId: 'i' },
    ]);

    expect(summary).toEqual({
      added: 1,
      alreadyMember: [],
      invitedSent: [],
      invitedNotSent: [],
    });
  });

  test('M3: 招待の URL は /invite/<招待の ID>', () => {
    expect(inviteUrl('https://wiki.example.com', 'inv-e')).toBe(
      'https://wiki.example.com/invite/inv-e'
    );
  });
});

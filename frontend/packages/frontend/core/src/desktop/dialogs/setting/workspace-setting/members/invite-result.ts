import { InviteOutcome } from '@ofuro/graphql';

/** inviteMembers の結果 1 件（通知に使うところだけ） */
interface InviteResult {
  email: string | null;
  outcome: InviteOutcome;
  sentSuccess: boolean;
  inviteId: string;
}

/** アカウントの無い人への招待。URL を本人に渡せる（docs/signin-registration.md 4.3） */
export interface PendingInvite {
  email: string;
  inviteId: string;
}

/** 招待の結果を、通知に出す単位にまとめたもの */
export interface InviteSummary {
  /** その場でメンバーにした人数 */
  added: number;
  /** もともとメンバーだったアドレス */
  alreadyMember: string[];
  /** アカウントが無く、招待メールを送れた人 */
  invitedSent: PendingInvite[];
  /** アカウントが無く、招待メールも送れなかった人（メンバーにできていない） */
  invitedNotSent: PendingInvite[];
}

/**
 * #299: 招待の結果を数える。
 * ⚠️ sentSuccess（メールを送れたか）で成否を数えない。メールの設定が無い環境では、
 * 追加できた人まで失敗と出ていた（docs/workspace-invitation.md 4.1）
 */
export function summarizeInvites(results: InviteResult[]): InviteSummary {
  const summary: InviteSummary = {
    added: 0,
    alreadyMember: [],
    invitedSent: [],
    invitedNotSent: [],
  };

  for (const r of results) {
    if (r.outcome === InviteOutcome.Added) {
      summary.added++;
      continue;
    }
    // #210: スキーマでは email は null を許す
    if (!r.email) {
      continue;
    }
    if (r.outcome === InviteOutcome.AlreadyMember) {
      summary.alreadyMember.push(r.email);
      continue;
    }
    if (r.sentSuccess) {
      summary.invitedSent.push({ email: r.email, inviteId: r.inviteId });
      continue;
    }
    summary.invitedNotSent.push({ email: r.email, inviteId: r.inviteId });
  }
  return summary;
}

/** 招待の URL。例: https://wiki.example.com/invite/<招待の ID>（招待メールと同じ形） */
export function inviteUrl(origin: string, inviteId: string): string {
  return `${origin}/invite/${inviteId}`;
}

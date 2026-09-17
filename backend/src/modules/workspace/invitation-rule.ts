/**
 * #148: **その招待を、その人が、いま受諾してよいか。**
 *
 * ⚠️ **判定はここ1か所に置く。** 呼び出し側に条件を書き足すと、
 * 招待の種別ごとの違い（下記）が実装のあちこちに散る。
 *
 * ## ⚠️ 招待は2種類ある
 *
 * | 種別 | `email` | 誰が使えるか |
 * |---|---|---|
 * | メール招待 | 宛先のアドレス | **その人だけ** |
 * | 招待リンク | `'__invite_link__'` | **リンクを持つ誰でも**（意図した仕様） |
 *
 * **「宛先を照合する」を一律に適用すると、招待リンクが壊れる。**
 *
 * 詳細は docs/workspace-invitation.md
 */

/** 招待リンクであることを表す歩哨値（実在しないメールアドレスの形） */
export const INVITE_LINK_EMAIL = '__invite_link__';

/** 新しく作るメール招待の有効期間。招待リンクの既定（1週間）と揃える */
export const EMAIL_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function judgeInvitation<T extends InvitationForJudge>(input: {
  invitation: T | null;
  /** 受諾しようとしている人 */
  user: { email: string | null };
  workspaceId: string;
  now: Date;
}): InvitationJudgement<T> {
  const { invitation, user, workspaceId, now } = input;

  if (!invitation || invitation.workspaceId !== workspaceId) {
    return { ok: false, reason: 'not-found' };
  }

  // ⚠️ **期限は両方の種別で見る。** 招待リンクは作成時に期限を入れているのに
  // 受諾側が見ておらず、**期限切れのリンクでも入れてしまっていた**（#148）
  if (invitation.expireTime !== null && invitation.expireTime <= now) {
    return { ok: false, reason: 'expired' };
  }

  if (invitation.email === INVITE_LINK_EMAIL) {
    // 招待リンク: 誰でも受諾できる（仕様）。⚠️ **使い切らない**（再利用可）
    return { ok: true, kind: 'link', consume: false, invitation };
  }

  // ⚠️ **照合できないものは拒否する。** いまこの経路で `null` は作られないが、
  // スキーマが許す以上、**「誰の招待か」を決められない**まま通してはいけない
  if (!invitation.email || !user.email) {
    return { ok: false, reason: 'not-addressed' };
  }

  // ⚠️ **大小を無視して比べる。** DB の列は Citext だが、ここはアプリ側の
  // 比較なので、揃えないと `A@b.com` と `a@b.com` が別物になる
  if (!sameEmail(invitation.email, user.email)) {
    return { ok: false, reason: 'not-addressed' };
  }

  // メール招待: 本人だけが、**一度だけ**使える
  return { ok: true, kind: 'email', consume: true, invitation };
}

/** ⚠️ 大小を無視して比べる。前後の空白も落とす */
export function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export interface InvitationForJudge {
  workspaceId: string;
  email: string | null;
  expireTime: Date | null;
}

export type InvitationJudgement<T = InvitationForJudge> =
  | {
      ok: true;
      kind: 'email' | 'link';
      /** 受諾したら無効化するか。⚠️ 招待リンクは残す（再利用が仕様） */
      consume: boolean;
      /**
       * 検証を通った招待そのもの。
       *
       * ⚠️ **これを返すことで、呼び出し側が `null` を気にせず使える。**
       * 呼び出し側で改めて `!invitation` を確かめると、判定が2か所に分かれる
       */
      invitation: T;
    }
  | { ok: false; reason: InvitationRejection };

/**
 * 受諾できない理由。
 *
 * ⚠️ **利用者への文面で区別しすぎないこと。** 「宛先が違う」と
 * 「そもそも無い」を細かく伝えると、**招待の存在を確かめる手段**になる。
 */
export type InvitationRejection = 'not-found' | 'expired' | 'not-addressed';

import {
  EMAIL_INVITE_TTL_MS,
  INVITE_LINK_EMAIL,
  judgeInvitation,
  sameEmail,
} from '../../../src/modules/workspace/invitation-rule';

/**
 * #148: **招待の受諾を、種別ごとに正しく検証する。**
 *
 * ⚠️ ここで守っているのは、**間違えると招待していない人が入れるか、
 * 逆に招待した人が入れなくなる**性質のもの。
 *
 * 以前は招待 ID だけで受諾でき、宛先も期限も見ていなかった。
 * **リンクを転送されれば誰でもワークスペースに入れた。**
 *
 * 詳細は docs/workspace-invitation.md
 */
describe('招待の受諾判定（#148）', () => {
  const WS = 'ws-1';
  const NOW = new Date('2026-09-05T00:00:00Z');

  const invite = (over: Record<string, unknown> = {}) => ({
    workspaceId: WS,
    email: 'invited@example.com',
    expireTime: null as Date | null,
    role: 'member',
    ...over,
  });

  const judge = (
    invitation: ReturnType<typeof invite> | null,
    email: string | null,
    workspaceId = WS,
  ) => judgeInvitation({ invitation, user: { email }, workspaceId, now: NOW });

  describe('メール招待', () => {
    test('宛先本人なら受諾できる', () => {
      const r = judge(invite(), 'invited@example.com');
      expect(r).toMatchObject({ ok: true, kind: 'email', consume: true });
    });

    /**
     * ⚠️ **これが #148 の本丸。**
     * 招待メールのリンクは転送できる。宛先を見ないと、
     * **招待していない人がワークスペースに入れる**。
     */
    test('⚠️ 別人は受諾できない（リンクを転送されても入れない）', () => {
      const r = judge(invite(), 'someone-else@example.com');
      expect(r).toEqual({ ok: false, reason: 'not-addressed' });
    });

    /**
     * ⚠️ **大小を無視して比べる。** DB は Citext だが、ここはアプリ側の
     * 比較なので揃えないと素通りする（本人が入れなくなる）。
     */
    test('⚠️ 大文字小文字が違っても本人とみなす', () => {
      expect(judge(invite(), 'INVITED@Example.COM').ok).toBe(true);
      expect(judge(invite({ email: 'Invited@Example.com' }), 'invited@example.com').ok).toBe(true);
    });

    test('前後の空白は無視する', () => {
      expect(judge(invite(), '  invited@example.com  ').ok).toBe(true);
    });

    /** ⚠️ **一度きり。** 残すと同じリンクで何度でも入れる */
    test('⚠️ 受諾したら使い切る', () => {
      const r = judge(invite(), 'invited@example.com');
      expect(r).toMatchObject({ ok: true, consume: true });
    });

    test('期限内なら受諾できる', () => {
      const r = judge(
        invite({ expireTime: new Date(NOW.getTime() + 1000) }),
        'invited@example.com',
      );
      expect(r.ok).toBe(true);
    });

    test('⚠️ 期限切れは受諾できない', () => {
      const r = judge(
        invite({ expireTime: new Date(NOW.getTime() - 1000) }),
        'invited@example.com',
      );
      expect(r).toEqual({ ok: false, reason: 'expired' });
    });

    /**
     * ⚠️ **期限なし（`null`）は通す。**
     * 期限切れ扱いにすると、**いま出ている招待を黙って無効化する**。
     * 宛先照合と一回性があれば、期限が無いこと自体は認可の穴ではない。
     */
    test('⚠️ 期限が無い古い招待は、通す（黙って無効化しない）', () => {
      const r = judge(invite({ expireTime: null }), 'invited@example.com');
      expect(r.ok).toBe(true);
    });
  });

  describe('招待リンク', () => {
    const link = (over: Record<string, unknown> = {}) =>
      invite({
        email: INVITE_LINK_EMAIL,
        expireTime: new Date(NOW.getTime() + 1000),
        ...over,
      });

    /**
     * ⚠️ **リンクは誰でも受諾できるのが仕様。**
     * ここに宛先照合を効かせると、招待リンク機能が丸ごと壊れる。
     */
    test('⚠️ 誰でも受諾できる（宛先を照合しない）', () => {
      const r = judge(link(), 'anyone@example.com');
      expect(r).toMatchObject({ ok: true, kind: 'link' });
    });

    /** ⚠️ **使い切らない。** 再利用できるのが仕様 */
    test('⚠️ 受諾しても使い切らない', () => {
      const r = judge(link(), 'anyone@example.com');
      expect(r).toMatchObject({ ok: true, consume: false });
    });

    /**
     * ⚠️ **ここが実害のあった穴。** 作成時に期限を入れているのに
     * 受諾側が見ておらず、**期限切れのリンクでも入れた**。
     */
    test('⚠️ 期限切れのリンクでは受諾できない', () => {
      const r = judge(
        link({ expireTime: new Date(NOW.getTime() - 1000) }),
        'anyone@example.com',
      );
      expect(r).toEqual({ ok: false, reason: 'expired' });
    });

    test('メールアドレスを持たない利用者でも受諾できる', () => {
      expect(judge(link(), null).ok).toBe(true);
    });
  });

  describe('⚠️ 分からないものは拒否する', () => {
    test('招待が無ければ拒否', () => {
      expect(judge(null, 'a@example.com')).toEqual({
        ok: false,
        reason: 'not-found',
      });
    });

    /** ⚠️ 別ワークスペースの招待 ID を持ち込ませない */
    test('⚠️ 別のワークスペースの招待は拒否', () => {
      const r = judge(invite({ workspaceId: 'ws-2' }), 'invited@example.com');
      expect(r).toEqual({ ok: false, reason: 'not-found' });
    });

    /**
     * ⚠️ いまこの経路で `null` は作られないが、スキーマは許す。
     * **照合できない以上「誰の招待か」を決められない**ので拒否する。
     */
    test('⚠️ 宛先が空の招待は拒否（照合できないため）', () => {
      expect(judge(invite({ email: null }), 'a@example.com')).toEqual({
        ok: false,
        reason: 'not-addressed',
      });
    });

    test('⚠️ 利用者にメールアドレスが無ければ、メール招待は拒否', () => {
      expect(judge(invite(), null)).toEqual({
        ok: false,
        reason: 'not-addressed',
      });
    });

    /** ⚠️ 期限は宛先より先に見る（期限切れを「宛先違い」と誤って伝えない） */
    test('期限切れかつ別人なら、期限切れとする', () => {
      const r = judge(
        invite({ expireTime: new Date(NOW.getTime() - 1000) }),
        'other@example.com',
      );
      expect(r).toEqual({ ok: false, reason: 'expired' });
    });
  });

  test('メール招待の有効期間は、招待リンクの既定（1週間）と揃える', () => {
    expect(EMAIL_INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  describe('メールアドレスの比較', () => {
    test('大小と前後の空白を無視する', () => {
      expect(sameEmail('A@b.com', ' a@B.com ')).toBe(true);
    });

    test('別のアドレスは一致しない', () => {
      expect(sameEmail('a@b.com', 'a@c.com')).toBe(false);
    });
  });
});

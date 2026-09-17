import { NotFoundException } from '@nestjs/common';
import { WorkspaceService } from '../../../src/modules/workspace/workspace.service';
import type { PrismaService } from '../../../src/prisma.service';

/**
 * #148: **招待の消費とメンバー追加を、原子的に行う。**
 *
 * ⚠️ ここで守っているのは、**壊れても成功に見える**性質のもの。
 *
 * 当初は「メンバーに追加してから招待を削除し、削除の失敗は握り潰す」形にしていた。
 * それだと削除に失敗しても受諾は成功し、**招待が残ったまま**になる。
 * 退出させたあとに同じリンクで戻れる——「一度だけ」という約束が
 * **障害時に静かに破れる**（Codex 指摘・2026-09-05）。
 *
 * 詳細は docs/workspace-invitation.md
 */
describe('招待の受諾（#148 消費の原子性）', () => {
  const WS = 'ws-1';
  const INVITE = 'inv-1';
  const USER = 'user-1';
  const EMAIL = 'invited@example.com';

  const make = (opts: {
    invitation?: Record<string, unknown> | null;
    /** 削除で消せた件数（0 = 他が先に使い切った / 消せなかった） */
    deleted?: number;
    /** 招待リンクの生存数 */
    alive?: number;
    userEmail?: string | null;
  }) => {
    const calls: string[] = [];

    const tx = {
      invitation: {
        deleteMany: jest.fn().mockImplementation(() => {
          calls.push('invitation.deleteMany');
          return Promise.resolve({ count: opts.deleted ?? 1 });
        }),
        count: jest.fn().mockImplementation(() => {
          calls.push('invitation.count');
          return Promise.resolve(opts.alive ?? 1);
        }),
      },
      workspaceMember: {
        upsert: jest.fn().mockImplementation(() => {
          calls.push('workspaceMember.upsert');
          return Promise.resolve({});
        }),
      },
    };

    const invitation =
      opts.invitation === undefined
        ? {
            id: INVITE,
            workspaceId: WS,
            email: EMAIL,
            expireTime: null,
            role: 'member',
          }
        : opts.invitation;

    const prisma: any = {
      invitation: { findUnique: jest.fn().mockResolvedValue(invitation) },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          email: opts.userEmail === undefined ? EMAIL : opts.userEmail,
        }),
      },
      $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
    };

    const discovery: any = { bump: jest.fn() };
    const service = new WorkspaceService(
      prisma as unknown as PrismaService,
      { isEnabled: () => false } as never,
      { record: jest.fn() } as never,
      discovery,
    );
    return { service, tx, calls, prisma, discovery };
  };

  test('宛先本人なら受諾でき、メンバーになる', async () => {
    const { service, tx } = make({});

    await expect(service.acceptInvite(WS, INVITE, USER)).resolves.toBe(true);

    expect(tx.workspaceMember.upsert).toHaveBeenCalledTimes(1);
  });

  /**
   * ⚠️ **消費を先に、同じトランザクションで。**
   * 順序が逆だと「入れたが招待は残った」が起こり得る。
   */
  describe('⚠️ 消費の原子性', () => {
    test('同じトランザクションで、消費 → 追加の順に行う', async () => {
      const { service, prisma, calls } = make({});

      await service.acceptInvite(WS, INVITE, USER);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(calls).toEqual([
        'invitation.deleteMany',
        'workspaceMember.upsert',
      ]);
    });

    /**
     * ⚠️ **これが Codex に指摘された穴そのもの。**
     * 消せなかったのに成功を返すと、招待が残ったまま受諾が通る。
     */
    test('⚠️ 招待を消せなければ、メンバーにもしない', async () => {
      const { service, tx } = make({ deleted: 0 });

      await expect(service.acceptInvite(WS, INVITE, USER)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(tx.workspaceMember.upsert).not.toHaveBeenCalled();
    });

    /**
     * ⚠️ **同時受諾は片方だけが通る。**
     * 削除そのものを検査に使っているため、先に消せた1件だけが成立する。
     */
    test('⚠️ 他が先に使い切っていれば受諾できない（別タブ・再送）', async () => {
      const { service, discovery } = make({ deleted: 0 });

      await expect(service.acceptInvite(WS, INVITE, USER)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      // 版数も上げないこと（何も変わっていない）
      expect(discovery.bump).not.toHaveBeenCalled();
    });

    /** ⚠️ id だけで消すと、別ワークスペースや期限切れを掴んだまま消す */
    test('⚠️ 削除の条件に id・ワークスペース・宛先・期限が入っている', async () => {
      const { service, tx } = make({});

      await service.acceptInvite(WS, INVITE, USER);

      const where = tx.invitation.deleteMany.mock.calls[0][0].where;
      expect(where.id).toBe(INVITE);
      expect(where.workspaceId).toBe(WS);
      expect(where.email).toBe(EMAIL);
      expect(where.OR).toEqual([
        { expireTime: null },
        { expireTime: { gt: expect.any(Date) } },
      ]);
    });
  });

  describe('招待リンク', () => {
    const link = (over: Record<string, unknown> = {}) => ({
      invitation: {
        id: INVITE,
        workspaceId: WS,
        email: '__invite_link__',
        expireTime: new Date(Date.now() + 60_000),
        role: 'member',
        ...over,
      },
    });

    /** ⚠️ リンクは**使い切らない**（再利用が仕様） */
    test('⚠️ 受諾しても招待を消さない', async () => {
      const { service, tx } = make(link());

      await expect(service.acceptInvite(WS, INVITE, USER)).resolves.toBe(true);

      expect(tx.invitation.deleteMany).not.toHaveBeenCalled();
      expect(tx.workspaceMember.upsert).toHaveBeenCalledTimes(1);
    });

    /**
     * ⚠️ 消さないからこそ、**その瞬間に有効か**を確かめる。
     * 判定してからここへ来るまでに、取り消し・失効が起こり得る。
     */
    test('⚠️ 途中で取り消されていたら受諾しない', async () => {
      const { service, tx } = make({ ...link(), alive: 0 });

      await expect(service.acceptInvite(WS, INVITE, USER)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(tx.workspaceMember.upsert).not.toHaveBeenCalled();
    });
  });

  describe('⚠️ 判定に落ちるもの', () => {
    test('⚠️ 別人は受諾できない（宛先を照合する）', async () => {
      const { service, prisma } = make({ userEmail: 'other@example.com' });

      await expect(service.acceptInvite(WS, INVITE, USER)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      // 判定で落ちるので、書き込みには進まない
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    test('招待が無ければ受諾できない', async () => {
      const { service, prisma } = make({ invitation: null });

      await expect(service.acceptInvite(WS, INVITE, USER)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    /**
     * ⚠️ **理由で応答を分けない。** 「宛先が違う」と「無い」を区別すると、
     * 招待の存在を確かめる手段になる。
     */
    test('⚠️ 理由が違っても、同じ応答を返す', async () => {
      const notAddressed = make({ userEmail: 'other@example.com' });
      const notFound = make({ invitation: null });

      const a = await notAddressed.service
        .acceptInvite(WS, INVITE, USER)
        .catch((e) => e.message);
      const b = await notFound.service
        .acceptInvite(WS, INVITE, USER)
        .catch((e) => e.message);

      expect(a).toBe(b);
    });
  });

  test('受諾したら、誰に何が見えるかの版数を上げる', async () => {
    const { service, discovery } = make({});

    await service.acceptInvite(WS, INVITE, USER);

    expect(discovery.bump).toHaveBeenCalledWith(WS, 'permission-workspace');
  });
});

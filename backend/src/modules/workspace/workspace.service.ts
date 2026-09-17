import { Injectable, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { DiscoveryRevisionService } from '../discovery/discovery-revision.service';
// #148: 招待の受諾は種別ごとに扱いが違う。判定は1か所に置く
import {
  EMAIL_INVITE_TTL_MS,
  INVITE_LINK_EMAIL,
  judgeInvitation,
} from './invitation-rule';

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
    private audit: AuditService,
    // #151: メンバーの増減・ロール変更で「誰に何が見えるか」が変わる
    private discovery: DiscoveryRevisionService,
  ) {}

  async createWorkspace(userId: string, name?: string) {
    return this.prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          name: name || 'ofuro-wiki',
          ownerId: userId,
        },
      });
      await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId,
          role: 'owner',
          status: 'accepted',
        },
      });
      return workspace;
    });
  }

  async deleteWorkspace(workspaceId: string, userId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    // #90: 画面・CSV・絞り込みはすべて actorEmail を見る。
    // id だけ渡すと actorEmail が 'anonymous' になり、実行者を追えない
    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });
    if (workspace.ownerId !== userId) {
      throw new ForbiddenException('Only the owner can delete a workspace');
    }
    await this.prisma.workspace.delete({ where: { id: workspaceId } });

    // #90: 名前は**消す前にしか取れない**。UUID だけ残しても、
    // 参照先が消えているため後から何を消したのか分からない。
    await this.audit.record({
      action: 'workspace.delete',
      actor: { id: userId, email: actor?.email, name: actor?.name },
      targetType: 'workspace',
      targetId: workspaceId,
      targetName: workspace.name ?? undefined,
      workspaceId,
    });
    return true;
  }

  async getWorkspace(workspaceId: string) {
    return this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { members: { include: { user: true } } },
    });
  }

  async getUserWorkspaces(userId: string) {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId, status: 'accepted' },
      include: {
        workspace: {
          include: { members: { include: { user: true } } },
        },
      },
    });
    return memberships.map((m) => ({
      workspace: m.workspace,
      role: m.role,
    }));
  }

  async getMemberRole(workspaceId: string, userId: string) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId, userId },
      },
    });
    return member?.role ?? null;
  }

  async inviteByEmail(
    workspaceId: string,
    inviterId: string,
    email: string,
    role = 'member',
  ) {
    const user = await this.prisma.user.findUnique({ where: { email } });

    const invitation = await this.prisma.invitation.create({
      data: {
        workspaceId,
        inviterId,
        email,
        role,
        // #148: 期限を入れる（招待リンクの既定と揃えて7日）。
        // ⚠️ 既存の行は `null` のまま＝期限なしとして通す。
        // 期限切れ扱いにすると、**いま出ている招待を黙って無効化する**
        expireTime: new Date(Date.now() + EMAIL_INVITE_TTL_MS),
      },
    });

    // If user exists, auto-add as member
    if (user) {
      await this.prisma.workspaceMember.upsert({
        where: {
          workspaceId_userId: { workspaceId, userId: user.id },
        },
        create: {
          workspaceId,
          userId: user.id,
          role,
          status: 'accepted',
        },
        update: {},
      });
    }

    // Send invitation email (non-blocking, failures don't affect invitation)
    let sentSuccess = false;
    if (this.mailService.isEnabled()) {
      try {
        const inviter = await this.prisma.user.findUnique({
          where: { id: inviterId },
        });
        const workspace = await this.prisma.workspace.findUnique({
          where: { id: workspaceId },
        });
        await this.mailService.sendInvitationEmail(
          inviter?.name || inviter?.email || 'Unknown',
          email,
          workspace?.name || 'Workspace',
          invitation.id,
        );
        sentSuccess = true;
      } catch (err) {
        this.logger.warn(`Failed to send invitation email to ${email}: ${err}`);
      }
    }

    return { ...invitation, sentSuccess };
  }

  async removeMember(workspaceId: string, userId: string) {
    await this.prisma.workspaceMember.delete({
      where: {
        workspaceId_userId: { workspaceId, userId },
      },
    });
    // ⚠️ #151: 誰に何が見えるかが変わる。**書き込んだあと**に上げる
    await this.discovery.bump(workspaceId, 'permission-workspace');
    return true;
  }

  async getMembers(
    workspaceId: string,
    skip = 0,
    take = 20,
    query?: string,
  ) {
    const where: any = { workspaceId };
    if (query) {
      where.user = {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
        ],
      };
    }
    return this.prisma.workspaceMember.findMany({
      where,
      include: { user: true },
      skip,
      take,
      orderBy: { createdAt: 'asc' },
    });
  }

  async getMemberCount(workspaceId: string) {
    return this.prisma.workspaceMember.count({ where: { workspaceId } });
  }

  /**
   * 招待を受諾する。
   *
   * ⚠️ **招待は2種類あり、扱いが違う**（docs/workspace-invitation.md）。
   * 判定は `judgeInvitation` に委ねること。ここに条件を書き足さない。
   *
   * ⚠️ 以前は**招待 ID だけ**で受諾でき、宛先も期限も見ていなかった。
   * リンクを転送されれば**招待していない人がワークスペースに入れた**（#148）。
   */
  async acceptInvite(workspaceId: string, inviteId: string, userId: string) {
    const [invitation, user] = await Promise.all([
      this.prisma.invitation.findUnique({ where: { id: inviteId } }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      }),
    ]);

    // ⚠️ 判定と消費で**同じ時刻**を使う。別々に取ると、境目で
    // 「判定は通ったのに消費で期限切れ」という説明できない失敗が出る
    const now = new Date();
    const judgement = judgeInvitation({
      invitation,
      user: { email: user?.email ?? null },
      workspaceId,
      now,
    });

    if (!judgement.ok) {
      // ⚠️ **理由で応答を分けない。** 「宛先が違う」と「無い」を区別すると、
      // 招待の**存在を確かめる手段**になる。記録には理由を残す
      this.logger.warn(
        `Invitation rejected: ${judgement.reason} (invite=${inviteId} user=${userId})`,
      );
      throw new NotFoundException('Invitation not found');
    }

    // ⚠️ **消費とメンバー追加は同じトランザクションで、消費を先に行う。**
    //
    // 分けると、削除に失敗しても受諾が成功する。招待は残ったままなので
    // **退出させたあとに同じリンクで戻れる**——「一度だけ」という
    // 認可上の約束が、障害時に静かに破れる（Codex 指摘・2026-09-05）。
    //
    // ⚠️ **削除そのものを検査に使う**（読んでから消すのではなく）。
    // 削除できた1件だけが受諾できるので、**同時受諾も片方だけが通る**。
    const consumed = await this.prisma.$transaction(async (tx) => {
      if (judgement.consume) {
        // ⚠️ 条件を全部入れること。id だけで消すと、別ワークスペースの
        // 招待や期限切れを掴んだまま消してしまう
        const result = await tx.invitation.deleteMany({
          where: {
            id: inviteId,
            workspaceId,
            email: judgement.invitation.email,
            OR: [{ expireTime: null }, { expireTime: { gt: now } }],
          },
        });
        // 消せなかった＝他の誰か（別タブ・再送）が先に使い切った
        if (result.count !== 1) return false;
      } else {
        // 招待リンクは消さない（再利用が仕様）。
        // ⚠️ それでも**この瞬間に有効か**は確かめる。判定してから
        // ここへ来るまでに失効・取り消しが起こり得る
        const alive = await tx.invitation.count({
          where: {
            id: inviteId,
            workspaceId,
            OR: [{ expireTime: null }, { expireTime: { gt: now } }],
          },
        });
        if (alive !== 1) return false;
      }

      await tx.workspaceMember.upsert({
        where: {
          workspaceId_userId: { workspaceId, userId },
        },
        create: {
          workspaceId,
          userId,
          role: judgement.invitation.role,
          status: 'accepted',
        },
        update: { status: 'accepted' },
      });
      return true;
    });

    if (!consumed) {
      this.logger.warn(
        `Invitation already consumed or revoked (invite=${inviteId} user=${userId})`,
      );
      throw new NotFoundException('Invitation not found');
    }

    // ⚠️ #151: 誰に何が見えるかが変わる。**書き込んだあと**に上げる
    await this.discovery.bump(workspaceId, 'permission-workspace');
    return true;
  }

  async leaveWorkspace(workspaceId: string, userId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    if (workspace.ownerId === userId) {
      throw new ForbiddenException('Owner cannot leave workspace');
    }
    await this.prisma.workspaceMember.delete({
      where: {
        workspaceId_userId: { workspaceId, userId },
      },
    });
    // ⚠️ #151: 誰に何が見えるかが変わる。**書き込んだあと**に上げる
    await this.discovery.bump(workspaceId, 'permission-workspace');
    return true;
  }

  async grantMember(
    workspaceId: string,
    userId: string,
    permission: string,
    currentUserId: string,
  ) {
    const currentRole = await this.getMemberRole(workspaceId, currentUserId);
    if (currentRole !== 'owner' && currentRole !== 'admin') {
      throw new ForbiddenException('Only owner or admin can change roles');
    }

    const roleMap: Record<string, string> = {
      Owner: 'owner',
      Admin: 'admin',
      Write: 'member',
      Read: 'reader',
    };
    const newRole = roleMap[permission] ?? 'member';

    if (newRole === 'owner') {
      // Transfer ownership
      if (currentRole !== 'owner') {
        throw new ForbiddenException('Only owner can transfer ownership');
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.workspace.update({
          where: { id: workspaceId },
          data: { ownerId: userId },
        });
        await tx.workspaceMember.update({
          where: { workspaceId_userId: { workspaceId, userId } },
          data: { role: 'owner' },
        });
        await tx.workspaceMember.update({
          where: {
            workspaceId_userId: { workspaceId, userId: currentUserId },
          },
          data: { role: 'admin' },
        });
      });
    } else {
      await this.prisma.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId, userId } },
        data: { role: newRole },
      });
    }
    // ⚠️ #151: 誰に何が見えるかが変わる。**書き込んだあと**に上げる
    await this.discovery.bump(workspaceId, 'permission-workspace');
    return true;
  }

  async getInviteInfo(inviteId: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: inviteId },
      include: {
        workspace: true,
        inviter: true,
      },
    });
    if (!invitation) throw new NotFoundException('Invitation not found');

    const invitee = invitation.email
      ? await this.prisma.user.findUnique({
          where: { email: invitation.email },
        })
      : null;

    const member = invitee
      ? await this.prisma.workspaceMember.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId: invitation.workspaceId,
              userId: invitee.id,
            },
          },
        })
      : null;

    return {
      workspace: {
        id: invitation.workspace.id,
        name: invitation.workspace.name || 'Workspace',
        avatar: invitation.workspace.avatarKey ?? '',
      },
      user: {
        id: invitation.inviter.id,
        name: invitation.inviter.name,
        avatarUrl: invitation.inviter.avatarUrl,
      },
      invitee: invitee
        ? {
            id: invitee.id,
            name: invitee.name,
            email: invitee.email,
            avatarUrl: invitee.avatarUrl,
          }
        : { id: '', name: '', email: invitation.email, avatarUrl: null },
      status: member?.status === 'accepted' ? 'Accepted' : 'Pending',
    };
  }

  async createInviteLink(
    workspaceId: string,
    expireTime: string,
    inviterId: string,
  ) {
    const expireMs: Record<string, number> = {
      OneDay: 24 * 60 * 60 * 1000,
      ThreeDays: 3 * 24 * 60 * 60 * 1000,
      OneWeek: 7 * 24 * 60 * 60 * 1000,
      OneMonth: 30 * 24 * 60 * 60 * 1000,
    };
    const ms = expireMs[expireTime] ?? expireMs.OneWeek;
    const expireAt = new Date(Date.now() + ms);

    // ワークスペースごとに招待リンクは1つだけ保持する（既存リンクは作り直す）
    await this.prisma.invitation.deleteMany({
      where: { workspaceId, email: INVITE_LINK_EMAIL },
    });

    // Store as a special invitation with email='__invite_link__'
    const invitation = await this.prisma.invitation.create({
      data: {
        workspaceId,
        inviterId, // 招待リンクを生成したユーザー（外部キー制約のため実在ユーザーが必要）
        email: INVITE_LINK_EMAIL,
        role: 'member',
        expireTime: expireAt,
      },
    });

    return {
      link: this.buildInviteLinkUrl(invitation.id),
      expireTime: expireAt,
    };
  }

  async revokeInviteLink(workspaceId: string) {
    await this.prisma.invitation.deleteMany({
      where: { workspaceId, email: INVITE_LINK_EMAIL },
    });
    return true;
  }

  // 現在有効な招待リンクを返す（表示用）。無ければ null。
  async getActiveInviteLink(workspaceId: string) {
    const invitation = await this.prisma.invitation.findFirst({
      where: {
        workspaceId,
        email: INVITE_LINK_EMAIL,
        OR: [{ expireTime: null }, { expireTime: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!invitation) {
      return null;
    }
    return {
      link: this.buildInviteLinkUrl(invitation.id),
      expireTime: invitation.expireTime,
    };
  }

  private buildInviteLinkUrl(inviteId: string) {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3010';
    return `${baseUrl}/invite/${inviteId}`;
  }
}

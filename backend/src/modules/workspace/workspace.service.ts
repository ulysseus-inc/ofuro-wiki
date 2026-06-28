import { Injectable, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
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
    if (workspace.ownerId !== userId) {
      throw new ForbiddenException('Only the owner can delete a workspace');
    }
    await this.prisma.workspace.delete({ where: { id: workspaceId } });
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

  async acceptInvite(workspaceId: string, inviteId: string, userId: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: inviteId },
    });
    if (!invitation || invitation.workspaceId !== workspaceId) {
      throw new NotFoundException('Invitation not found');
    }

    await this.prisma.workspaceMember.upsert({
      where: {
        workspaceId_userId: { workspaceId, userId },
      },
      create: {
        workspaceId,
        userId,
        role: invitation.role,
        status: 'accepted',
      },
      update: { status: 'accepted' },
    });
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
      where: { workspaceId, email: '__invite_link__' },
    });

    // Store as a special invitation with email='__invite_link__'
    const invitation = await this.prisma.invitation.create({
      data: {
        workspaceId,
        inviterId, // 招待リンクを生成したユーザー（外部キー制約のため実在ユーザーが必要）
        email: '__invite_link__',
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
      where: { workspaceId, email: '__invite_link__' },
    });
    return true;
  }

  // 現在有効な招待リンクを返す（表示用）。無ければ null。
  async getActiveInviteLink(workspaceId: string) {
    const invitation = await this.prisma.invitation.findFirst({
      where: {
        workspaceId,
        email: '__invite_link__',
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

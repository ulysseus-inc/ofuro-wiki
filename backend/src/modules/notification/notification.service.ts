import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MailService } from '../mail/mail.service';
import { PaginationInput, PaginatedNotificationType } from '../user/user.model';

interface DocInfo {
  id: string;
  title: string;
  mode: string;
  blockId?: string;
  elementId?: string;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
  ) {}

  async listNotifications(
    userId: string,
    pagination?: PaginationInput,
  ): Promise<PaginatedNotificationType> {
    const first = pagination?.first ?? 50;
    const after = pagination?.after;

    const where = { userId };

    const totalCount = await this.prisma.notification.count({ where });

    const notifications = await this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: first + 1,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    });

    const hasNextPage = notifications.length > first;
    if (hasNextPage) notifications.pop();

    const edges = notifications.map((n) => ({
      cursor: n.id,
      node: {
        id: n.id,
        type: n.type,
        level: n.level,
        read: n.read,
        body: n.body as any,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      },
    }));

    return {
      totalCount,
      edges,
      pageInfo: {
        startCursor: edges[0]?.cursor,
        endCursor: edges[edges.length - 1]?.cursor,
        hasNextPage,
        hasPreviousPage: !!after,
      },
    };
  }

  async getNotificationCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, read: false },
    });
  }

  async readNotification(userId: string, id: string): Promise<boolean> {
    await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    });
    return true;
  }

  async readAllNotifications(userId: string): Promise<boolean> {
    await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    return true;
  }

  private async getActorInfo(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, avatarUrl: true },
    });
    return user
      ? { id: user.id, name: user.name, avatarUrl: user.avatarUrl }
      : null;
  }

  private async getWorkspaceInfo(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true, avatarKey: true },
    });
    return ws
      ? { id: ws.id, name: ws.name ?? 'Workspace', avatarUrl: ws.avatarKey }
      : null;
  }

  private async getDocContentPreview(
    workspaceId: string,
    docId: string,
    maxLength = 200,
  ): Promise<string> {
    const index = await this.prisma.searchIndex.findFirst({
      where: { workspaceId, docId },
      select: { content: true },
      orderBy: { id: 'asc' },
    });
    if (!index?.content) return '';
    return index.content.length > maxLength
      ? index.content.slice(0, maxLength) + '...'
      : index.content;
  }

  private buildDocUrl(workspaceId: string, docId: string): string {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3010';
    return `${baseUrl}/workspace/${workspaceId}/${docId}`;
  }

  private async sendNotificationEmail(
    type: 'Comment' | 'Mention' | 'CommentMention',
    targetUserId: string,
    actorName: string,
    workspaceName: string,
    workspaceId: string,
    doc: DocInfo,
  ): Promise<void> {
    try {
      if (!this.mailService.isEnabled()) return;

      const targetUser = await this.prisma.user.findUnique({
        where: { id: targetUserId },
        select: {
          email: true,
          receiveCommentEmail: true,
          receiveMentionEmail: true,
        },
      });
      if (!targetUser) return;

      // Check user preferences
      const isCommentType = type === 'Comment' || type === 'CommentMention';
      const isMentionType = type === 'Mention' || type === 'CommentMention';

      if (isCommentType && !targetUser.receiveCommentEmail) return;
      if (type === 'Mention' && !targetUser.receiveMentionEmail) return;

      const contentPreview = await this.getDocContentPreview(workspaceId, doc.id);
      const docUrl = this.buildDocUrl(workspaceId, doc.id);

      const emailParams = {
        recipientEmail: targetUser.email,
        actorName,
        workspaceName,
        docTitle: doc.title || '無題',
        contentPreview,
        docUrl,
      };

      if (isMentionType) {
        await this.mailService.sendMentionNotificationEmail(emailParams);
      } else {
        await this.mailService.sendCommentNotificationEmail(emailParams);
      }
    } catch (error) {
      this.logger.error(`Failed to send ${type} notification email`, error);
    }
  }

  async createMentionNotification(
    actorUserId: string,
    targetUserId: string,
    workspaceId: string,
    doc: DocInfo,
  ) {
    const [createdByUser, workspace] = await Promise.all([
      this.getActorInfo(actorUserId),
      this.getWorkspaceInfo(workspaceId),
    ]);

    await this.prisma.notification.create({
      data: {
        userId: targetUserId,
        type: 'Mention',
        level: 'Default',
        body: {
          type: 'Mention',
          createdByUser,
          workspace,
          doc: {
            id: doc.id,
            title: doc.title,
            mode: doc.mode,
            blockId: doc.blockId ?? null,
            elementId: doc.elementId ?? null,
          },
        },
      },
    });

    // Send email notification (non-blocking)
    this.sendNotificationEmail(
      'Mention',
      targetUserId,
      createdByUser?.name || '不明なユーザー',
      workspace?.name || 'Workspace',
      workspaceId,
      doc,
    );
  }

  async createCommentNotification(
    actorUserId: string,
    targetUserId: string,
    workspaceId: string,
    doc: DocInfo,
  ) {
    const [createdByUser, workspace] = await Promise.all([
      this.getActorInfo(actorUserId),
      this.getWorkspaceInfo(workspaceId),
    ]);

    await this.prisma.notification.create({
      data: {
        userId: targetUserId,
        type: 'Comment',
        level: 'Default',
        body: {
          type: 'Comment',
          createdByUser,
          workspace,
          doc: {
            id: doc.id,
            title: doc.title,
            mode: doc.mode,
            blockId: doc.blockId ?? null,
            elementId: doc.elementId ?? null,
          },
        },
      },
    });

    // Send email notification (non-blocking)
    this.sendNotificationEmail(
      'Comment',
      targetUserId,
      createdByUser?.name || '不明なユーザー',
      workspace?.name || 'Workspace',
      workspaceId,
      doc,
    );
  }

  async createCommentMentionNotification(
    actorUserId: string,
    targetUserId: string,
    workspaceId: string,
    doc: DocInfo,
  ) {
    const [createdByUser, workspace] = await Promise.all([
      this.getActorInfo(actorUserId),
      this.getWorkspaceInfo(workspaceId),
    ]);

    await this.prisma.notification.create({
      data: {
        userId: targetUserId,
        type: 'CommentMention',
        level: 'Default',
        body: {
          type: 'CommentMention',
          createdByUser,
          workspace,
          doc: {
            id: doc.id,
            title: doc.title,
            mode: doc.mode,
            blockId: doc.blockId ?? null,
            elementId: doc.elementId ?? null,
          },
        },
      },
    });

    // Send email notification (non-blocking)
    this.sendNotificationEmail(
      'CommentMention',
      targetUserId,
      createdByUser?.name || '不明なユーザー',
      workspace?.name || 'Workspace',
      workspaceId,
      doc,
    );
  }
}

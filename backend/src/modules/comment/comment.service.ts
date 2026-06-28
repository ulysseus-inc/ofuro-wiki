import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { PermissionService } from '../permission/permission.service';
import {
  CommentCreateInput,
  CommentUpdateInput,
  CommentResolveInput,
  ReplyCreateInput,
  ReplyUpdateInput,
  CommentObjectType,
  ReplyObjectType,
  PaginatedCommentObjectType,
  PaginatedCommentChangeObjectType,
  CommentChangeAction,
} from './comment.model';
import { PaginationInput } from '../user/user.model';

function mapUser(user: { id: string; name: string | null; avatarUrl: string | null }) {
  return { id: user.id, name: user.name ?? '', avatarUrl: user.avatarUrl ?? undefined };
}

function mapReply(reply: any): ReplyObjectType {
  return {
    id: reply.id,
    commentId: reply.commentId,
    content: reply.content,
    createdAt: reply.createdAt,
    updatedAt: reply.updatedAt,
    user: mapUser(reply.user),
  };
}

function mapComment(comment: any): CommentObjectType {
  return {
    id: comment.id,
    content: comment.content,
    resolved: comment.resolved,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    user: mapUser(comment.user),
    replies: (comment.replies ?? []).map(mapReply),
  };
}

const COMMENT_INCLUDE = {
  user: { select: { id: true, name: true, avatarUrl: true } },
  replies: {
    include: {
      user: { select: { id: true, name: true, avatarUrl: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
};

@Injectable()
export class CommentService {
  constructor(
    private prisma: PrismaService,
    private permissionService: PermissionService,
  ) {}

  async listComments(
    workspaceId: string,
    docId: string,
    pagination?: PaginationInput,
  ): Promise<PaginatedCommentObjectType> {
    const first = pagination?.first ?? 50;
    const after = pagination?.after;

    const where = { workspaceId, docId };

    const totalCount = await this.prisma.comment.count({ where });

    const comments = await this.prisma.comment.findMany({
      where,
      include: COMMENT_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: first + 1,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    });

    const hasNextPage = comments.length > first;
    if (hasNextPage) comments.pop();

    const edges = comments.map((c) => ({
      cursor: c.id,
      node: mapComment(c),
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

  async listCommentChanges(
    workspaceId: string,
    docId: string,
    pagination?: PaginationInput,
  ): Promise<PaginatedCommentChangeObjectType> {
    const first = pagination?.first ?? 50;
    const after = pagination?.after;

    const where: any = { workspaceId, docId };

    // Use after cursor as a timestamp filter: return comments updated after that point
    if (after) {
      const cursorComment = await this.prisma.comment.findUnique({
        where: { id: after },
        select: { updatedAt: true },
      });
      if (cursorComment) {
        where.updatedAt = { gt: cursorComment.updatedAt };
      }
    }

    const totalCount = await this.prisma.comment.count({ where });

    const comments = await this.prisma.comment.findMany({
      where,
      include: COMMENT_INCLUDE,
      orderBy: { updatedAt: 'asc' },
      take: first + 1,
    });

    const hasNextPage = comments.length > first;
    if (hasNextPage) comments.pop();

    const edges = comments.map((c) => ({
      cursor: c.id,
      node: {
        id: c.id,
        commentId: undefined,
        action: CommentChangeAction.update,
        item: mapComment(c) as any,
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

  async createComment(
    userId: string,
    input: CommentCreateInput,
  ): Promise<CommentObjectType> {
    // Permission check: must be writer (member+)
    const role = await this.permissionService.getWorkspaceRole(input.workspaceId, userId);
    if (!role || role === 'reader') {
      throw new ForbiddenException('No permission to create comments');
    }

    const comment = await this.prisma.comment.create({
      data: {
        workspaceId: input.workspaceId,
        docId: input.docId,
        userId,
        content: input.content,
      },
      include: COMMENT_INCLUDE,
    });

    return mapComment(comment);
  }

  async updateComment(userId: string, input: CommentUpdateInput): Promise<boolean> {
    const comment = await this.prisma.comment.findUnique({
      where: { id: input.id },
      select: { userId: true },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.userId !== userId) {
      throw new ForbiddenException('Only the author can update this comment');
    }

    await this.prisma.comment.update({
      where: { id: input.id },
      data: { content: input.content },
    });
    return true;
  }

  async deleteComment(userId: string, id: string): Promise<boolean> {
    const comment = await this.prisma.comment.findUnique({
      where: { id },
      select: { userId: true, workspaceId: true },
    });
    if (!comment) throw new NotFoundException('Comment not found');

    // Owner can delete own comment; admin/owner can delete any
    if (comment.userId !== userId) {
      const role = await this.permissionService.getWorkspaceRole(comment.workspaceId, userId);
      if (!role || (role !== 'owner' && role !== 'admin')) {
        throw new ForbiddenException('No permission to delete this comment');
      }
    }

    await this.prisma.comment.delete({ where: { id } });
    return true;
  }

  async resolveComment(userId: string, input: CommentResolveInput): Promise<boolean> {
    const comment = await this.prisma.comment.findUnique({
      where: { id: input.id },
      select: { workspaceId: true },
    });
    if (!comment) throw new NotFoundException('Comment not found');

    // Writer permission needed
    const role = await this.permissionService.getWorkspaceRole(comment.workspaceId, userId);
    if (!role || role === 'reader') {
      throw new ForbiddenException('No permission to resolve comments');
    }

    await this.prisma.comment.update({
      where: { id: input.id },
      data: { resolved: input.resolved },
    });
    return true;
  }

  async createReply(
    userId: string,
    input: ReplyCreateInput,
  ): Promise<ReplyObjectType> {
    const comment = await this.prisma.comment.findUnique({
      where: { id: input.commentId },
      select: { workspaceId: true, userId: true },
    });
    if (!comment) throw new NotFoundException('Comment not found');

    // Writer permission needed
    const role = await this.permissionService.getWorkspaceRole(comment.workspaceId, userId);
    if (!role || role === 'reader') {
      throw new ForbiddenException('No permission to reply to comments');
    }

    const reply = await this.prisma.reply.create({
      data: {
        commentId: input.commentId,
        userId,
        content: input.content,
      },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    return mapReply(reply);
  }

  async updateReply(userId: string, input: ReplyUpdateInput): Promise<boolean> {
    const reply = await this.prisma.reply.findUnique({
      where: { id: input.id },
      select: { userId: true },
    });
    if (!reply) throw new NotFoundException('Reply not found');
    if (reply.userId !== userId) {
      throw new ForbiddenException('Only the author can update this reply');
    }

    await this.prisma.reply.update({
      where: { id: input.id },
      data: { content: input.content },
    });
    return true;
  }

  async deleteReply(userId: string, id: string): Promise<boolean> {
    const reply = await this.prisma.reply.findUnique({
      where: { id },
      select: { userId: true, comment: { select: { workspaceId: true } } },
    });
    if (!reply) throw new NotFoundException('Reply not found');

    if (reply.userId !== userId) {
      const role = await this.permissionService.getWorkspaceRole(
        reply.comment.workspaceId,
        userId,
      );
      if (!role || (role !== 'owner' && role !== 'admin')) {
        throw new ForbiddenException('No permission to delete this reply');
      }
    }

    await this.prisma.reply.delete({ where: { id } });
    return true;
  }

  /** Get the parent comment's info (for notification generation) */
  async getCommentInfo(commentId: string) {
    return this.prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true, userId: true, workspaceId: true, docId: true },
    });
  }
}

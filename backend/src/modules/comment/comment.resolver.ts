import {
  Resolver,
  Mutation,
  Args,
  ResolveField,
  Parent,
} from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import GraphQLUpload from 'graphql-upload/GraphQLUpload.mjs';
import type { FileUpload } from 'graphql-upload/processRequest.mjs';
import { WorkspaceType } from '../workspace/workspace.model';
import {
  CommentObjectType,
  ReplyObjectType,
  PaginatedCommentObjectType,
  PaginatedCommentChangeObjectType,
  CommentCreateInput,
  CommentUpdateInput,
  CommentResolveInput,
  ReplyCreateInput,
  ReplyUpdateInput,
  MentionInput,
} from './comment.model';
import { PaginationInput } from '../user/user.model';
import { CommentService } from './comment.service';
import { NotificationService } from '../notification/notification.service';
import { BlobService } from '../blob/blob.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Resolver(() => WorkspaceType)
@UseGuards(JwtAuthGuard)
export class CommentResolver {
  constructor(
    private commentService: CommentService,
    private notificationService: NotificationService,
    private blobService: BlobService,
  ) {}

  @ResolveField(() => PaginatedCommentObjectType)
  async comments(
    @Parent() workspace: WorkspaceType,
    @Args('docId', { type: () => String }) docId: string,
    @Args('pagination', { type: () => PaginationInput, nullable: true })
    pagination?: PaginationInput,
  ) {
    return this.commentService.listComments(workspace.id, docId, pagination);
  }

  @ResolveField(() => PaginatedCommentChangeObjectType)
  async commentChanges(
    @Parent() workspace: WorkspaceType,
    @Args('docId', { type: () => String }) docId: string,
    @Args('pagination', { type: () => PaginationInput }) pagination: PaginationInput,
  ) {
    return this.commentService.listCommentChanges(workspace.id, docId, pagination);
  }
}

@Resolver()
@UseGuards(JwtAuthGuard)
export class CommentMutationResolver {
  constructor(
    private commentService: CommentService,
    private notificationService: NotificationService,
    private blobService: BlobService,
  ) {}

  @Mutation(() => CommentObjectType)
  async createComment(
    @CurrentUser() user: { id: string },
    @Args('input', { type: () => CommentCreateInput }) input: CommentCreateInput,
  ) {
    const comment = await this.commentService.createComment(user.id, input);

    // Send mention notifications
    if (input.mentions?.length) {
      for (const targetUserId of input.mentions) {
        if (targetUserId !== user.id) {
          await this.notificationService.createCommentMentionNotification(
            user.id,
            targetUserId,
            input.workspaceId,
            { id: input.docId, title: input.docTitle, mode: input.docMode },
          );
        }
      }
    }

    return comment;
  }

  @Mutation(() => Boolean)
  async updateComment(
    @CurrentUser() user: { id: string },
    @Args('input', { type: () => CommentUpdateInput }) input: CommentUpdateInput,
  ) {
    return this.commentService.updateComment(user.id, input);
  }

  @Mutation(() => Boolean)
  async deleteComment(
    @CurrentUser() user: { id: string },
    @Args('id', { type: () => String }) id: string,
  ) {
    return this.commentService.deleteComment(user.id, id);
  }

  @Mutation(() => Boolean)
  async resolveComment(
    @CurrentUser() user: { id: string },
    @Args('input', { type: () => CommentResolveInput }) input: CommentResolveInput,
  ) {
    return this.commentService.resolveComment(user.id, input);
  }

  @Mutation(() => ReplyObjectType)
  async createReply(
    @CurrentUser() user: { id: string },
    @Args('input', { type: () => ReplyCreateInput }) input: ReplyCreateInput,
  ) {
    const reply = await this.commentService.createReply(user.id, input);

    // Notify the parent comment author
    const commentInfo = await this.commentService.getCommentInfo(input.commentId);
    if (commentInfo && commentInfo.userId !== user.id) {
      await this.notificationService.createCommentNotification(
        user.id,
        commentInfo.userId,
        commentInfo.workspaceId,
        { id: commentInfo.docId, title: input.docTitle, mode: input.docMode },
      );
    }

    // Send mention notifications
    if (input.mentions?.length) {
      for (const targetUserId of input.mentions) {
        if (targetUserId !== user.id) {
          await this.notificationService.createCommentMentionNotification(
            user.id,
            targetUserId,
            commentInfo?.workspaceId ?? '',
            { id: commentInfo?.docId ?? '', title: input.docTitle, mode: input.docMode },
          );
        }
      }
    }

    return reply;
  }

  @Mutation(() => Boolean)
  async updateReply(
    @CurrentUser() user: { id: string },
    @Args('input', { type: () => ReplyUpdateInput }) input: ReplyUpdateInput,
  ) {
    return this.commentService.updateReply(user.id, input);
  }

  @Mutation(() => Boolean)
  async deleteReply(
    @CurrentUser() user: { id: string },
    @Args('id', { type: () => String }) id: string,
  ) {
    return this.commentService.deleteReply(user.id, id);
  }

  @Mutation(() => String)
  async uploadCommentAttachment(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @Args('docId', { type: () => String }) _docId: string,
    @Args('attachment', { type: () => GraphQLUpload }) attachment: FileUpload,
  ): Promise<string> {
    const { createReadStream, mimetype } = attachment;
    const chunks: Buffer[] = [];
    for await (const chunk of createReadStream()) {
      chunks.push(chunk as Buffer);
    }
    const buffer = Buffer.concat(chunks);
    const key = await this.blobService.setBlob(workspaceId, buffer, mimetype);
    return `/api/workspaces/${workspaceId}/blobs/${key}`;
  }

  @Mutation(() => Boolean)
  async mentionUser(
    @CurrentUser() user: { id: string },
    @Args('input', { type: () => MentionInput }) input: MentionInput,
  ) {
    if (input.userId === user.id) return true;

    await this.notificationService.createMentionNotification(
      user.id,
      input.userId,
      input.workspaceId,
      {
        id: input.doc.id,
        title: input.doc.title,
        mode: input.doc.mode,
        blockId: input.doc.blockId,
        elementId: input.doc.elementId,
      },
    );
    return true;
  }
}

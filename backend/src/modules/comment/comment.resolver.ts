import {
  Resolver,
  Mutation,
  Args,
  ResolveField,
  Parent,
} from '@nestjs/graphql';
import { ForbiddenException, UseGuards } from '@nestjs/common';
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

/** 相手がページを読めない。フロントの ErrorNames と同じ名前（大文字なのでエラー名として返る） */
const MENTION_DENIED = 'MENTION_USER_DOC_ACCESS_DENIED';

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

    await this.notifyMentions(
      user.id,
      input.workspaceId,
      input.docId,
      input.docMode,
      input.mentions,
    );
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

    const commentInfo = await this.commentService.getCommentInfo(input.commentId);
    if (!commentInfo) {
      return reply;
    }
    const { workspaceId, docId, userId: authorId } = commentInfo;

    // 親コメントの作者へ。#223: ページを読めなくなっていたら送らない
    const notifyAuthor =
      authorId !== user.id &&
      (await this.commentService.canReceive(workspaceId, docId, authorId));
    if (notifyAuthor) {
      const title = await this.commentService.docTitle(workspaceId, docId);
      await this.notificationService.createCommentNotification(
        user.id,
        authorId,
        workspaceId,
        { id: docId, title, mode: input.docMode },
      );
    }

    await this.notifyMentions(
      user.id,
      workspaceId,
      docId,
      input.docMode,
      input.mentions,
    );
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

    // #223: 同じ WS のメンバーで、ページを読める人の間だけ（docs/mention-notification.md）
    const { workspaceId, doc } = input;
    await this.commentService.assertReadable(workspaceId, doc.id, user.id);
    const canReceive = await this.commentService.canReceive(
      workspaceId,
      doc.id,
      input.userId,
    );
    if (!canReceive) {
      // 画面が「このメンバーは通知されません」と出す
      throw new ForbiddenException(MENTION_DENIED);
    }

    await this.notificationService.createMentionNotification(
      user.id,
      input.userId,
      workspaceId,
      {
        id: doc.id,
        title: await this.commentService.docTitle(workspaceId, doc.id),
        mode: doc.mode,
        blockId: doc.blockId,
        elementId: doc.elementId,
      },
    );
    return true;
  }

  /**
   * コメント内のメンションを送る。#223: 読める相手にだけ、台帳の題で。
   *
   * 読めない相手は黙って外す。コメントは保存済みなので、拒否しても取り消せない。
   */
  private async notifyMentions(
    actorId: string,
    workspaceId: string,
    docId: string,
    docMode: string,
    mentions?: string[],
  ) {
    if (!mentions?.length) {
      return;
    }

    const title = await this.commentService.docTitle(workspaceId, docId);
    for (const targetId of mentions) {
      if (targetId === actorId) {
        continue;
      }
      if (
        !(await this.commentService.canReceive(workspaceId, docId, targetId))
      ) {
        continue;
      }
      await this.notificationService.createCommentMentionNotification(
        actorId,
        targetId,
        workspaceId,
        { id: docId, title, mode: docMode },
      );
    }
  }
}

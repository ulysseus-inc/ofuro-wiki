import {
  Resolver,
  Query,
  Mutation,
  Args,
  ObjectType,
  Field,
  Int,
} from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { DocService } from './doc.service';
import { DocHistoryService } from './doc-history.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ObjectType('WorkspaceDocListItem')
class WorkspaceDocListItem {
  @Field()
  workspaceId: string;

  @Field()
  docId: string;

  @Field({ nullable: true })
  title?: string;

  @Field()
  mode: string;

  @Field()
  public: boolean;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}

@ObjectType()
class DocHistoryType {
  @Field()
  id: string;

  @Field()
  timestamp: Date;

  @Field({ nullable: true })
  editorId?: string;
}

@ObjectType()
class WorkspacePage {
  @Field()
  workspaceId: string;

  @Field()
  id: string;

  @Field()
  mode: string;

  @Field()
  public: boolean;
}

@Resolver()
@UseGuards(JwtAuthGuard)
export class DocResolver {
  constructor(
    private docService: DocService,
    private docHistoryService: DocHistoryService,
  ) {}

  @Query(() => [WorkspaceDocListItem])
  async workspaceDocs(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
  ) {
    return this.docService.listDocs(workspaceId);
  }

  @Mutation(() => WorkspacePage)
  async publishPage(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @Args('pageId', { type: () => String }) pageId: string,
    @Args('mode', { nullable: true }) mode?: string,
  ) {
    const doc = await this.docService.publishPage(workspaceId, pageId, mode);
    return {
      workspaceId: doc.workspaceId,
      id: doc.docId,
      mode: doc.mode,
      public: doc.public,
    };
  }

  @Mutation(() => WorkspacePage)
  async revokePublicPage(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @Args('pageId', { type: () => String }) pageId: string,
  ) {
    const doc = await this.docService.revokePublicPage(workspaceId, pageId);
    return {
      workspaceId: doc.workspaceId,
      id: doc.docId,
      mode: doc.mode,
      public: doc.public,
    };
  }

  @Query(() => [DocHistoryType])
  async listHistory(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @Args('docId', { type: () => String }) docId: string,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    const items = await this.docHistoryService.listHistory(workspaceId, docId, {
      take,
    });
    return items.map((h) => ({
      id: h.id.toString(),
      timestamp: h.timestamp,
      editorId: h.editorId,
    }));
  }

  @Mutation(() => Boolean)
  async recoverDoc(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @Args('guid', { type: () => String }) guid: string,
    @Args('timestamp', { type: () => Date }) timestamp: Date,
  ) {
    await this.docHistoryService.recoverDocByTimestamp(
      workspaceId,
      guid,
      timestamp,
    );
    return true;
  }

  @Mutation(() => Boolean)
  async grantDocUserRoles(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @Args('docId', { type: () => String }) docId: string,
    @Args('userId', { type: () => String }) userId: string,
    @Args('role') role: string,
  ) {
    return this.docService.grantDocUserRole(workspaceId, docId, userId, role);
  }
}

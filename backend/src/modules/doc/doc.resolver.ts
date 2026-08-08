import {
  Resolver,
  Query,
  Mutation,
  Args,
  ObjectType,
  Field,
  Int,
} from '@nestjs/graphql';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { DocService } from './doc.service';
import { DocHistoryService } from './doc-history.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceMemberGuard } from '../../common/guards/workspace-member.guard';
import { WorkspaceRole } from '../../common/decorators/workspace-role.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
// #97: 認可の判定はすべてここに委ねる（docs/doc-permission.md 6.0）
import { PermissionService } from '../permission/permission.service';
import {
  canGrantDocRole,
  isDocDefaultRole,
  type DocAction,
  type DocRole,
} from '../permission/doc-role';
import {
  GrantDocUserRolesInput,
  RevokeDocUserRoleInput,
  UpdateDocDefaultRoleInput,
  UpdateDocUserRoleInput,
} from '../permission/permission.model';

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
@UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
export class DocResolver {
  constructor(
    private docService: DocService,
    private docHistoryService: DocHistoryService,
    private permission: PermissionService,
  ) {}

  @Query(() => [WorkspaceDocListItem])
  @WorkspaceRole('reader')
  async workspaceDocs(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @CurrentUser() user: { id: string },
  ) {
    const docs = await this.docService.listDocs(workspaceId);
    // ⚠️ 本文を返していなくても、タイトルと件数で存在が漏れる（6.0）
    const readable = new Set(
      await this.permission.filterReadable(
        workspaceId,
        docs.map((d) => d.docId),
        user.id,
      ),
    );
    return docs.filter((d) => readable.has(d.docId));
  }

  @Mutation(() => WorkspacePage)
  @WorkspaceRole('member')
  async publishPage(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @Args('pageId', { type: () => String }) pageId: string,
    @CurrentUser() user: { id: string },
    @Args('mode', { nullable: true }) mode?: string,
  ) {
    await this.requireDoc(workspaceId, pageId, user.id, 'Doc_Publish');
    const doc = await this.docService.publishPage(workspaceId, pageId, mode);
    return {
      workspaceId: doc.workspaceId,
      id: doc.docId,
      mode: doc.mode,
      public: doc.public,
    };
  }

  @Mutation(() => WorkspacePage)
  @WorkspaceRole('member')
  async revokePublicPage(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @Args('pageId', { type: () => String }) pageId: string,
    @CurrentUser() user: { id: string },
  ) {
    await this.requireDoc(workspaceId, pageId, user.id, 'Doc_Publish');
    const doc = await this.docService.revokePublicPage(workspaceId, pageId);
    return {
      workspaceId: doc.workspaceId,
      id: doc.docId,
      mode: doc.mode,
      public: doc.public,
    };
  }

  @Query(() => [DocHistoryType])
  @WorkspaceRole('reader')
  async listHistory(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @Args('docId', { type: () => String }) docId: string,
    @CurrentUser() user: { id: string },
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    // ⚠️ 履歴は本文そのもの。読めないなら「無い」ものとして扱う（6.8）
    if (!(await this.permission.canRead(workspaceId, docId, user.id))) return [];
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
  @WorkspaceRole('member')
  async recoverDoc(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @Args('guid', { type: () => String }) guid: string,
    @Args('timestamp', { type: () => Date }) timestamp: Date,
    @CurrentUser() user: { id: string },
  ) {
    // 過去の版を現在に戻す＝本文の書き換え
    await this.requireDoc(workspaceId, guid, user.id, 'Doc_Update');
    await this.docHistoryService.recoverDocByTimestamp(
      workspaceId,
      guid,
      timestamp,
    );
    return true;
  }

  /**
   * #97: 個別の権限を配る（docs/doc-permission.md 8章）。
   *
   * ⚠️ `@WorkspaceRole('member')` に留め、**実際の可否は `Doc_Users_Manage`
   * で判断する**。owner を要求すると、doc の Manager が自分の doc の権限を
   * 配れなくなる（doc 単位の権限を入れた意味が無くなる）。
   */
  @Mutation(() => Boolean)
  @WorkspaceRole('member')
  async grantDocUserRoles(
    @Args('input') input: GrantDocUserRolesInput,
    @CurrentUser() actor: { id: string },
  ) {
    const { workspaceId, docId, userIds, role } = input;
    await this.requireDoc(workspaceId, docId, actor.id, 'Doc_Users_Manage');
    await this.requireGrantable(workspaceId, docId, actor.id, role);
    for (const userId of userIds) {
      await this.docService.grantDocUserRole(workspaceId, docId, userId, role);
      // 相手が開いているタブで編集が続かないよう、その場で捨てる（7章）
      this.permission.invalidate(workspaceId, docId, userId);
    }
    return true;
  }

  @Mutation(() => Boolean)
  @WorkspaceRole('member')
  async revokeDocUserRoles(
    @Args('input') input: RevokeDocUserRoleInput,
    @CurrentUser() actor: { id: string },
  ) {
    const { workspaceId, docId, userId } = input;
    await this.requireDoc(workspaceId, docId, actor.id, 'Doc_Users_Manage');
    const result = await this.docService.revokeDocUserRole(
      workspaceId,
      docId,
      userId,
    );
    // ⚠️ 権限を外す操作でこれを忘れると、外したあとも編集が続けられる
    this.permission.invalidate(workspaceId, docId, userId);
    return result;
  }

  @Mutation(() => Boolean)
  @WorkspaceRole('member')
  async updateDocUserRole(
    @Args('input') input: UpdateDocUserRoleInput,
    @CurrentUser() actor: { id: string },
  ) {
    const { workspaceId, docId, userId, role } = input;
    await this.requireDoc(workspaceId, docId, actor.id, 'Doc_Users_Manage');
    await this.requireGrantable(workspaceId, docId, actor.id, role);
    const result = await this.docService.grantDocUserRole(
      workspaceId,
      docId,
      userId,
      role,
    );
    this.permission.invalidate(workspaceId, docId, userId);
    return result;
  }

  @Mutation(() => Boolean)
  @WorkspaceRole('member')
  async updateDocDefaultRole(
    @Args('input') input: UpdateDocDefaultRoleInput,
    @CurrentUser() actor: { id: string },
  ) {
    const { workspaceId, docId, role } = input;
    await this.requireDoc(workspaceId, docId, actor.id, 'Doc_Users_Manage');

    // ⚠️ 画面が扱えない値を保存させない。保存されると読み出しと表示が
    // 食い違い、開いて保存しただけで権限が下がる（doc-role.ts 参照）
    if (!isDocDefaultRole(role)) {
      throw new BadRequestException(
        `既定ロールに指定できない値です: ${role}`,
      );
    }
    const result = await this.docService.updateDocDefaultRole(
      workspaceId,
      docId,
      role,
    );
    // ⚠️ 既定ロールは**全員**の判定に効く。利用者を指定せず捨てる
    this.permission.invalidate(workspaceId, docId);
    return result;
  }

  /**
   * 権限が無ければ 404 で止める。
   *
   * ⚠️ 403 は「存在するが権限が無い」ことを伝えてしまう（6.8）。
   * ここで判定を書かず、`permission.can` の結果をそのまま使うこと。
   */
  /**
   * 自分より強いロールを配ろうとしていないか。
   *
   * ⚠️ **`Doc_Users_Manage` の有無だけでは足りない。** これを持つのは
   * Owner と Manager だが、Manager が `Owner` を配れると
   * **自分を Owner に昇格でき**（`Doc_TransferOwner` / `Doc_Delete` を得る）、
   * 権限機構が意味を失う。
   */
  private async requireGrantable(
    workspaceId: string,
    docId: string,
    actorId: string,
    role: DocRole,
  ): Promise<void> {
    const actorRole = await this.permission.getDocRole(
      workspaceId,
      docId,
      actorId,
    );
    if (actorRole === null || !canGrantDocRole(actorRole, role)) {
      throw new ForbiddenException(
        `自分より強い権限は付与できません: ${role}`,
      );
    }
  }

  private async requireDoc(
    workspaceId: string,
    docId: string,
    userId: string,
    action: DocAction,
  ): Promise<void> {
    if (!(await this.permission.can(workspaceId, docId, userId, action))) {
      throw new NotFoundException('Doc not found');
    }
  }
}

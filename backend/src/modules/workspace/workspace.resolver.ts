import {
  Resolver,
  Query,
  Mutation,
  Args,
  ResolveField,
  Parent,
  Int,
} from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import {
  WorkspaceType,
  InviteUserType,
  InvitationType,
  InviteLinkType,
  Permission,
  WorkspaceInviteLinkExpireTime,
  DocType,
  WorkspaceDocHistoryType,
  buildPermissions,
  buildDocPermissions,
} from './workspace.model';
import { DocHistoryService } from '../doc/doc-history.service';
import { ListedBlob } from '../blob/blob.resolver';
import { WorkspaceService } from './workspace.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma.service';

function statusToEnum(status: string): string {
  switch (status) {
    case 'accepted':
      return 'Accepted';
    case 'pending':
      return 'Pending';
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

function roleToPermission(role: string): Permission {
  switch (role) {
    case 'owner':
      return Permission.Owner;
    case 'admin':
      return Permission.Admin;
    case 'member':
      return Permission.Write;
    default:
      return Permission.Read;
  }
}

const WORKSPACE_CONFIG_DEFAULTS = {
  enableAi: false,
  enableSharing: true,
  enableUrlPreview: false,
  enableDocEmbedding: false,
  inviteLink: null,
  publicDocs: [],
  quota: {
    name: 'Selfhosted Unlimited',
    blobLimit: 1024 * 1024 * 1024, // 1GB per blob
    storageQuota: 1024 * 1024 * 1024 * 100, // 100GB total
    historyPeriod: 30 * 24 * 60 * 60 * 1000, // 30 days
    memberLimit: 1000,
    usedSize: 0,
    memberCount: 0,
    overcapacityMemberCount: 0,
    usedStorageQuota: 0,
    humanReadable: {
      name: 'Selfhosted Unlimited',
      blobLimit: '1 GB',
      storageQuota: '100 GB',
      historyPeriod: '30 days',
      memberLimit: '1000',
      memberCount: 0,
      overcapacityMemberCount: 0,
    },
  },
};

function buildWorkspaceResponse(workspace: any, role: string, userId: string) {
  const memberCount = workspace.members?.length ?? 0;
  return {
    id: workspace.id,
    name: workspace.name,
    avatar: workspace.avatarKey,
    public: workspace.public,
    initialized: true,
    createdAt: workspace.createdAt,
    permission: roleToPermission(role),
    memberCount,
    members: (workspace.members ?? []).map((m: any) => ({
      id: m.user.id,
      permission: roleToPermission(m.role),
      inviteId: m.id,
      email: m.user.email,
      name: m.user.name,
      avatarUrl: m.user.avatarUrl,
      accepted: m.status === 'accepted',
      emailVerified: m.user.emailVerified ?? false,
      status: statusToEnum(m.status),
    })),
    isOwner: workspace.ownerId === userId,
    team: false,
    owner: { id: workspace.ownerId },
    role: roleToPermission(role),
    _dbRole: role,
    permissions: buildPermissions(role),
    ...WORKSPACE_CONFIG_DEFAULTS,
    quota: {
      ...WORKSPACE_CONFIG_DEFAULTS.quota,
      memberCount,
      humanReadable: {
        ...WORKSPACE_CONFIG_DEFAULTS.quota.humanReadable,
        memberCount,
      },
    },
  };
}

@Resolver(() => WorkspaceType)
@UseGuards(JwtAuthGuard)
export class WorkspaceResolver {
  constructor(
    private workspaceService: WorkspaceService,
    private prisma: PrismaService,
    private docHistoryService: DocHistoryService,
  ) {}

  @Query(() => [WorkspaceType])
  async workspaces(@CurrentUser() user: { id: string }) {
    const items = await this.workspaceService.getUserWorkspaces(user.id);
    return items.map(({ workspace, role }) =>
      buildWorkspaceResponse(workspace, role, user.id),
    );
  }

  @Query(() => WorkspaceType)
  async workspace(
    @Args('id', { type: () => String }) id: string,
    @CurrentUser() user: { id: string },
  ) {
    const ws = await this.workspaceService.getWorkspace(id);
    if (!ws) throw new Error('Workspace not found');
    const role = await this.workspaceService.getMemberRole(id, user.id);
    return buildWorkspaceResponse(ws, role || 'reader', user.id);
  }

  @Query(() => InvitationType)
  @Public()
  async getInviteInfo(
    @Args('inviteId', { type: () => String }) inviteId: string,
  ) {
    return this.workspaceService.getInviteInfo(inviteId);
  }

  @ResolveField(() => [InviteUserType])
  async members(
    @Parent() workspace: WorkspaceType,
    @Args('skip', { type: () => Int, nullable: true }) skip?: number,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
    @Args('query', { type: () => String, nullable: true }) query?: string,
  ) {
    // If skip/take/query are specified, fetch from DB with pagination
    if (skip !== undefined || take !== undefined || query) {
      const members = await this.workspaceService.getMembers(
        workspace.id,
        skip ?? 0,
        take ?? 20,
        query ?? undefined,
      );
      return members.map((m: any) => ({
        id: m.user.id,
        permission: roleToPermission(m.role),
        inviteId: m.id,
        email: m.user.email,
        name: m.user.name,
        avatarUrl: m.user.avatarUrl,
        accepted: m.status === 'accepted',
        emailVerified: m.user.emailVerified ?? false,
        status: statusToEnum(m.status),
        sentSuccess: false,
      }));
    }
    // Otherwise return the pre-loaded members from workspace query
    return (workspace as any).members ?? [];
  }

  @ResolveField(() => Int)
  async memberCount(@Parent() workspace: WorkspaceType) {
    return this.workspaceService.getMemberCount(workspace.id);
  }

  @ResolveField(() => InviteLinkType, { nullable: true })
  async inviteLink(@Parent() workspace: WorkspaceType) {
    return this.workspaceService.getActiveInviteLink(workspace.id);
  }

  @ResolveField(() => [WorkspaceDocHistoryType])
  async histories(
    @Parent() workspace: WorkspaceType,
    @Args('guid', { type: () => String }) guid: string,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
    @Args('before', { type: () => Date, nullable: true }) before?: Date,
  ) {
    const items = await this.docHistoryService.listHistory(workspace.id, guid, {
      take,
      before,
    });
    return items.map(h => ({
      id: h.id.toString(),
      timestamp: h.timestamp,
      editor: h.editor
        ? { name: h.editor.name ?? undefined, avatarUrl: h.editor.avatarUrl ?? undefined }
        : undefined,
    }));
  }

  @ResolveField(() => DocType, { nullable: true })
  async doc(
    @Parent() workspace: WorkspaceType,
    @Args('docId', { type: () => String }) docId: string,
  ) {
    const meta = await this.prisma.docMeta.findUnique({
      where: {
        workspaceId_docId: { workspaceId: workspace.id, docId },
      },
    });

    // Return a default doc even if no meta exists (new docs won't have meta yet)
    return {
      id: docId,
      title: meta?.title ?? null,
      summary: null,
      mode: meta?.mode ?? 'page',
      public: meta?.public ?? false,
      defaultRole: meta?.defaultRole ?? 'manager',
      createdAt: meta?.createdAt ?? null,
      updatedAt: meta?.updatedAt ?? null,
      creatorId: meta?.createdById ?? null,
      lastUpdaterId: meta?.updatedById ?? null,
      workspaceId: workspace.id,
      permissions: buildDocPermissions((workspace as any)._dbRole || 'owner'),
    };
  }

  @ResolveField(() => [ListedBlob])
  async blobs(@Parent() workspace: WorkspaceType) {
    const blobs = await this.prisma.blob.findMany({
      where: { workspaceId: workspace.id, deleted: false },
      select: { key: true, mime: true, size: true, createdAt: true },
    });
    return blobs.map((b) => ({
      key: b.key,
      mime: b.mime || 'application/octet-stream',
      size: b.size ? Number(b.size) : 0,
      createdAt: b.createdAt.toISOString(),
    }));
  }

  @Mutation(() => WorkspaceType)
  async createWorkspace(
    @CurrentUser() user: { id: string },
    @Args('name', { nullable: true }) name?: string,
  ) {
    const ws = await this.workspaceService.createWorkspace(user.id, name);
    return {
      id: ws.id,
      name: ws.name,
      avatar: ws.avatarKey,
      public: ws.public,
      initialized: true,
      createdAt: ws.createdAt,
      permission: Permission.Owner,
      memberCount: 1,
      members: [],
      isOwner: true,
      team: false,
      owner: { id: user.id },
      role: 'owner',
      permissions: buildPermissions('owner'),
      ...WORKSPACE_CONFIG_DEFAULTS,
    };
  }

  @Mutation(() => Boolean)
  async deleteWorkspace(
    @Args('id', { type: () => String }) id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.workspaceService.deleteWorkspace(id, user.id);
  }

  @Mutation(() => [InviteUserType])
  async inviteMembers(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @Args('emails', { type: () => [String] }) emails: string[],
    @CurrentUser() user: { id: string },
  ) {
    const results: Array<{
      id: string;
      permission: Permission;
      inviteId: string;
      email: string | null;
      accepted: boolean;
      sentSuccess: boolean;
    }> = [];
    for (const email of emails) {
      const inv = await this.workspaceService.inviteByEmail(
        workspaceId,
        user.id,
        email,
      );
      results.push({
        id: inv.id,
        permission: Permission.Write,
        inviteId: inv.id,
        email: inv.email,
        accepted: false,
        sentSuccess: inv.sentSuccess,
      });
    }
    return results;
  }

  @Mutation(() => Boolean)
  async revokeMember(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @Args('userId', { type: () => String }) userId: string,
  ) {
    return this.workspaceService.removeMember(workspaceId, userId);
  }

  @Mutation(() => Boolean)
  async acceptInviteById(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @Args('inviteId', { type: () => String }) inviteId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.workspaceService.acceptInvite(workspaceId, inviteId, user.id);
  }

  @Mutation(() => Boolean)
  async leaveWorkspace(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @Args('sendLeaveMail', { type: () => Boolean, nullable: true })
    _sendLeaveMail?: boolean,
    @CurrentUser() user?: { id: string },
  ) {
    return this.workspaceService.leaveWorkspace(workspaceId, user!.id);
  }

  @Mutation(() => Boolean)
  async grantMember(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @Args('userId', { type: () => String }) userId: string,
    @Args('permission', { type: () => Permission }) permission: Permission,
    @CurrentUser() user: { id: string },
  ) {
    return this.workspaceService.grantMember(
      workspaceId,
      userId,
      permission,
      user.id,
    );
  }

  @Mutation(() => Boolean)
  async approveMember(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @Args('userId', { type: () => String }) userId: string,
  ) {
    // In self-hosted mode, auto-approve all members
    await this.prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId } },
      data: { status: 'accepted' },
    });
    return true;
  }

  @Mutation(() => InviteLinkType)
  async createInviteLink(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @Args('expireTime', { type: () => WorkspaceInviteLinkExpireTime })
    expireTime: WorkspaceInviteLinkExpireTime,
    @CurrentUser() user: { id: string },
  ) {
    return this.workspaceService.createInviteLink(
      workspaceId,
      expireTime,
      user.id,
    );
  }

  @Mutation(() => Boolean)
  async revokeInviteLink(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
  ) {
    return this.workspaceService.revokeInviteLink(workspaceId);
  }
}

import {
  ObjectType,
  Field,
  ID,
  Int,
  registerEnumType,
} from '@nestjs/graphql';

export enum Permission {
  Owner = 'Owner',
  Admin = 'Admin',
  Write = 'Write',
  Read = 'Read',
}

registerEnumType(Permission, { name: 'Permission' });

export enum WorkspaceInviteLinkExpireTime {
  OneDay = 'OneDay',
  ThreeDays = 'ThreeDays',
  OneWeek = 'OneWeek',
  OneMonth = 'OneMonth',
}

registerEnumType(WorkspaceInviteLinkExpireTime, {
  name: 'WorkspaceInviteLinkExpireTime',
});

@ObjectType('InviteUserType')
export class InviteUserType {
  @Field(() => ID)
  id: string;

  @Field(() => Permission)
  permission: Permission;

  @Field()
  inviteId: string;

  @Field({ nullable: true })
  email?: string;

  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  avatarUrl?: string;

  @Field()
  accepted: boolean;

  @Field({ nullable: true })
  emailVerified?: boolean;

  @Field({ nullable: true })
  status?: string;

  @Field({ deprecationReason: 'Notification will be sent asynchronously' })
  sentSuccess: boolean;
}

@ObjectType('InvitationWorkspaceType')
export class InvitationWorkspaceType {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  avatar: string;
}

@ObjectType('WorkspaceUserType')
export class WorkspaceUserType {
  @Field(() => ID)
  id: string;

  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  email?: string;

  @Field({ nullable: true })
  avatarUrl?: string;
}

@ObjectType('InvitationType')
export class InvitationType {
  @Field(() => InvitationWorkspaceType)
  workspace: InvitationWorkspaceType;

  @Field(() => WorkspaceUserType)
  user: WorkspaceUserType;

  @Field(() => WorkspaceUserType)
  invitee: WorkspaceUserType;

  @Field({ nullable: true })
  status?: string;
}

@ObjectType()
class WorkspaceOwnerType {
  @Field(() => ID)
  id: string;
}

@ObjectType()
class WorkspacePermissionsType {
  @Field() Workspace_Administrators_Manage: boolean;
  @Field() Workspace_Blobs_List: boolean;
  @Field() Workspace_Blobs_Read: boolean;
  @Field() Workspace_Blobs_Write: boolean;
  @Field() Workspace_Copilot: boolean;
  @Field() Workspace_CreateDoc: boolean;
  @Field() Workspace_Delete: boolean;
  @Field() Workspace_Organize_Read: boolean;
  @Field() Workspace_Payment_Manage: boolean;
  @Field() Workspace_Properties_Create: boolean;
  @Field() Workspace_Properties_Delete: boolean;
  @Field() Workspace_Properties_Read: boolean;
  @Field() Workspace_Properties_Update: boolean;
  @Field() Workspace_Read: boolean;
  @Field() Workspace_Settings_Read: boolean;
  @Field() Workspace_Settings_Update: boolean;
  @Field() Workspace_Sync: boolean;
  @Field() Workspace_TransferOwner: boolean;
  @Field() Workspace_Users_Manage: boolean;
  @Field() Workspace_Users_Read: boolean;
}

export function buildPermissions(role: string): WorkspacePermissionsType {
  const isOwner = role === 'owner';
  const isAdmin = isOwner || role === 'admin';
  const isWriter = isAdmin || role === 'member' || role === 'write';
  return {
    Workspace_Administrators_Manage: isOwner,
    Workspace_Blobs_List: true,
    Workspace_Blobs_Read: true,
    Workspace_Blobs_Write: isWriter,
    Workspace_Copilot: isWriter,
    Workspace_CreateDoc: isWriter,
    Workspace_Delete: isOwner,
    Workspace_Organize_Read: true,
    Workspace_Payment_Manage: isOwner,
    Workspace_Properties_Create: isAdmin,
    Workspace_Properties_Delete: isAdmin,
    Workspace_Properties_Read: true,
    Workspace_Properties_Update: isAdmin,
    Workspace_Read: true,
    Workspace_Settings_Read: true,
    Workspace_Settings_Update: isAdmin,
    Workspace_Sync: true,
    Workspace_TransferOwner: isOwner,
    Workspace_Users_Manage: isAdmin,
    Workspace_Users_Read: true,
  };
}

@ObjectType('InviteLink')
export class InviteLinkType {
  @Field()
  link: string;

  @Field()
  expireTime: Date;
}

@ObjectType()
class DocPermissionsType {
  @Field() Doc_Copy: boolean;
  @Field() Doc_Delete: boolean;
  @Field() Doc_Duplicate: boolean;
  @Field() Doc_Properties_Read: boolean;
  @Field() Doc_Properties_Update: boolean;
  @Field() Doc_Publish: boolean;
  @Field() Doc_Read: boolean;
  @Field() Doc_Restore: boolean;
  @Field() Doc_TransferOwner: boolean;
  @Field() Doc_Trash: boolean;
  @Field() Doc_Update: boolean;
  @Field() Doc_Users_Manage: boolean;
  @Field() Doc_Users_Read: boolean;
  @Field() Doc_Comments_Create: boolean;
  @Field() Doc_Comments_Delete: boolean;
  @Field() Doc_Comments_Read: boolean;
  @Field() Doc_Comments_Resolve: boolean;
}

export function buildDocPermissions(role: string): DocPermissionsType {
  const isOwner = role === 'owner';
  const isAdmin = isOwner || role === 'admin';
  const isWriter = isAdmin || role === 'member' || role === 'write';
  return {
    Doc_Copy: true,
    Doc_Delete: isWriter,
    Doc_Duplicate: true,
    Doc_Properties_Read: true,
    Doc_Properties_Update: isWriter,
    Doc_Publish: isAdmin,
    Doc_Read: true,
    Doc_Restore: isWriter,
    Doc_TransferOwner: isOwner,
    Doc_Trash: isWriter,
    Doc_Update: isWriter,
    Doc_Users_Manage: isAdmin,
    Doc_Users_Read: true,
    Doc_Comments_Create: isWriter,
    Doc_Comments_Delete: isAdmin,
    Doc_Comments_Read: true,
    Doc_Comments_Resolve: isWriter,
  };
}

@ObjectType('DocType')
export class DocType {
  @Field()
  id: string;

  @Field({ nullable: true })
  title?: string;

  @Field({ nullable: true })
  summary?: string;

  @Field()
  mode: string;

  @Field()
  public: boolean;

  @Field()
  defaultRole: string;

  @Field({ nullable: true })
  createdAt?: Date;

  @Field({ nullable: true })
  updatedAt?: Date;

  @Field({ nullable: true })
  creatorId?: string;

  @Field({ nullable: true })
  lastUpdaterId?: string;

  @Field()
  workspaceId: string;

  @Field(() => DocPermissionsType, { nullable: true })
  permissions?: DocPermissionsType;
}

@ObjectType()
class HumanReadableQuotaType {
  @Field()
  name: string;

  @Field()
  blobLimit: string;

  @Field()
  storageQuota: string;

  @Field()
  historyPeriod: string;

  @Field()
  memberLimit: string;

  @Field(() => Int)
  memberCount: number;

  @Field(() => Int)
  overcapacityMemberCount: number;
}

@ObjectType()
class WorkspaceQuotaType {
  @Field()
  name: string;

  @Field()
  blobLimit: number;

  @Field()
  storageQuota: number;

  @Field()
  historyPeriod: number;

  @Field()
  memberLimit: number;

  @Field(() => Int)
  usedSize: number;

  @Field(() => Int)
  memberCount: number;

  @Field(() => Int)
  overcapacityMemberCount: number;

  @Field(() => Int)
  usedStorageQuota: number;

  @Field(() => HumanReadableQuotaType)
  humanReadable: HumanReadableQuotaType;
}

@ObjectType('DocHistoryEditorType')
export class DocHistoryEditorType {
  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  avatarUrl?: string;
}

@ObjectType('WorkspaceDocHistoryType')
export class WorkspaceDocHistoryType {
  @Field()
  id: string;

  @Field()
  timestamp: Date;

  @Field(() => DocHistoryEditorType, { nullable: true })
  editor?: DocHistoryEditorType;
}

@ObjectType('WorkspaceType')
export class WorkspaceType {
  @Field(() => ID)
  id: string;

  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  avatar?: string;

  @Field()
  public: boolean;

  @Field()
  initialized: boolean;

  @Field()
  createdAt: Date;

  @Field(() => Permission)
  permission: Permission;

  @Field(() => Int)
  memberCount: number;

  @Field(() => [InviteUserType])
  members: InviteUserType[];

  @Field()
  isOwner: boolean;

  @Field()
  team: boolean;

  @Field(() => WorkspaceOwnerType)
  owner: WorkspaceOwnerType;

  @Field(() => String)
  role: string;

  @Field(() => WorkspacePermissionsType, { nullable: true })
  permissions?: WorkspacePermissionsType;

  @Field()
  enableAi: boolean;

  @Field()
  enableSharing: boolean;

  @Field()
  enableUrlPreview: boolean;

  @Field()
  enableDocEmbedding: boolean;

  @Field(() => InviteLinkType, { nullable: true })
  inviteLink?: InviteLinkType;

  @Field(() => WorkspaceQuotaType, { nullable: true })
  quota?: WorkspaceQuotaType;

  @Field(() => [DocType])
  publicDocs: DocType[];
}

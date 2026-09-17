export type Maybe<T> = T | null;
export type InputMaybe<T> = T | null;
export type Exact<T extends { [key: string]: unknown }> = {
  [K in keyof T]: T[K];
};
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]?: Maybe<T[SubKey]>;
};
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]: Maybe<T[SubKey]>;
};
export type MakeEmpty<
  T extends { [key: string]: unknown },
  K extends keyof T,
> = { [_ in K]?: never };
export type Incremental<T> =
  | T
  | {
      [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never;
    };
/** All built-in and custom scalars, mapped to their actual values */
export interface Scalars {
  ID: { input: string; output: string };
  String: { input: string; output: string };
  Boolean: { input: boolean; output: boolean };
  Int: { input: number; output: number };
  Float: { input: number; output: number };
  /** A date-time string at UTC, such as 2019-12-03T09:54:33Z, compliant with the date-time format. */
  DateTime: { input: string; output: string };
  /** The `JSON` scalar type represents JSON values as specified by [ECMA-404](http://www.ecma-international.org/publications/files/ECMA-ST/ECMA-404.pdf). */
  JSON: { input: any; output: any };
  /** The `Upload` scalar type represents a file upload. */
  Upload: { input: File; output: File };
}

export interface AdminCreateUserInput {
  email: Scalars['String']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  password: Scalars['String']['input'];
}

export interface AdminUserItem {
  __typename?: 'AdminUserItem';
  avatarUrl: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  email: Scalars['String']['output'];
  emailVerified: Scalars['Boolean']['output'];
  id: Scalars['String']['output'];
  isAdmin: Scalars['Boolean']['output'];
  name: Maybe<Scalars['String']['output']>;
}

export interface AdminUserList {
  __typename?: 'AdminUserList';
  items: Array<AdminUserItem>;
  totalCount: Scalars['Int']['output'];
}

export interface AggregateBucketHitsObjectType {
  __typename?: 'AggregateBucketHitsObjectType';
  nodes: Array<SearchNodeObjectType>;
}

export interface AggregateBucketObjectType {
  __typename?: 'AggregateBucketObjectType';
  count: Scalars['Int']['output'];
  hits: AggregateBucketHitsObjectType;
  key: Scalars['String']['output'];
  score: Maybe<Scalars['Float']['output']>;
}

export interface AggregateHitsOptions {
  fields: Array<Scalars['String']['input']>;
  highlights?: InputMaybe<Array<SearchHighlight>>;
  pagination?: InputMaybe<AggregateHitsPagination>;
}

export interface AggregateHitsPagination {
  limit?: InputMaybe<Scalars['Int']['input']>;
  skip?: InputMaybe<Scalars['Int']['input']>;
}

export interface AggregateInput {
  field: Scalars['String']['input'];
  options: AggregateOptions;
  query: SearchQuery;
  table: SearchTable;
}

export interface AggregateOptions {
  hits: AggregateHitsOptions;
  pagination?: InputMaybe<SearchPagination>;
}

export interface AggregateResultObjectType {
  __typename?: 'AggregateResultObjectType';
  buckets: Array<AggregateBucketObjectType>;
  pagination: SearchResultPagination;
}

export interface AuditLogItem {
  __typename?: 'AuditLogItem';
  action: Scalars['String']['output'];
  actorEmail: Scalars['String']['output'];
  actorId: Maybe<Scalars['String']['output']>;
  actorName: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  detail: Maybe<Scalars['JSON']['output']>;
  id: Scalars['String']['output'];
  ip: Maybe<Scalars['String']['output']>;
  targetId: Maybe<Scalars['String']['output']>;
  targetName: Maybe<Scalars['String']['output']>;
  targetType: Maybe<Scalars['String']['output']>;
  userAgent: Maybe<Scalars['String']['output']>;
  workspaceId: Maybe<Scalars['String']['output']>;
}

export interface AuditLogList {
  __typename?: 'AuditLogList';
  items: Array<AuditLogItem>;
  totalCount: Scalars['Int']['output'];
}

export interface BackupRecordList {
  __typename?: 'BackupRecordList';
  items: Array<BackupRecordType>;
  totalCount: Scalars['Int']['output'];
}

export interface BackupRecordType {
  __typename?: 'BackupRecordType';
  blobCount: Scalars['Int']['output'];
  createdAt: Scalars['DateTime']['output'];
  createdBy: Maybe<Scalars['String']['output']>;
  docCount: Scalars['Int']['output'];
  filename: Scalars['String']['output'];
  id: Scalars['String']['output'];
  size: Scalars['String']['output'];
  status: Scalars['String']['output'];
  workspaceCount: Scalars['Int']['output'];
}

export interface BlobUploadInit {
  __typename?: 'BlobUploadInit';
  alreadyUploaded: Maybe<Scalars['Boolean']['output']>;
  blobKey: Scalars['String']['output'];
  expiresAt: Maybe<Scalars['DateTime']['output']>;
  headers: Maybe<Scalars['JSON']['output']>;
  method: BlobUploadMethod;
  partSize: Maybe<Scalars['Int']['output']>;
  uploadId: Maybe<Scalars['String']['output']>;
  uploadUrl: Maybe<Scalars['String']['output']>;
  uploadedParts: Maybe<Array<BlobUploadedPart>>;
}

export enum BlobUploadMethod {
  GRAPHQL = 'GRAPHQL',
  MULTIPART = 'MULTIPART',
  PRESIGNED = 'PRESIGNED',
}

export interface BlobUploadedPart {
  __typename?: 'BlobUploadedPart';
  etag: Scalars['String']['output'];
  partNumber: Scalars['Int']['output'];
}

export enum CommentChangeAction {
  delete = 'delete',
  update = 'update',
}

export interface CommentChangeEdge {
  __typename?: 'CommentChangeEdge';
  cursor: Scalars['String']['output'];
  node: CommentChangeObjectType;
}

export interface CommentChangeObjectType {
  __typename?: 'CommentChangeObjectType';
  action: CommentChangeAction;
  commentId: Maybe<Scalars['ID']['output']>;
  id: Scalars['ID']['output'];
  item: Scalars['JSON']['output'];
}

export interface CommentCreateInput {
  content: Scalars['JSON']['input'];
  docId: Scalars['ID']['input'];
  docMode: Scalars['String']['input'];
  docTitle: Scalars['String']['input'];
  mentions?: InputMaybe<Array<Scalars['String']['input']>>;
  workspaceId: Scalars['ID']['input'];
}

export interface CommentEdge {
  __typename?: 'CommentEdge';
  cursor: Scalars['String']['output'];
  node: CommentObjectType;
}

export interface CommentObjectType {
  __typename?: 'CommentObjectType';
  content: Scalars['JSON']['output'];
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  replies: Array<ReplyObjectType>;
  resolved: Scalars['Boolean']['output'];
  updatedAt: Scalars['DateTime']['output'];
  user: PublicUserType;
}

export interface CommentResolveInput {
  id: Scalars['ID']['input'];
  resolved: Scalars['Boolean']['input'];
}

export interface CommentUpdateInput {
  content: Scalars['JSON']['input'];
  id: Scalars['ID']['input'];
}

export interface CopilotQuotaDetail {
  __typename?: 'CopilotQuotaDetail';
  limit: Maybe<Scalars['Float']['output']>;
  used: Maybe<Scalars['Float']['output']>;
}

export interface CredentialsRequirementType {
  __typename?: 'CredentialsRequirementType';
  password: PasswordLimitsType;
}

export interface CsvImportResult {
  __typename?: 'CsvImportResult';
  ngCount: Scalars['Int']['output'];
  okCount: Scalars['Int']['output'];
  rows: Array<CsvUserRowResult>;
}

export interface CsvUserRowResult {
  __typename?: 'CsvUserRowResult';
  email: Scalars['String']['output'];
  error: Maybe<Scalars['String']['output']>;
  line: Scalars['Int']['output'];
  name: Maybe<Scalars['String']['output']>;
  ok: Scalars['Boolean']['output'];
}

export interface DeleteAccountResult {
  __typename?: 'DeleteAccountResult';
  success: Scalars['Boolean']['output'];
}

export interface DiscoveryDocument {
  __typename?: 'DiscoveryDocument';
  createdAt: Scalars['String']['output'];
  createdBy: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  mode: Scalars['String']['output'];
  tagIds: Array<Scalars['String']['output']>;
  tagsRevision: Scalars['String']['output'];
  title: Maybe<Scalars['String']['output']>;
  titleRevision: Scalars['String']['output'];
  trash: Scalars['Boolean']['output'];
  trashRevision: Scalars['String']['output'];
  updatedAt: Scalars['String']['output'];
  updatedBy: Maybe<Scalars['String']['output']>;
}

export interface DiscoverySnapshot {
  __typename?: 'DiscoverySnapshot';
  documents: Array<DiscoveryDocument>;
  fetchedAt: Scalars['String']['output'];
  revision: Scalars['String']['output'];
  userId: Scalars['String']['output'];
  workspaceId: Scalars['String']['output'];
}

export interface DocGrantedUserInfo {
  __typename?: 'DocGrantedUserInfo';
  avatarUrl: Maybe<Scalars['String']['output']>;
  email: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  name: Maybe<Scalars['String']['output']>;
}

export interface DocHistoryEditorType {
  __typename?: 'DocHistoryEditorType';
  avatarUrl: Maybe<Scalars['String']['output']>;
  name: Maybe<Scalars['String']['output']>;
}

export interface DocHistoryType {
  __typename?: 'DocHistoryType';
  editorId: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  timestamp: Scalars['DateTime']['output'];
}

export interface DocMetaWriteResult {
  __typename?: 'DocMetaWriteResult';
  currentTitle: Maybe<Scalars['String']['output']>;
  currentTrash: Maybe<Scalars['Boolean']['output']>;
  revision: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  tagsRevision: Maybe<Scalars['String']['output']>;
  titleRevision: Maybe<Scalars['String']['output']>;
  trashRevision: Maybe<Scalars['String']['output']>;
}

export interface DocPermissionsType {
  __typename?: 'DocPermissionsType';
  Doc_Comments_Create: Scalars['Boolean']['output'];
  Doc_Comments_Delete: Scalars['Boolean']['output'];
  Doc_Comments_Read: Scalars['Boolean']['output'];
  Doc_Comments_Resolve: Scalars['Boolean']['output'];
  Doc_Copy: Scalars['Boolean']['output'];
  Doc_Delete: Scalars['Boolean']['output'];
  Doc_Duplicate: Scalars['Boolean']['output'];
  Doc_Properties_Read: Scalars['Boolean']['output'];
  Doc_Properties_Update: Scalars['Boolean']['output'];
  Doc_Publish: Scalars['Boolean']['output'];
  Doc_Read: Scalars['Boolean']['output'];
  Doc_Restore: Scalars['Boolean']['output'];
  Doc_TransferOwner: Scalars['Boolean']['output'];
  Doc_Trash: Scalars['Boolean']['output'];
  Doc_Update: Scalars['Boolean']['output'];
  Doc_Users_Manage: Scalars['Boolean']['output'];
  Doc_Users_Read: Scalars['Boolean']['output'];
}

/** ドキュメント単位のロール（docs/doc-permission.md 5章） */
export enum DocRole {
  Commenter = 'Commenter',
  Editor = 'Editor',
  External = 'External',
  Manager = 'Manager',
  None = 'None',
  Owner = 'Owner',
  Reader = 'Reader',
}

export interface DocType {
  __typename?: 'DocType';
  createdAt: Maybe<Scalars['DateTime']['output']>;
  creatorId: Maybe<Scalars['String']['output']>;
  defaultRole: DocRole;
  grantedUsersList: PaginatedGrantedDocUserType;
  id: Scalars['String']['output'];
  lastUpdaterId: Maybe<Scalars['String']['output']>;
  mode: Scalars['String']['output'];
  permissions: Maybe<DocPermissionsType>;
  public: Scalars['Boolean']['output'];
  summary: Maybe<Scalars['String']['output']>;
  title: Maybe<Scalars['String']['output']>;
  updatedAt: Maybe<Scalars['DateTime']['output']>;
  workspaceId: Scalars['String']['output'];
}

export interface DocTypeGrantedUsersListArgs {
  pagination?: InputMaybe<PaginationInput>;
}

export enum FeatureType {
  AIEarlyAccess = 'AIEarlyAccess',
  Admin = 'Admin',
  EarlyAccess = 'EarlyAccess',
  FreePlan = 'FreePlan',
  LifetimeProPlan = 'LifetimeProPlan',
  ProPlan = 'ProPlan',
  TeamPlan = 'TeamPlan',
  UnlimitedCopilot = 'UnlimitedCopilot',
  UnlimitedWorkspace = 'UnlimitedWorkspace',
}

export interface GrantDocUserRolesInput {
  docId: Scalars['String']['input'];
  role: DocRole;
  userIds: Array<Scalars['String']['input']>;
  workspaceId: Scalars['String']['input'];
}

export interface GrantedDocUserEdge {
  __typename?: 'GrantedDocUserEdge';
  cursor: Scalars['String']['output'];
  node: GrantedDocUserType;
}

export interface GrantedDocUserPageInfo {
  __typename?: 'GrantedDocUserPageInfo';
  endCursor: Maybe<Scalars['String']['output']>;
  hasNextPage: Scalars['Boolean']['output'];
}

export interface GrantedDocUserType {
  __typename?: 'GrantedDocUserType';
  role: DocRole;
  user: DocGrantedUserInfo;
}

export interface HumanReadableQuotaType {
  __typename?: 'HumanReadableQuotaType';
  blobLimit: Scalars['String']['output'];
  historyPeriod: Scalars['String']['output'];
  memberCount: Scalars['Int']['output'];
  memberLimit: Scalars['String']['output'];
  name: Scalars['String']['output'];
  overcapacityMemberCount: Scalars['Int']['output'];
  storageQuota: Scalars['String']['output'];
}

export interface InvitationType {
  __typename?: 'InvitationType';
  invitee: WorkspaceUserType;
  status: Maybe<WorkspaceMemberStatus>;
  user: WorkspaceUserType;
  workspace: InvitationWorkspaceType;
}

export interface InvitationWorkspaceType {
  __typename?: 'InvitationWorkspaceType';
  avatar: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
}

export interface InviteLink {
  __typename?: 'InviteLink';
  expireTime: Scalars['DateTime']['output'];
  link: Scalars['String']['output'];
}

export interface InviteUserType {
  __typename?: 'InviteUserType';
  accepted: Scalars['Boolean']['output'];
  avatarUrl: Maybe<Scalars['String']['output']>;
  email: Maybe<Scalars['String']['output']>;
  emailVerified: Maybe<Scalars['Boolean']['output']>;
  id: Scalars['ID']['output'];
  inviteId: Scalars['String']['output'];
  name: Maybe<Scalars['String']['output']>;
  permission: Permission;
  /** @deprecated Notification will be sent asynchronously */
  sentSuccess: Scalars['Boolean']['output'];
  status: Maybe<WorkspaceMemberStatus>;
}

export interface ListedBlob {
  __typename?: 'ListedBlob';
  createdAt: Scalars['String']['output'];
  key: Scalars['String']['output'];
  mime: Scalars['String']['output'];
  size: Scalars['Int']['output'];
}

export interface MentionDocInput {
  blockId?: InputMaybe<Scalars['String']['input']>;
  elementId?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['String']['input'];
  mode: Scalars['String']['input'];
  title: Scalars['String']['input'];
}

export interface MentionInput {
  doc: MentionDocInput;
  userId: Scalars['String']['input'];
  workspaceId: Scalars['String']['input'];
}

export interface Mutation {
  __typename?: 'Mutation';
  acceptInviteById: Scalars['Boolean']['output'];
  adminCreateBackup: BackupRecordType;
  adminCreateUser: AdminUserItem;
  adminDeleteBackup: Scalars['Boolean']['output'];
  adminDeleteUser: Scalars['Boolean']['output'];
  adminImportUsers: CsvImportResult;
  adminRevokeUserSessions: Scalars['Boolean']['output'];
  adminSetUserAdmin: AdminUserItem;
  adminSetUserPassword: Scalars['Boolean']['output'];
  adminUpdateServerSetting: ServerSettingType;
  adminValidateUserCsv: CsvImportResult;
  approveMember: Scalars['Boolean']['output'];
  changeDocTags: DocMetaWriteResult;
  changeEmail: UserType;
  changeMyPassword: Scalars['Boolean']['output'];
  changePassword: Scalars['Boolean']['output'];
  completeBlobUpload: Scalars['Boolean']['output'];
  createBlobUpload: BlobUploadInit;
  createChangePasswordUrl: Scalars['String']['output'];
  createComment: CommentObjectType;
  createDocMeta: DocMetaWriteResult;
  createInviteLink: InviteLink;
  createReply: ReplyObjectType;
  createWorkspace: WorkspaceType;
  deleteAccount: DeleteAccountResult;
  deleteBlob: Scalars['Boolean']['output'];
  deleteComment: Scalars['Boolean']['output'];
  deleteDocMeta: DocMetaWriteResult;
  deleteReply: Scalars['Boolean']['output'];
  deleteWorkspace: Scalars['Boolean']['output'];
  grantDocUserRoles: Scalars['Boolean']['output'];
  grantMember: Scalars['Boolean']['output'];
  inviteMembers: Array<InviteUserType>;
  leaveWorkspace: Scalars['Boolean']['output'];
  mentionUser: Scalars['Boolean']['output'];
  publishPage: WorkspacePage;
  readAllNotifications: Scalars['Boolean']['output'];
  readNotification: Scalars['Boolean']['output'];
  recoverDoc: Scalars['Boolean']['output'];
  reindexWorkspace: Scalars['Boolean']['output'];
  releaseDeletedBlobs: Scalars['Boolean']['output'];
  removeAvatar: RemoveAvatarResult;
  resolveComment: Scalars['Boolean']['output'];
  revokeDocUserRoles: Scalars['Boolean']['output'];
  revokeInviteLink: Scalars['Boolean']['output'];
  revokeMember: Scalars['Boolean']['output'];
  revokePublicPage: WorkspacePage;
  sendChangeEmail: Scalars['Boolean']['output'];
  sendTestEmail: Scalars['Boolean']['output'];
  sendVerifyChangeEmail: Scalars['Boolean']['output'];
  sendVerifyEmail: Scalars['Boolean']['output'];
  setBlob: Scalars['String']['output'];
  setDocTitle: DocMetaWriteResult;
  setDocTrash: DocMetaWriteResult;
  testOidcConnection: OidcTestResultType;
  updateComment: Scalars['Boolean']['output'];
  updateDocDefaultRole: Scalars['Boolean']['output'];
  updateDocUserRole: Scalars['Boolean']['output'];
  updateOidcConfig: OidcConfigType;
  updateProfile: UserType;
  updateReply: Scalars['Boolean']['output'];
  updateSettings: Scalars['Boolean']['output'];
  uploadAvatar: UserType;
  uploadCommentAttachment: Scalars['String']['output'];
  verifyEmail: Scalars['Boolean']['output'];
}

export interface MutationAcceptInviteByIdArgs {
  inviteId: Scalars['String']['input'];
  workspaceId: Scalars['String']['input'];
}

export interface MutationAdminCreateUserArgs {
  input: AdminCreateUserInput;
}

export interface MutationAdminDeleteBackupArgs {
  id: Scalars['String']['input'];
}

export interface MutationAdminDeleteUserArgs {
  userId: Scalars['String']['input'];
}

export interface MutationAdminImportUsersArgs {
  csv: Scalars['String']['input'];
}

export interface MutationAdminRevokeUserSessionsArgs {
  userId: Scalars['String']['input'];
}

export interface MutationAdminSetUserAdminArgs {
  isAdmin: Scalars['Boolean']['input'];
  userId: Scalars['String']['input'];
}

export interface MutationAdminSetUserPasswordArgs {
  password: Scalars['String']['input'];
  userId: Scalars['String']['input'];
}

export interface MutationAdminUpdateServerSettingArgs {
  key: Scalars['String']['input'];
  value: Scalars['String']['input'];
}

export interface MutationAdminValidateUserCsvArgs {
  csv: Scalars['String']['input'];
}

export interface MutationApproveMemberArgs {
  userId: Scalars['String']['input'];
  workspaceId: Scalars['String']['input'];
}

export interface MutationChangeDocTagsArgs {
  add?: InputMaybe<Array<Scalars['String']['input']>>;
  docId: Scalars['String']['input'];
  remove?: InputMaybe<Array<Scalars['String']['input']>>;
  workspaceId: Scalars['String']['input'];
}

export interface MutationChangeEmailArgs {
  email: Scalars['String']['input'];
  token: Scalars['String']['input'];
}

export interface MutationChangeMyPasswordArgs {
  currentPassword: Scalars['String']['input'];
  newPassword: Scalars['String']['input'];
}

export interface MutationChangePasswordArgs {
  newPassword: Scalars['String']['input'];
  token: Scalars['String']['input'];
  userId?: InputMaybe<Scalars['String']['input']>;
}

export interface MutationCompleteBlobUploadArgs {
  key: Scalars['String']['input'];
  workspaceId: Scalars['String']['input'];
}

export interface MutationCreateBlobUploadArgs {
  key: Scalars['String']['input'];
  mime: Scalars['String']['input'];
  size: Scalars['Int']['input'];
  workspaceId: Scalars['String']['input'];
}

export interface MutationCreateChangePasswordUrlArgs {
  callbackUrl: Scalars['String']['input'];
  userId: Scalars['String']['input'];
}

export interface MutationCreateCommentArgs {
  input: CommentCreateInput;
}

export interface MutationCreateDocMetaArgs {
  docId: Scalars['String']['input'];
  mode?: InputMaybe<Scalars['String']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
  workspaceId: Scalars['String']['input'];
}

export interface MutationCreateInviteLinkArgs {
  expireTime: WorkspaceInviteLinkExpireTime;
  workspaceId: Scalars['String']['input'];
}

export interface MutationCreateReplyArgs {
  input: ReplyCreateInput;
}

export interface MutationCreateWorkspaceArgs {
  name?: InputMaybe<Scalars['String']['input']>;
}

export interface MutationDeleteBlobArgs {
  key: Scalars['String']['input'];
  permanently?: InputMaybe<Scalars['Boolean']['input']>;
  workspaceId: Scalars['String']['input'];
}

export interface MutationDeleteCommentArgs {
  id: Scalars['String']['input'];
}

export interface MutationDeleteDocMetaArgs {
  docId: Scalars['String']['input'];
  workspaceId: Scalars['String']['input'];
}

export interface MutationDeleteReplyArgs {
  id: Scalars['String']['input'];
}

export interface MutationDeleteWorkspaceArgs {
  id: Scalars['String']['input'];
}

export interface MutationGrantDocUserRolesArgs {
  input: GrantDocUserRolesInput;
}

export interface MutationGrantMemberArgs {
  permission: Permission;
  userId: Scalars['String']['input'];
  workspaceId: Scalars['String']['input'];
}

export interface MutationInviteMembersArgs {
  emails: Array<Scalars['String']['input']>;
  workspaceId: Scalars['String']['input'];
}

export interface MutationLeaveWorkspaceArgs {
  sendLeaveMail?: InputMaybe<Scalars['Boolean']['input']>;
  workspaceId: Scalars['String']['input'];
}

export interface MutationMentionUserArgs {
  input: MentionInput;
}

export interface MutationPublishPageArgs {
  mode?: InputMaybe<Scalars['String']['input']>;
  pageId: Scalars['String']['input'];
  workspaceId: Scalars['String']['input'];
}

export interface MutationReadNotificationArgs {
  id: Scalars['String']['input'];
}

export interface MutationRecoverDocArgs {
  guid: Scalars['String']['input'];
  timestamp: Scalars['DateTime']['input'];
  workspaceId: Scalars['String']['input'];
}

export interface MutationReindexWorkspaceArgs {
  workspaceId: Scalars['String']['input'];
}

export interface MutationReleaseDeletedBlobsArgs {
  workspaceId: Scalars['String']['input'];
}

export interface MutationResolveCommentArgs {
  input: CommentResolveInput;
}

export interface MutationRevokeDocUserRolesArgs {
  input: RevokeDocUserRoleInput;
}

export interface MutationRevokeInviteLinkArgs {
  workspaceId: Scalars['String']['input'];
}

export interface MutationRevokeMemberArgs {
  userId: Scalars['String']['input'];
  workspaceId: Scalars['String']['input'];
}

export interface MutationRevokePublicPageArgs {
  pageId: Scalars['String']['input'];
  workspaceId: Scalars['String']['input'];
}

export interface MutationSendChangeEmailArgs {
  callbackUrl: Scalars['String']['input'];
}

export interface MutationSendTestEmailArgs {
  config: Scalars['JSON']['input'];
}

export interface MutationSendVerifyChangeEmailArgs {
  callbackUrl: Scalars['String']['input'];
  email: Scalars['String']['input'];
  token: Scalars['String']['input'];
}

export interface MutationSendVerifyEmailArgs {
  callbackUrl: Scalars['String']['input'];
}

export interface MutationSetBlobArgs {
  blob: Scalars['Upload']['input'];
  workspaceId: Scalars['String']['input'];
}

export interface MutationSetDocTitleArgs {
  baseRevision: Scalars['String']['input'];
  docId: Scalars['String']['input'];
  observedTitle?: InputMaybe<Scalars['String']['input']>;
  title: Scalars['String']['input'];
  workspaceId: Scalars['String']['input'];
}

export interface MutationSetDocTrashArgs {
  baseRevision: Scalars['String']['input'];
  docId: Scalars['String']['input'];
  observedTrash?: InputMaybe<Scalars['Boolean']['input']>;
  trash: Scalars['Boolean']['input'];
  workspaceId: Scalars['String']['input'];
}

export interface MutationTestOidcConnectionArgs {
  issuer: Scalars['String']['input'];
}

export interface MutationUpdateCommentArgs {
  input: CommentUpdateInput;
}

export interface MutationUpdateDocDefaultRoleArgs {
  input: UpdateDocDefaultRoleInput;
}

export interface MutationUpdateDocUserRoleArgs {
  input: UpdateDocUserRoleInput;
}

export interface MutationUpdateOidcConfigArgs {
  input: UpdateOidcConfigInput;
}

export interface MutationUpdateProfileArgs {
  input: UpdateUserInput;
}

export interface MutationUpdateReplyArgs {
  input: ReplyUpdateInput;
}

export interface MutationUpdateSettingsArgs {
  input: UpdateUserSettingsInput;
}

export interface MutationUploadAvatarArgs {
  avatar: Scalars['Upload']['input'];
}

export interface MutationUploadCommentAttachmentArgs {
  attachment: Scalars['Upload']['input'];
  docId: Scalars['String']['input'];
  workspaceId: Scalars['String']['input'];
}

export interface MutationVerifyEmailArgs {
  token: Scalars['String']['input'];
}

export interface NotificationEdge {
  __typename?: 'NotificationEdge';
  cursor: Scalars['String']['output'];
  node: NotificationObjectType;
}

export interface NotificationObjectType {
  __typename?: 'NotificationObjectType';
  body: Maybe<Scalars['JSON']['output']>;
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  level: Scalars['String']['output'];
  read: Scalars['Boolean']['output'];
  type: NotificationType;
  updatedAt: Scalars['DateTime']['output'];
}

export enum NotificationType {
  Comment = 'Comment',
  CommentMention = 'CommentMention',
  Invitation = 'Invitation',
  InvitationAccepted = 'InvitationAccepted',
  InvitationBlocked = 'InvitationBlocked',
  InvitationRejected = 'InvitationRejected',
  InvitationReviewApproved = 'InvitationReviewApproved',
  InvitationReviewDeclined = 'InvitationReviewDeclined',
  InvitationReviewRequest = 'InvitationReviewRequest',
  Mention = 'Mention',
}

export enum OAuthProviderType {
  Apple = 'Apple',
  GitHub = 'GitHub',
  Google = 'Google',
  OIDC = 'OIDC',
}

export interface OidcConfigType {
  __typename?: 'OidcConfigType';
  autoCreateUser: Scalars['Boolean']['output'];
  buttonLabel: Scalars['String']['output'];
  clientId: Scalars['String']['output'];
  clientSecretSet: Scalars['Boolean']['output'];
  emailClaims: Scalars['String']['output'];
  enabled: Scalars['Boolean']['output'];
  issuer: Scalars['String']['output'];
  redirectUri: Scalars['String']['output'];
}

export interface OidcTestResultType {
  __typename?: 'OidcTestResultType';
  authorizationEndpoint: Maybe<Scalars['String']['output']>;
  issuer: Maybe<Scalars['String']['output']>;
  message: Scalars['String']['output'];
  ok: Scalars['Boolean']['output'];
  tokenEndpoint: Maybe<Scalars['String']['output']>;
}

export interface PageInfo {
  __typename?: 'PageInfo';
  endCursor: Maybe<Scalars['String']['output']>;
  hasNextPage: Scalars['Boolean']['output'];
  hasPreviousPage: Scalars['Boolean']['output'];
  startCursor: Maybe<Scalars['String']['output']>;
}

export interface PaginatedCommentChangeObjectType {
  __typename?: 'PaginatedCommentChangeObjectType';
  edges: Array<CommentChangeEdge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
}

export interface PaginatedCommentObjectType {
  __typename?: 'PaginatedCommentObjectType';
  edges: Array<CommentEdge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
}

export interface PaginatedGrantedDocUserType {
  __typename?: 'PaginatedGrantedDocUserType';
  edges: Array<GrantedDocUserEdge>;
  pageInfo: GrantedDocUserPageInfo;
  totalCount: Scalars['Int']['output'];
}

export interface PaginatedNotificationObjectType {
  __typename?: 'PaginatedNotificationObjectType';
  edges: Array<NotificationEdge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
}

export interface PaginationInput {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
}

export interface PasswordLimitsType {
  __typename?: 'PasswordLimitsType';
  maxLength: Scalars['Float']['output'];
  minLength: Scalars['Float']['output'];
}

export enum Permission {
  Admin = 'Admin',
  Owner = 'Owner',
  Read = 'Read',
  Write = 'Write',
}

export interface PublicUserType {
  __typename?: 'PublicUserType';
  avatarUrl: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
}

export interface Query {
  __typename?: 'Query';
  adminAuditLogs: AuditLogList;
  adminAuditLogsCsv: Scalars['String']['output'];
  adminBackupList: BackupRecordList;
  adminServerSettings: Array<ServerSettingType>;
  adminUserList: AdminUserList;
  currentUser: Maybe<UserType>;
  discoveryRevision: Scalars['String']['output'];
  discoverySnapshot: DiscoverySnapshot;
  getInviteInfo: InvitationType;
  isPasswordTokenValid: Scalars['Boolean']['output'];
  listBlobs: Array<ListedBlob>;
  listHistory: Array<DocHistoryType>;
  oidcConfig: OidcConfigType;
  publicUserById: Maybe<UserType>;
  serverConfig: ServerConfigType;
  workspace: WorkspaceType;
  workspaceDocs: Array<WorkspaceDocListItem>;
  workspaceRole: Maybe<Scalars['String']['output']>;
  workspaces: Array<WorkspaceType>;
}

export interface QueryAdminAuditLogsArgs {
  action?: InputMaybe<Scalars['String']['input']>;
  actor?: InputMaybe<Scalars['String']['input']>;
  from?: InputMaybe<Scalars['String']['input']>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  take?: InputMaybe<Scalars['Int']['input']>;
  to?: InputMaybe<Scalars['String']['input']>;
}

export interface QueryAdminAuditLogsCsvArgs {
  action?: InputMaybe<Scalars['String']['input']>;
  actor?: InputMaybe<Scalars['String']['input']>;
  from?: InputMaybe<Scalars['String']['input']>;
  to?: InputMaybe<Scalars['String']['input']>;
}

export interface QueryAdminBackupListArgs {
  skip?: InputMaybe<Scalars['Int']['input']>;
  take?: InputMaybe<Scalars['Int']['input']>;
}

export interface QueryAdminUserListArgs {
  search?: InputMaybe<Scalars['String']['input']>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  take?: InputMaybe<Scalars['Int']['input']>;
}

export interface QueryDiscoveryRevisionArgs {
  workspaceId: Scalars['String']['input'];
}

export interface QueryDiscoverySnapshotArgs {
  workspaceId: Scalars['String']['input'];
}

export interface QueryGetInviteInfoArgs {
  inviteId: Scalars['String']['input'];
}

export interface QueryIsPasswordTokenValidArgs {
  token: Scalars['String']['input'];
}

export interface QueryListBlobsArgs {
  workspaceId: Scalars['String']['input'];
}

export interface QueryListHistoryArgs {
  docId: Scalars['String']['input'];
  take?: InputMaybe<Scalars['Int']['input']>;
  workspaceId: Scalars['String']['input'];
}

export interface QueryPublicUserByIdArgs {
  id: Scalars['String']['input'];
}

export interface QueryWorkspaceArgs {
  id: Scalars['String']['input'];
}

export interface QueryWorkspaceDocsArgs {
  workspaceId: Scalars['String']['input'];
}

export interface QueryWorkspaceRoleArgs {
  workspaceId: Scalars['ID']['input'];
}

export interface RemoveAvatarResult {
  __typename?: 'RemoveAvatarResult';
  success: Scalars['Boolean']['output'];
}

export interface ReplyCreateInput {
  commentId: Scalars['ID']['input'];
  content: Scalars['JSON']['input'];
  docMode: Scalars['String']['input'];
  docTitle: Scalars['String']['input'];
  mentions?: InputMaybe<Array<Scalars['String']['input']>>;
}

export interface ReplyObjectType {
  __typename?: 'ReplyObjectType';
  commentId: Scalars['ID']['output'];
  content: Scalars['JSON']['output'];
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  updatedAt: Scalars['DateTime']['output'];
  user: PublicUserType;
}

export interface ReplyUpdateInput {
  content: Scalars['JSON']['input'];
  id: Scalars['ID']['input'];
}

export interface RevealedAccessToken {
  __typename?: 'RevealedAccessToken';
  createdAt: Scalars['DateTime']['output'];
  expiresAt: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
  token: Scalars['String']['output'];
}

export interface RevokeDocUserRoleInput {
  docId: Scalars['String']['input'];
  userId: Scalars['String']['input'];
  workspaceId: Scalars['String']['input'];
}

export interface SearchDocObjectType {
  __typename?: 'SearchDocObjectType';
  blockId: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  createdByUser: Maybe<PublicUserType>;
  docId: Scalars['String']['output'];
  highlight: Scalars['String']['output'];
  title: Scalars['String']['output'];
  updatedAt: Scalars['String']['output'];
  updatedByUser: Maybe<PublicUserType>;
}

export interface SearchDocsInput {
  keyword: Scalars['String']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
}

export interface SearchHighlight {
  before: Scalars['String']['input'];
  end: Scalars['String']['input'];
  field: Scalars['String']['input'];
}

export interface SearchInput {
  options: SearchOptions;
  query: SearchQuery;
  table: SearchTable;
}

export interface SearchNodeObjectType {
  __typename?: 'SearchNodeObjectType';
  fields: Scalars['JSON']['output'];
  highlights: Maybe<Scalars['JSON']['output']>;
}

export interface SearchOptions {
  fields: Array<Scalars['String']['input']>;
  highlights?: InputMaybe<Array<SearchHighlight>>;
  pagination?: InputMaybe<SearchPagination>;
}

export interface SearchPagination {
  cursor?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  skip?: InputMaybe<Scalars['Int']['input']>;
}

export interface SearchQuery {
  boost?: InputMaybe<Scalars['Float']['input']>;
  field?: InputMaybe<Scalars['String']['input']>;
  match?: InputMaybe<Scalars['String']['input']>;
  occur?: InputMaybe<SearchQueryOccur>;
  queries?: InputMaybe<Array<SearchQuery>>;
  query?: InputMaybe<SearchQuery>;
  type: SearchQueryType;
}

/** Search query occur */
export enum SearchQueryOccur {
  must = 'must',
  must_not = 'must_not',
  should = 'should',
}

/** Search query type */
export enum SearchQueryType {
  all = 'all',
  boolean = 'boolean',
  boost = 'boost',
  exists = 'exists',
  match = 'match',
}

export interface SearchResultObjectType {
  __typename?: 'SearchResultObjectType';
  nodes: Array<SearchNodeObjectType>;
  pagination: SearchResultPagination;
}

export interface SearchResultPagination {
  __typename?: 'SearchResultPagination';
  count: Scalars['Int']['output'];
  hasMore: Scalars['Boolean']['output'];
  nextCursor: Maybe<Scalars['String']['output']>;
}

/** Search table */
export enum SearchTable {
  block = 'block',
  doc = 'doc',
}

export interface ServerConfigType {
  __typename?: 'ServerConfigType';
  appVersion: Scalars['String']['output'];
  baseUrl: Scalars['String']['output'];
  calendarCalDAVProviders: Array<Scalars['String']['output']>;
  calendarProviders: Array<Scalars['String']['output']>;
  credentialsRequirement: CredentialsRequirementType;
  defaultLanguage: Maybe<Scalars['String']['output']>;
  features: Array<ServerFeature>;
  initialized: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  oauthProviders: Array<OAuthProviderType>;
  oidcButtonLabel: Maybe<Scalars['String']['output']>;
  registrationOpen: Scalars['Boolean']['output'];
  type: ServerDeploymentType;
  version: Scalars['String']['output'];
}

export enum ServerDeploymentType {
  Affine = 'Affine',
  Selfhosted = 'Selfhosted',
}

export enum ServerFeature {
  Captcha = 'Captcha',
  Comment = 'Comment',
  Copilot = 'Copilot',
  CopilotEmbedding = 'CopilotEmbedding',
  Email = 'Email',
  Indexer = 'Indexer',
  LocalWorkspace = 'LocalWorkspace',
  OAuth = 'OAuth',
  Payment = 'Payment',
}

export interface ServerSettingType {
  __typename?: 'ServerSettingType';
  key: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
  value: Scalars['String']['output'];
}

export interface TokenType {
  __typename?: 'TokenType';
  sessionToken: Maybe<Scalars['String']['output']>;
}

export interface UpdateDocDefaultRoleInput {
  docId: Scalars['String']['input'];
  role: DocRole;
  workspaceId: Scalars['String']['input'];
}

export interface UpdateDocUserRoleInput {
  docId: Scalars['String']['input'];
  role: DocRole;
  userId: Scalars['String']['input'];
  workspaceId: Scalars['String']['input'];
}

export interface UpdateOidcConfigInput {
  autoCreateUser?: InputMaybe<Scalars['Boolean']['input']>;
  buttonLabel?: InputMaybe<Scalars['String']['input']>;
  clientId?: InputMaybe<Scalars['String']['input']>;
  clientSecret?: InputMaybe<Scalars['String']['input']>;
  emailClaims?: InputMaybe<Scalars['String']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  issuer?: InputMaybe<Scalars['String']['input']>;
}

export interface UpdateUserInput {
  name?: InputMaybe<Scalars['String']['input']>;
}

export interface UpdateUserSettingsInput {
  receiveCommentEmail?: InputMaybe<Scalars['Boolean']['input']>;
  receiveInvitationEmail?: InputMaybe<Scalars['Boolean']['input']>;
  receiveMentionEmail?: InputMaybe<Scalars['Boolean']['input']>;
}

export interface UserCopilot {
  __typename?: 'UserCopilot';
  chats: Maybe<Array<Scalars['String']['output']>>;
  quota: Maybe<CopilotQuotaDetail>;
}

export interface UserQuota {
  __typename?: 'UserQuota';
  blobLimit: Scalars['Float']['output'];
  historyPeriod: Scalars['Float']['output'];
  humanReadable: UserQuotaHumanReadable;
  memberLimit: Scalars['Float']['output'];
  name: Scalars['String']['output'];
  storageQuota: Scalars['Float']['output'];
}

export interface UserQuotaHumanReadable {
  __typename?: 'UserQuotaHumanReadable';
  blobLimit: Scalars['String']['output'];
  historyPeriod: Scalars['String']['output'];
  memberLimit: Scalars['String']['output'];
  name: Scalars['String']['output'];
  storageQuota: Scalars['String']['output'];
}

export interface UserQuotaUsage {
  __typename?: 'UserQuotaUsage';
  storageQuota: Scalars['Float']['output'];
}

export interface UserSettings {
  __typename?: 'UserSettings';
  receiveCommentEmail: Scalars['Boolean']['output'];
  receiveInvitationEmail: Scalars['Boolean']['output'];
  receiveMentionEmail: Scalars['Boolean']['output'];
}

export interface UserType {
  __typename?: 'UserType';
  avatarUrl: Maybe<Scalars['String']['output']>;
  calendarAccounts: Array<Scalars['String']['output']>;
  copilot: Maybe<UserCopilot>;
  createdAt: Scalars['DateTime']['output'];
  email: Scalars['String']['output'];
  emailVerified: Scalars['Boolean']['output'];
  features: Maybe<Array<FeatureType>>;
  hasPassword: Maybe<Scalars['Boolean']['output']>;
  id: Scalars['ID']['output'];
  name: Maybe<Scalars['String']['output']>;
  notificationCount: Maybe<Scalars['Int']['output']>;
  notifications: Maybe<PaginatedNotificationObjectType>;
  quota: Maybe<UserQuota>;
  quotaUsage: Maybe<UserQuotaUsage>;
  revealedAccessTokens: Array<RevealedAccessToken>;
  settings: Maybe<UserSettings>;
  token: Maybe<TokenType>;
}

export interface UserTypeCopilotArgs {
  workspaceId?: InputMaybe<Scalars['String']['input']>;
}

export interface UserTypeNotificationsArgs {
  pagination?: InputMaybe<PaginationInput>;
}

export interface WorkspaceDocHistoryType {
  __typename?: 'WorkspaceDocHistoryType';
  editor: Maybe<DocHistoryEditorType>;
  id: Scalars['String']['output'];
  timestamp: Scalars['DateTime']['output'];
}

export interface WorkspaceDocListItem {
  __typename?: 'WorkspaceDocListItem';
  createdAt: Scalars['DateTime']['output'];
  docId: Scalars['String']['output'];
  mode: Scalars['String']['output'];
  public: Scalars['Boolean']['output'];
  title: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['DateTime']['output'];
  workspaceId: Scalars['String']['output'];
}

export enum WorkspaceInviteLinkExpireTime {
  OneDay = 'OneDay',
  OneMonth = 'OneMonth',
  OneWeek = 'OneWeek',
  ThreeDays = 'ThreeDays',
}

export enum WorkspaceMemberStatus {
  Accepted = 'Accepted',
  AllocatingSeat = 'AllocatingSeat',
  NeedMoreSeat = 'NeedMoreSeat',
  NeedMoreSeatAndReview = 'NeedMoreSeatAndReview',
  Pending = 'Pending',
  UnderReview = 'UnderReview',
}

export interface WorkspaceOwnerType {
  __typename?: 'WorkspaceOwnerType';
  id: Scalars['ID']['output'];
}

export interface WorkspacePage {
  __typename?: 'WorkspacePage';
  id: Scalars['String']['output'];
  mode: Scalars['String']['output'];
  public: Scalars['Boolean']['output'];
  workspaceId: Scalars['String']['output'];
}

export interface WorkspacePermissionsType {
  __typename?: 'WorkspacePermissionsType';
  Workspace_Administrators_Manage: Scalars['Boolean']['output'];
  Workspace_Blobs_List: Scalars['Boolean']['output'];
  Workspace_Blobs_Read: Scalars['Boolean']['output'];
  Workspace_Blobs_Write: Scalars['Boolean']['output'];
  Workspace_Copilot: Scalars['Boolean']['output'];
  Workspace_CreateDoc: Scalars['Boolean']['output'];
  Workspace_Delete: Scalars['Boolean']['output'];
  Workspace_Organize_Read: Scalars['Boolean']['output'];
  Workspace_Payment_Manage: Scalars['Boolean']['output'];
  Workspace_Properties_Create: Scalars['Boolean']['output'];
  Workspace_Properties_Delete: Scalars['Boolean']['output'];
  Workspace_Properties_Read: Scalars['Boolean']['output'];
  Workspace_Properties_Update: Scalars['Boolean']['output'];
  Workspace_Read: Scalars['Boolean']['output'];
  Workspace_Settings_Read: Scalars['Boolean']['output'];
  Workspace_Settings_Update: Scalars['Boolean']['output'];
  Workspace_Sync: Scalars['Boolean']['output'];
  Workspace_TransferOwner: Scalars['Boolean']['output'];
  Workspace_Users_Manage: Scalars['Boolean']['output'];
  Workspace_Users_Read: Scalars['Boolean']['output'];
}

export interface WorkspaceQuotaType {
  __typename?: 'WorkspaceQuotaType';
  blobLimit: Scalars['Float']['output'];
  historyPeriod: Scalars['Float']['output'];
  humanReadable: HumanReadableQuotaType;
  memberCount: Scalars['Int']['output'];
  memberLimit: Scalars['Float']['output'];
  name: Scalars['String']['output'];
  overcapacityMemberCount: Scalars['Int']['output'];
  storageQuota: Scalars['Float']['output'];
  usedSize: Scalars['Int']['output'];
  usedStorageQuota: Scalars['Int']['output'];
}

export interface WorkspaceType {
  __typename?: 'WorkspaceType';
  aggregate: AggregateResultObjectType;
  avatar: Maybe<Scalars['String']['output']>;
  blobs: Array<ListedBlob>;
  commentChanges: PaginatedCommentChangeObjectType;
  comments: PaginatedCommentObjectType;
  createdAt: Scalars['DateTime']['output'];
  doc: Maybe<DocType>;
  enableAi: Scalars['Boolean']['output'];
  enableDocEmbedding: Scalars['Boolean']['output'];
  enableSharing: Scalars['Boolean']['output'];
  enableUrlPreview: Scalars['Boolean']['output'];
  histories: Array<WorkspaceDocHistoryType>;
  id: Scalars['ID']['output'];
  initialized: Scalars['Boolean']['output'];
  inviteLink: Maybe<InviteLink>;
  isOwner: Scalars['Boolean']['output'];
  memberCount: Scalars['Int']['output'];
  members: Array<InviteUserType>;
  name: Maybe<Scalars['String']['output']>;
  owner: WorkspaceOwnerType;
  permission: Permission;
  permissions: Maybe<WorkspacePermissionsType>;
  public: Scalars['Boolean']['output'];
  publicDocs: Array<DocType>;
  quota: Maybe<WorkspaceQuotaType>;
  role: Scalars['String']['output'];
  search: SearchResultObjectType;
  searchDocs: Array<SearchDocObjectType>;
  team: Scalars['Boolean']['output'];
}

export interface WorkspaceTypeAggregateArgs {
  input: AggregateInput;
}

export interface WorkspaceTypeCommentChangesArgs {
  docId: Scalars['String']['input'];
  pagination: PaginationInput;
}

export interface WorkspaceTypeCommentsArgs {
  docId: Scalars['String']['input'];
  pagination?: InputMaybe<PaginationInput>;
}

export interface WorkspaceTypeDocArgs {
  docId: Scalars['String']['input'];
}

export interface WorkspaceTypeHistoriesArgs {
  before?: InputMaybe<Scalars['DateTime']['input']>;
  guid: Scalars['String']['input'];
  take?: InputMaybe<Scalars['Int']['input']>;
}

export interface WorkspaceTypeMembersArgs {
  query?: InputMaybe<Scalars['String']['input']>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  take?: InputMaybe<Scalars['Int']['input']>;
}

export interface WorkspaceTypeSearchArgs {
  input: SearchInput;
}

export interface WorkspaceTypeSearchDocsArgs {
  input: SearchDocsInput;
}

export interface WorkspaceUserType {
  __typename?: 'WorkspaceUserType';
  avatarUrl: Maybe<Scalars['String']['output']>;
  email: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  name: Maybe<Scalars['String']['output']>;
}

export type AdminBackupListQueryVariables = Exact<{
  skip?: InputMaybe<Scalars['Int']['input']>;
  take?: InputMaybe<Scalars['Int']['input']>;
}>;

export type AdminBackupListQuery = {
  __typename?: 'Query';
  adminBackupList: {
    __typename?: 'BackupRecordList';
    totalCount: number;
    items: Array<{
      __typename?: 'BackupRecordType';
      id: string;
      filename: string;
      size: string;
      workspaceCount: number;
      docCount: number;
      blobCount: number;
      status: string;
      createdAt: string;
    }>;
  };
};

export type AdminCreateBackupMutationVariables = Exact<{
  [key: string]: never;
}>;

export type AdminCreateBackupMutation = {
  __typename?: 'Mutation';
  adminCreateBackup: {
    __typename?: 'BackupRecordType';
    id: string;
    filename: string;
    size: string;
    workspaceCount: number;
    docCount: number;
    blobCount: number;
    status: string;
    createdAt: string;
  };
};

export type AdminCreateUserMutationVariables = Exact<{
  input: AdminCreateUserInput;
}>;

export type AdminCreateUserMutation = {
  __typename?: 'Mutation';
  adminCreateUser: {
    __typename?: 'AdminUserItem';
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
    isAdmin: boolean;
    emailVerified: boolean;
    createdAt: string;
  };
};

export type AdminDeleteBackupMutationVariables = Exact<{
  id: Scalars['String']['input'];
}>;

export type AdminDeleteBackupMutation = {
  __typename?: 'Mutation';
  adminDeleteBackup: boolean;
};

export type AdminDeleteUserMutationVariables = Exact<{
  userId: Scalars['String']['input'];
}>;

export type AdminDeleteUserMutation = {
  __typename?: 'Mutation';
  adminDeleteUser: boolean;
};

export type AdminServerSettingsQueryVariables = Exact<{ [key: string]: never }>;

export type AdminServerSettingsQuery = {
  __typename?: 'Query';
  adminServerSettings: Array<{
    __typename?: 'ServerSettingType';
    key: string;
    value: string;
    updatedAt: string;
  }>;
};

export type AdminSetUserAdminMutationVariables = Exact<{
  userId: Scalars['String']['input'];
  isAdmin: Scalars['Boolean']['input'];
}>;

export type AdminSetUserAdminMutation = {
  __typename?: 'Mutation';
  adminSetUserAdmin: {
    __typename?: 'AdminUserItem';
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
    isAdmin: boolean;
    emailVerified: boolean;
    createdAt: string;
  };
};

export type AdminUpdateServerSettingMutationVariables = Exact<{
  key: Scalars['String']['input'];
  value: Scalars['String']['input'];
}>;

export type AdminUpdateServerSettingMutation = {
  __typename?: 'Mutation';
  adminUpdateServerSetting: {
    __typename?: 'ServerSettingType';
    key: string;
    value: string;
    updatedAt: string;
  };
};

export type AdminUserListQueryVariables = Exact<{
  search?: InputMaybe<Scalars['String']['input']>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  take?: InputMaybe<Scalars['Int']['input']>;
}>;

export type AdminUserListQuery = {
  __typename?: 'Query';
  adminUserList: {
    __typename?: 'AdminUserList';
    totalCount: number;
    items: Array<{
      __typename?: 'AdminUserItem';
      id: string;
      email: string;
      name: string | null;
      avatarUrl: string | null;
      isAdmin: boolean;
      emailVerified: boolean;
      createdAt: string;
    }>;
  };
};

export type AdminAuditLogsQueryVariables = Exact<{
  actor?: InputMaybe<Scalars['String']['input']>;
  action?: InputMaybe<Scalars['String']['input']>;
  from?: InputMaybe<Scalars['String']['input']>;
  to?: InputMaybe<Scalars['String']['input']>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  take?: InputMaybe<Scalars['Int']['input']>;
}>;

export type AdminAuditLogsQuery = {
  __typename?: 'Query';
  adminAuditLogs: {
    __typename?: 'AuditLogList';
    totalCount: number;
    items: Array<{
      __typename?: 'AuditLogItem';
      id: string;
      createdAt: string;
      action: string;
      actorEmail: string;
      actorName: string | null;
      targetType: string | null;
      targetId: string | null;
      targetName: string | null;
      ip: string | null;
      detail: any | null;
    }>;
  };
};

export type AdminAuditLogsCsvQueryVariables = Exact<{
  actor?: InputMaybe<Scalars['String']['input']>;
  action?: InputMaybe<Scalars['String']['input']>;
  from?: InputMaybe<Scalars['String']['input']>;
  to?: InputMaybe<Scalars['String']['input']>;
}>;

export type AdminAuditLogsCsvQuery = {
  __typename?: 'Query';
  adminAuditLogsCsv: string;
};

export type CreateChangePasswordUrlMutationVariables = Exact<{
  callbackUrl: Scalars['String']['input'];
  userId: Scalars['String']['input'];
}>;

export type CreateChangePasswordUrlMutation = {
  __typename?: 'Mutation';
  createChangePasswordUrl: string;
};

export type AdminValidateUserCsvMutationVariables = Exact<{
  csv: Scalars['String']['input'];
}>;

export type AdminValidateUserCsvMutation = {
  __typename?: 'Mutation';
  adminValidateUserCsv: {
    __typename?: 'CsvImportResult';
    okCount: number;
    ngCount: number;
    rows: Array<{
      __typename?: 'CsvUserRowResult';
      line: number;
      email: string;
      name: string | null;
      ok: boolean;
      error: string | null;
    }>;
  };
};

export type AdminImportUsersMutationVariables = Exact<{
  csv: Scalars['String']['input'];
}>;

export type AdminImportUsersMutation = {
  __typename?: 'Mutation';
  adminImportUsers: {
    __typename?: 'CsvImportResult';
    okCount: number;
    ngCount: number;
    rows: Array<{
      __typename?: 'CsvUserRowResult';
      line: number;
      email: string;
      name: string | null;
      ok: boolean;
      error: string | null;
    }>;
  };
};

export type SendTestEmailMutationVariables = Exact<{
  host: Scalars['String']['input'];
  port: Scalars['Int']['input'];
  sender: Scalars['String']['input'];
  username: Scalars['String']['input'];
  password: Scalars['String']['input'];
  ignoreTLS: Scalars['Boolean']['input'];
}>;

export type SendTestEmailMutation = {
  __typename?: 'Mutation';
  sendTestEmail: boolean;
};

export type AdminSetUserPasswordMutationVariables = Exact<{
  userId: Scalars['String']['input'];
  password: Scalars['String']['input'];
}>;

export type AdminSetUserPasswordMutation = {
  __typename?: 'Mutation';
  adminSetUserPassword: boolean;
};

export type DeleteBlobMutationVariables = Exact<{
  workspaceId: Scalars['String']['input'];
  key: Scalars['String']['input'];
  permanently?: InputMaybe<Scalars['Boolean']['input']>;
}>;

export type DeleteBlobMutation = {
  __typename?: 'Mutation';
  deleteBlob: boolean;
};

export type ListBlobsQueryVariables = Exact<{
  workspaceId: Scalars['String']['input'];
}>;

export type ListBlobsQuery = {
  __typename?: 'Query';
  workspace: {
    __typename?: 'WorkspaceType';
    blobs: Array<{
      __typename?: 'ListedBlob';
      key: string;
      size: number;
      mime: string;
      createdAt: string;
    }>;
  };
};

export type ReleaseDeletedBlobsMutationVariables = Exact<{
  workspaceId: Scalars['String']['input'];
}>;

export type ReleaseDeletedBlobsMutation = {
  __typename?: 'Mutation';
  releaseDeletedBlobs: boolean;
};

export type SetBlobMutationVariables = Exact<{
  workspaceId: Scalars['String']['input'];
  blob: Scalars['Upload']['input'];
}>;

export type SetBlobMutation = { __typename?: 'Mutation'; setBlob: string };

export type CreateBlobUploadMutationVariables = Exact<{
  workspaceId: Scalars['String']['input'];
  key: Scalars['String']['input'];
  size: Scalars['Int']['input'];
  mime: Scalars['String']['input'];
}>;

export type CreateBlobUploadMutation = {
  __typename?: 'Mutation';
  createBlobUpload: {
    __typename?: 'BlobUploadInit';
    method: BlobUploadMethod;
    blobKey: string;
    alreadyUploaded: boolean | null;
    uploadUrl: string | null;
    headers: any | null;
    expiresAt: string | null;
    uploadId: string | null;
    partSize: number | null;
    uploadedParts: Array<{
      __typename?: 'BlobUploadedPart';
      partNumber: number;
      etag: string;
    }> | null;
  };
};

export type ChangeEmailMutationVariables = Exact<{
  token: Scalars['String']['input'];
  email: Scalars['String']['input'];
}>;

export type ChangeEmailMutation = {
  __typename?: 'Mutation';
  changeEmail: { __typename?: 'UserType'; id: string; email: string };
};

export type ChangeMyPasswordMutationVariables = Exact<{
  currentPassword: Scalars['String']['input'];
  newPassword: Scalars['String']['input'];
}>;

export type ChangeMyPasswordMutation = {
  __typename?: 'Mutation';
  changeMyPassword: boolean;
};

export type ChangePasswordMutationVariables = Exact<{
  token: Scalars['String']['input'];
  userId: Scalars['String']['input'];
  newPassword: Scalars['String']['input'];
}>;

export type ChangePasswordMutation = {
  __typename?: 'Mutation';
  changePassword: boolean;
};

export type ListCommentChangesQueryVariables = Exact<{
  workspaceId: Scalars['String']['input'];
  docId: Scalars['String']['input'];
  pagination: PaginationInput;
}>;

export type ListCommentChangesQuery = {
  __typename?: 'Query';
  workspace: {
    __typename?: 'WorkspaceType';
    commentChanges: {
      __typename?: 'PaginatedCommentChangeObjectType';
      totalCount: number;
      edges: Array<{
        __typename?: 'CommentChangeEdge';
        cursor: string;
        node: {
          __typename?: 'CommentChangeObjectType';
          action: CommentChangeAction;
          id: string;
          commentId: string | null;
          item: any;
        };
      }>;
      pageInfo: {
        __typename?: 'PageInfo';
        startCursor: string | null;
        endCursor: string | null;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
      };
    };
  };
};

export type CreateCommentMutationVariables = Exact<{
  input: CommentCreateInput;
}>;

export type CreateCommentMutation = {
  __typename?: 'Mutation';
  createComment: {
    __typename?: 'CommentObjectType';
    id: string;
    content: any;
    resolved: boolean;
    createdAt: string;
    updatedAt: string;
    user: {
      __typename?: 'PublicUserType';
      id: string;
      name: string;
      avatarUrl: string | null;
    };
    replies: Array<{
      __typename?: 'ReplyObjectType';
      commentId: string;
      id: string;
      content: any;
      createdAt: string;
      updatedAt: string;
      user: {
        __typename?: 'PublicUserType';
        id: string;
        name: string;
        avatarUrl: string | null;
      };
    }>;
  };
};

export type DeleteCommentMutationVariables = Exact<{
  id: Scalars['String']['input'];
}>;

export type DeleteCommentMutation = {
  __typename?: 'Mutation';
  deleteComment: boolean;
};

export type ListCommentsQueryVariables = Exact<{
  workspaceId: Scalars['String']['input'];
  docId: Scalars['String']['input'];
  pagination?: InputMaybe<PaginationInput>;
}>;

export type ListCommentsQuery = {
  __typename?: 'Query';
  workspace: {
    __typename?: 'WorkspaceType';
    comments: {
      __typename?: 'PaginatedCommentObjectType';
      totalCount: number;
      edges: Array<{
        __typename?: 'CommentEdge';
        cursor: string;
        node: {
          __typename?: 'CommentObjectType';
          id: string;
          content: any;
          resolved: boolean;
          createdAt: string;
          updatedAt: string;
          user: {
            __typename?: 'PublicUserType';
            id: string;
            name: string;
            avatarUrl: string | null;
          };
          replies: Array<{
            __typename?: 'ReplyObjectType';
            commentId: string;
            id: string;
            content: any;
            createdAt: string;
            updatedAt: string;
            user: {
              __typename?: 'PublicUserType';
              id: string;
              name: string;
              avatarUrl: string | null;
            };
          }>;
        };
      }>;
      pageInfo: {
        __typename?: 'PageInfo';
        startCursor: string | null;
        endCursor: string | null;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
      };
    };
  };
};

export type CreateReplyMutationVariables = Exact<{
  input: ReplyCreateInput;
}>;

export type CreateReplyMutation = {
  __typename?: 'Mutation';
  createReply: {
    __typename?: 'ReplyObjectType';
    commentId: string;
    id: string;
    content: any;
    createdAt: string;
    updatedAt: string;
    user: {
      __typename?: 'PublicUserType';
      id: string;
      name: string;
      avatarUrl: string | null;
    };
  };
};

export type DeleteReplyMutationVariables = Exact<{
  id: Scalars['String']['input'];
}>;

export type DeleteReplyMutation = {
  __typename?: 'Mutation';
  deleteReply: boolean;
};

export type UpdateReplyMutationVariables = Exact<{
  input: ReplyUpdateInput;
}>;

export type UpdateReplyMutation = {
  __typename?: 'Mutation';
  updateReply: boolean;
};

export type ResolveCommentMutationVariables = Exact<{
  input: CommentResolveInput;
}>;

export type ResolveCommentMutation = {
  __typename?: 'Mutation';
  resolveComment: boolean;
};

export type UpdateCommentMutationVariables = Exact<{
  input: CommentUpdateInput;
}>;

export type UpdateCommentMutation = {
  __typename?: 'Mutation';
  updateComment: boolean;
};

export type UploadCommentAttachmentMutationVariables = Exact<{
  workspaceId: Scalars['String']['input'];
  docId: Scalars['String']['input'];
  attachment: Scalars['Upload']['input'];
}>;

export type UploadCommentAttachmentMutation = {
  __typename?: 'Mutation';
  uploadCommentAttachment: string;
};

export type CreateWorkspaceMutationVariables = Exact<{ [key: string]: never }>;

export type CreateWorkspaceMutation = {
  __typename?: 'Mutation';
  createWorkspace: {
    __typename?: 'WorkspaceType';
    id: string;
    public: boolean;
    createdAt: string;
  };
};

export type DeleteAccountMutationVariables = Exact<{ [key: string]: never }>;

export type DeleteAccountMutation = {
  __typename?: 'Mutation';
  deleteAccount: { __typename?: 'DeleteAccountResult'; success: boolean };
};

export type DeleteWorkspaceMutationVariables = Exact<{
  id: Scalars['String']['input'];
}>;

export type DeleteWorkspaceMutation = {
  __typename?: 'Mutation';
  deleteWorkspace: boolean;
};

export type ChangeDocTagsMutationVariables = Exact<{
  workspaceId: Scalars['String']['input'];
  docId: Scalars['String']['input'];
  add?: InputMaybe<
    Array<Scalars['String']['input']> | Scalars['String']['input']
  >;
  remove?: InputMaybe<
    Array<Scalars['String']['input']> | Scalars['String']['input']
  >;
}>;

export type ChangeDocTagsMutation = {
  __typename?: 'Mutation';
  changeDocTags: {
    __typename?: 'DocMetaWriteResult';
    status: string;
    revision: string | null;
  };
};

export type CreateDocMetaMutationVariables = Exact<{
  workspaceId: Scalars['String']['input'];
  docId: Scalars['String']['input'];
  title?: InputMaybe<Scalars['String']['input']>;
  mode?: InputMaybe<Scalars['String']['input']>;
}>;

export type CreateDocMetaMutation = {
  __typename?: 'Mutation';
  createDocMeta: {
    __typename?: 'DocMetaWriteResult';
    status: string;
    revision: string | null;
    titleRevision: string | null;
    trashRevision: string | null;
    tagsRevision: string | null;
  };
};

export type DeleteDocMetaMutationVariables = Exact<{
  workspaceId: Scalars['String']['input'];
  docId: Scalars['String']['input'];
}>;

export type DeleteDocMetaMutation = {
  __typename?: 'Mutation';
  deleteDocMeta: { __typename?: 'DocMetaWriteResult'; status: string };
};

export type SetDocTitleMutationVariables = Exact<{
  workspaceId: Scalars['String']['input'];
  docId: Scalars['String']['input'];
  title: Scalars['String']['input'];
  baseRevision: Scalars['String']['input'];
}>;

export type SetDocTitleMutation = {
  __typename?: 'Mutation';
  setDocTitle: {
    __typename?: 'DocMetaWriteResult';
    status: string;
    revision: string | null;
    currentTitle: string | null;
    currentTrash: boolean | null;
  };
};

export type SetDocTrashMutationVariables = Exact<{
  workspaceId: Scalars['String']['input'];
  docId: Scalars['String']['input'];
  trash: Scalars['Boolean']['input'];
  baseRevision: Scalars['String']['input'];
}>;

export type SetDocTrashMutation = {
  __typename?: 'Mutation';
  setDocTrash: {
    __typename?: 'DocMetaWriteResult';
    status: string;
    revision: string | null;
    currentTitle: string | null;
    currentTrash: boolean | null;
  };
};

export type GetDocRolePermissionsQueryVariables = Exact<{
  workspaceId: Scalars['String']['input'];
  docId: Scalars['String']['input'];
}>;

export type GetDocRolePermissionsQuery = {
  __typename?: 'Query';
  workspace: {
    __typename?: 'WorkspaceType';
    doc: {
      __typename?: 'DocType';
      permissions: {
        __typename?: 'DocPermissionsType';
        Doc_Copy: boolean;
        Doc_Delete: boolean;
        Doc_Duplicate: boolean;
        Doc_Properties_Read: boolean;
        Doc_Properties_Update: boolean;
        Doc_Publish: boolean;
        Doc_Read: boolean;
        Doc_Restore: boolean;
        Doc_TransferOwner: boolean;
        Doc_Trash: boolean;
        Doc_Update: boolean;
        Doc_Users_Manage: boolean;
        Doc_Users_Read: boolean;
        Doc_Comments_Create: boolean;
        Doc_Comments_Delete: boolean;
        Doc_Comments_Read: boolean;
        Doc_Comments_Resolve: boolean;
      } | null;
    } | null;
  };
};

export type CredentialsRequirementsFragment = {
  __typename?: 'CredentialsRequirementType';
  password: {
    __typename?: 'PasswordLimitsType';
    minLength: number;
    maxLength: number;
  };
};

export type CurrentUserProfileFragment = {
  __typename?: 'UserType';
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  features: Array<FeatureType> | null;
  settings: {
    __typename?: 'UserSettings';
    receiveInvitationEmail: boolean;
    receiveMentionEmail: boolean;
    receiveCommentEmail: boolean;
  } | null;
  quota: {
    __typename?: 'UserQuota';
    name: string;
    blobLimit: number;
    storageQuota: number;
    historyPeriod: number;
    memberLimit: number;
    humanReadable: {
      __typename?: 'UserQuotaHumanReadable';
      name: string;
      blobLimit: string;
      storageQuota: string;
      historyPeriod: string;
      memberLimit: string;
    };
  } | null;
  quotaUsage: { __typename?: 'UserQuotaUsage'; storageQuota: number } | null;
};

export type PasswordLimitsFragment = {
  __typename?: 'PasswordLimitsType';
  minLength: number;
  maxLength: number;
};

export type GetCurrentUserFeaturesQueryVariables = Exact<{
  [key: string]: never;
}>;

export type GetCurrentUserFeaturesQuery = {
  __typename?: 'Query';
  currentUser: {
    __typename?: 'UserType';
    id: string;
    name: string | null;
    email: string;
    emailVerified: boolean;
    avatarUrl: string | null;
    features: Array<FeatureType> | null;
  } | null;
};

export type GetCurrentUserProfileQueryVariables = Exact<{
  [key: string]: never;
}>;

export type GetCurrentUserProfileQuery = {
  __typename?: 'Query';
  currentUser: {
    __typename?: 'UserType';
    id: string;
    name: string | null;
    email: string;
    avatarUrl: string | null;
    emailVerified: boolean;
    features: Array<FeatureType> | null;
    settings: {
      __typename?: 'UserSettings';
      receiveInvitationEmail: boolean;
      receiveMentionEmail: boolean;
      receiveCommentEmail: boolean;
    } | null;
    quota: {
      __typename?: 'UserQuota';
      name: string;
      blobLimit: number;
      storageQuota: number;
      historyPeriod: number;
      memberLimit: number;
      humanReadable: {
        __typename?: 'UserQuotaHumanReadable';
        name: string;
        blobLimit: string;
        storageQuota: string;
        historyPeriod: string;
        memberLimit: string;
      };
    } | null;
    quotaUsage: { __typename?: 'UserQuotaUsage'; storageQuota: number } | null;
  } | null;
};

export type GetCurrentUserQueryVariables = Exact<{ [key: string]: never }>;

export type GetCurrentUserQuery = {
  __typename?: 'Query';
  currentUser: {
    __typename?: 'UserType';
    id: string;
    name: string | null;
    email: string;
    emailVerified: boolean;
    avatarUrl: string | null;
    token: { __typename?: 'TokenType'; sessionToken: string | null } | null;
  } | null;
};

export type GetDiscoveryRevisionQueryVariables = Exact<{
  workspaceId: Scalars['String']['input'];
}>;

export type GetDiscoveryRevisionQuery = {
  __typename?: 'Query';
  discoveryRevision: string;
};

export type GetDiscoverySnapshotQueryVariables = Exact<{
  workspaceId: Scalars['String']['input'];
}>;

export type GetDiscoverySnapshotQuery = {
  __typename?: 'Query';
  discoverySnapshot: {
    __typename?: 'DiscoverySnapshot';
    workspaceId: string;
    userId: string;
    revision: string;
    fetchedAt: string;
    documents: Array<{
      __typename?: 'DiscoveryDocument';
      id: string;
      title: string | null;
      tagIds: Array<string>;
      mode: string;
      trash: boolean;
      createdAt: string;
      updatedAt: string;
      createdBy: string | null;
      updatedBy: string | null;
      titleRevision: string;
      trashRevision: string;
      tagsRevision: string;
    }>;
  };
};

export type GetDocDefaultRoleQueryVariables = Exact<{
  workspaceId: Scalars['String']['input'];
  docId: Scalars['String']['input'];
}>;

export type GetDocDefaultRoleQuery = {
  __typename?: 'Query';
  workspace: {
    __typename?: 'WorkspaceType';
    doc: { __typename?: 'DocType'; defaultRole: DocRole } | null;
  };
};

export type GetDocSummaryQueryVariables = Exact<{
  workspaceId: Scalars['String']['input'];
  docId: Scalars['String']['input'];
}>;

export type GetDocSummaryQuery = {
  __typename?: 'Query';
  workspace: {
    __typename?: 'WorkspaceType';
    doc: { __typename?: 'DocType'; summary: string | null } | null;
  };
};

export type GetInviteInfoQueryVariables = Exact<{
  inviteId: Scalars['String']['input'];
}>;

export type GetInviteInfoQuery = {
  __typename?: 'Query';
  getInviteInfo: {
    __typename?: 'InvitationType';
    status: WorkspaceMemberStatus | null;
    workspace: {
      __typename?: 'InvitationWorkspaceType';
      id: string;
      name: string;
      avatar: string;
    };
    user: {
      __typename?: 'WorkspaceUserType';
      id: string;
      name: string | null;
      avatarUrl: string | null;
    };
    invitee: {
      __typename?: 'WorkspaceUserType';
      id: string;
      name: string | null;
      email: string | null;
      avatarUrl: string | null;
    };
  };
};

export type GetMemberCountByWorkspaceIdQueryVariables = Exact<{
  workspaceId: Scalars['String']['input'];
}>;

export type GetMemberCountByWorkspaceIdQuery = {
  __typename?: 'Query';
  workspace: { __typename?: 'WorkspaceType'; memberCount: number };
};

export type GetMembersByWorkspaceIdQueryVariables = Exact<{
  workspaceId: Scalars['String']['input'];
  skip?: InputMaybe<Scalars['Int']['input']>;
  take?: InputMaybe<Scalars['Int']['input']>;
  query?: InputMaybe<Scalars['String']['input']>;
}>;

export type GetMembersByWorkspaceIdQuery = {
  __typename?: 'Query';
  workspace: {
    __typename?: 'WorkspaceType';
    memberCount: number;
    members: Array<{
      __typename?: 'InviteUserType';
      id: string;
      name: string | null;
      email: string | null;
      avatarUrl: string | null;
      permission: Permission;
      inviteId: string;
      emailVerified: boolean | null;
      status: WorkspaceMemberStatus | null;
    }>;
  };
};

export type OauthProvidersQueryVariables = Exact<{ [key: string]: never }>;

export type OauthProvidersQuery = {
  __typename?: 'Query';
  serverConfig: {
    __typename?: 'ServerConfigType';
    oauthProviders: Array<OAuthProviderType>;
    oidcButtonLabel: string | null;
  };
};

export type GetPageGrantedUsersListQueryVariables = Exact<{
  pagination: PaginationInput;
  docId: Scalars['String']['input'];
  workspaceId: Scalars['String']['input'];
}>;

export type GetPageGrantedUsersListQuery = {
  __typename?: 'Query';
  workspace: {
    __typename?: 'WorkspaceType';
    doc: {
      __typename?: 'DocType';
      grantedUsersList: {
        __typename?: 'PaginatedGrantedDocUserType';
        totalCount: number;
        pageInfo: {
          __typename?: 'GrantedDocUserPageInfo';
          endCursor: string | null;
          hasNextPage: boolean;
        };
        edges: Array<{
          __typename?: 'GrantedDocUserEdge';
          node: {
            __typename?: 'GrantedDocUserType';
            role: DocRole;
            user: {
              __typename?: 'DocGrantedUserInfo';
              id: string;
              name: string | null;
              email: string | null;
              avatarUrl: string | null;
            };
          };
        }>;
      };
    } | null;
  };
};

export type GetPublicUserByIdQueryVariables = Exact<{
  id: Scalars['String']['input'];
}>;

export type GetPublicUserByIdQuery = {
  __typename?: 'Query';
  publicUserById: {
    __typename?: 'UserType';
    id: string;
    avatarUrl: string | null;
    name: string | null;
  } | null;
};

export type GetUserFeaturesQueryVariables = Exact<{ [key: string]: never }>;

export type GetUserFeaturesQuery = {
  __typename?: 'Query';
  currentUser: {
    __typename?: 'UserType';
    id: string;
    features: Array<FeatureType> | null;
  } | null;
};

export type GetUserSettingsQueryVariables = Exact<{ [key: string]: never }>;

export type GetUserSettingsQuery = {
  __typename?: 'Query';
  currentUser: {
    __typename?: 'UserType';
    settings: {
      __typename?: 'UserSettings';
      receiveInvitationEmail: boolean;
      receiveMentionEmail: boolean;
      receiveCommentEmail: boolean;
    } | null;
  } | null;
};

export type GetWorkspaceInfoQueryVariables = Exact<{
  workspaceId: Scalars['String']['input'];
}>;

export type GetWorkspaceInfoQuery = {
  __typename?: 'Query';
  workspace: {
    __typename?: 'WorkspaceType';
    role: string;
    team: boolean;
    permissions: {
      __typename?: 'WorkspacePermissionsType';
      Workspace_Administrators_Manage: boolean;
      Workspace_Blobs_List: boolean;
      Workspace_Blobs_Read: boolean;
      Workspace_Blobs_Write: boolean;
      Workspace_Copilot: boolean;
      Workspace_CreateDoc: boolean;
      Workspace_Delete: boolean;
      Workspace_Organize_Read: boolean;
      Workspace_Payment_Manage: boolean;
      Workspace_Properties_Create: boolean;
      Workspace_Properties_Delete: boolean;
      Workspace_Properties_Read: boolean;
      Workspace_Properties_Update: boolean;
      Workspace_Read: boolean;
      Workspace_Settings_Read: boolean;
      Workspace_Settings_Update: boolean;
      Workspace_Sync: boolean;
      Workspace_TransferOwner: boolean;
      Workspace_Users_Manage: boolean;
      Workspace_Users_Read: boolean;
    } | null;
  };
};

export type GetWorkspacePageByIdQueryVariables = Exact<{
  workspaceId: Scalars['String']['input'];
  pageId: Scalars['String']['input'];
}>;

export type GetWorkspacePageByIdQuery = {
  __typename?: 'Query';
  workspace: {
    __typename?: 'WorkspaceType';
    doc: {
      __typename?: 'DocType';
      id: string;
      mode: string;
      defaultRole: DocRole;
      public: boolean;
      title: string | null;
      summary: string | null;
    } | null;
  };
};

export type GetWorkspacePublicByIdQueryVariables = Exact<{
  id: Scalars['String']['input'];
}>;

export type GetWorkspacePublicByIdQuery = {
  __typename?: 'Query';
  workspace: { __typename?: 'WorkspaceType'; public: boolean };
};

export type GetWorkspacePublicPagesQueryVariables = Exact<{
  workspaceId: Scalars['String']['input'];
}>;

export type GetWorkspacePublicPagesQuery = {
  __typename?: 'Query';
  workspace: {
    __typename?: 'WorkspaceType';
    publicDocs: Array<{ __typename?: 'DocType'; id: string; mode: string }>;
  };
};

export type GetWorkspaceQueryVariables = Exact<{
  id: Scalars['String']['input'];
}>;

export type GetWorkspaceQuery = {
  __typename?: 'Query';
  workspace: { __typename?: 'WorkspaceType'; id: string };
};

export type GetWorkspacesQueryVariables = Exact<{ [key: string]: never }>;

export type GetWorkspacesQuery = {
  __typename?: 'Query';
  workspaces: Array<{
    __typename?: 'WorkspaceType';
    id: string;
    initialized: boolean;
    team: boolean;
    owner: { __typename?: 'WorkspaceOwnerType'; id: string };
  }>;
};

export type GrantDocUserRolesMutationVariables = Exact<{
  input: GrantDocUserRolesInput;
}>;

export type GrantDocUserRolesMutation = {
  __typename?: 'Mutation';
  grantDocUserRoles: boolean;
};

export type ListHistoryQueryVariables = Exact<{
  workspaceId: Scalars['String']['input'];
  pageDocId: Scalars['String']['input'];
  take?: InputMaybe<Scalars['Int']['input']>;
  before?: InputMaybe<Scalars['DateTime']['input']>;
}>;

export type ListHistoryQuery = {
  __typename?: 'Query';
  workspace: {
    __typename?: 'WorkspaceType';
    histories: Array<{
      __typename?: 'WorkspaceDocHistoryType';
      id: string;
      timestamp: string;
      editor: {
        __typename?: 'DocHistoryEditorType';
        name: string | null;
        avatarUrl: string | null;
      } | null;
    }>;
  };
};

export type IndexerAggregateQueryVariables = Exact<{
  id: Scalars['String']['input'];
  input: AggregateInput;
}>;

export type IndexerAggregateQuery = {
  __typename?: 'Query';
  workspace: {
    __typename?: 'WorkspaceType';
    aggregate: {
      __typename?: 'AggregateResultObjectType';
      buckets: Array<{
        __typename?: 'AggregateBucketObjectType';
        key: string;
        count: number;
        hits: {
          __typename?: 'AggregateBucketHitsObjectType';
          nodes: Array<{
            __typename?: 'SearchNodeObjectType';
            fields: any;
            highlights: any | null;
          }>;
        };
      }>;
      pagination: {
        __typename?: 'SearchResultPagination';
        count: number;
        hasMore: boolean;
        nextCursor: string | null;
      };
    };
  };
};

export type IndexerSearchDocsQueryVariables = Exact<{
  id: Scalars['String']['input'];
  input: SearchDocsInput;
}>;

export type IndexerSearchDocsQuery = {
  __typename?: 'Query';
  workspace: {
    __typename?: 'WorkspaceType';
    searchDocs: Array<{
      __typename?: 'SearchDocObjectType';
      docId: string;
      title: string;
      blockId: string;
      highlight: string;
      createdAt: string;
      updatedAt: string;
      createdByUser: {
        __typename?: 'PublicUserType';
        id: string;
        name: string;
        avatarUrl: string | null;
      } | null;
      updatedByUser: {
        __typename?: 'PublicUserType';
        id: string;
        name: string;
        avatarUrl: string | null;
      } | null;
    }>;
  };
};

export type IndexerSearchQueryVariables = Exact<{
  id: Scalars['String']['input'];
  input: SearchInput;
}>;

export type IndexerSearchQuery = {
  __typename?: 'Query';
  workspace: {
    __typename?: 'WorkspaceType';
    search: {
      __typename?: 'SearchResultObjectType';
      nodes: Array<{
        __typename?: 'SearchNodeObjectType';
        fields: any;
        highlights: any | null;
      }>;
      pagination: {
        __typename?: 'SearchResultPagination';
        count: number;
        hasMore: boolean;
        nextCursor: string | null;
      };
    };
  };
};

export type IsPasswordTokenValidQueryVariables = Exact<{
  token: Scalars['String']['input'];
}>;

export type IsPasswordTokenValidQuery = {
  __typename?: 'Query';
  isPasswordTokenValid: boolean;
};

export type LeaveWorkspaceMutationVariables = Exact<{
  workspaceId: Scalars['String']['input'];
  sendLeaveMail?: InputMaybe<Scalars['Boolean']['input']>;
}>;

export type LeaveWorkspaceMutation = {
  __typename?: 'Mutation';
  leaveWorkspace: boolean;
};

export type ListNotificationsQueryVariables = Exact<{
  pagination: PaginationInput;
}>;

export type ListNotificationsQuery = {
  __typename?: 'Query';
  currentUser: {
    __typename?: 'UserType';
    notifications: {
      __typename?: 'PaginatedNotificationObjectType';
      totalCount: number;
      edges: Array<{
        __typename?: 'NotificationEdge';
        cursor: string;
        node: {
          __typename?: 'NotificationObjectType';
          id: string;
          type: NotificationType;
          level: string;
          read: boolean;
          createdAt: string;
          updatedAt: string;
          body: any | null;
        };
      }>;
      pageInfo: {
        __typename?: 'PageInfo';
        startCursor: string | null;
        endCursor: string | null;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
      };
    } | null;
  } | null;
};

export type MentionUserMutationVariables = Exact<{
  input: MentionInput;
}>;

export type MentionUserMutation = {
  __typename?: 'Mutation';
  mentionUser: boolean;
};

export type NotificationCountQueryVariables = Exact<{ [key: string]: never }>;

export type NotificationCountQuery = {
  __typename?: 'Query';
  currentUser: {
    __typename?: 'UserType';
    notifications: {
      __typename?: 'PaginatedNotificationObjectType';
      totalCount: number;
    } | null;
  } | null;
};

export type OidcConfigQueryVariables = Exact<{ [key: string]: never }>;

export type OidcConfigQuery = {
  __typename?: 'Query';
  oidcConfig: {
    __typename?: 'OidcConfigType';
    enabled: boolean;
    issuer: string;
    clientId: string;
    clientSecretSet: boolean;
    buttonLabel: string;
    emailClaims: string;
    autoCreateUser: boolean;
    redirectUri: string;
  };
};

export type TestOidcConnectionMutationVariables = Exact<{
  issuer: Scalars['String']['input'];
}>;

export type TestOidcConnectionMutation = {
  __typename?: 'Mutation';
  testOidcConnection: {
    __typename?: 'OidcTestResultType';
    ok: boolean;
    message: string;
    issuer: string | null;
    authorizationEndpoint: string | null;
    tokenEndpoint: string | null;
  };
};

export type UpdateOidcConfigMutationVariables = Exact<{
  input: UpdateOidcConfigInput;
}>;

export type UpdateOidcConfigMutation = {
  __typename?: 'Mutation';
  updateOidcConfig: {
    __typename?: 'OidcConfigType';
    enabled: boolean;
    issuer: string;
    clientId: string;
    clientSecretSet: boolean;
    buttonLabel: string;
    emailClaims: string;
    autoCreateUser: boolean;
    redirectUri: string;
  };
};

export type QuotaQueryVariables = Exact<{ [key: string]: never }>;

export type QuotaQuery = {
  __typename?: 'Query';
  currentUser: {
    __typename?: 'UserType';
    id: string;
    quota: {
      __typename?: 'UserQuota';
      name: string;
      blobLimit: number;
      storageQuota: number;
      historyPeriod: number;
      memberLimit: number;
      humanReadable: {
        __typename?: 'UserQuotaHumanReadable';
        name: string;
        blobLimit: string;
        storageQuota: string;
        historyPeriod: string;
        memberLimit: string;
      };
    } | null;
    quotaUsage: { __typename?: 'UserQuotaUsage'; storageQuota: number } | null;
  } | null;
};

export type ReadAllNotificationsMutationVariables = Exact<{
  [key: string]: never;
}>;

export type ReadAllNotificationsMutation = {
  __typename?: 'Mutation';
  readAllNotifications: boolean;
};

export type ReadNotificationMutationVariables = Exact<{
  id: Scalars['String']['input'];
}>;

export type ReadNotificationMutation = {
  __typename?: 'Mutation';
  readNotification: boolean;
};

export type RecoverDocMutationVariables = Exact<{
  workspaceId: Scalars['String']['input'];
  docId: Scalars['String']['input'];
  timestamp: Scalars['DateTime']['input'];
}>;

export type RecoverDocMutation = {
  __typename?: 'Mutation';
  recoverDoc: boolean;
};

export type RemoveAvatarMutationVariables = Exact<{ [key: string]: never }>;

export type RemoveAvatarMutation = {
  __typename?: 'Mutation';
  removeAvatar: { __typename?: 'RemoveAvatarResult'; success: boolean };
};

export type RevokeDocUserRolesMutationVariables = Exact<{
  input: RevokeDocUserRoleInput;
}>;

export type RevokeDocUserRolesMutation = {
  __typename?: 'Mutation';
  revokeDocUserRoles: boolean;
};

export type RevokeMemberPermissionMutationVariables = Exact<{
  workspaceId: Scalars['String']['input'];
  userId: Scalars['String']['input'];
}>;

export type RevokeMemberPermissionMutation = {
  __typename?: 'Mutation';
  revokeMember: boolean;
};

export type SendChangeEmailMutationVariables = Exact<{
  callbackUrl: Scalars['String']['input'];
}>;

export type SendChangeEmailMutation = {
  __typename?: 'Mutation';
  sendChangeEmail: boolean;
};

export type SendVerifyChangeEmailMutationVariables = Exact<{
  token: Scalars['String']['input'];
  email: Scalars['String']['input'];
  callbackUrl: Scalars['String']['input'];
}>;

export type SendVerifyChangeEmailMutation = {
  __typename?: 'Mutation';
  sendVerifyChangeEmail: boolean;
};

export type SendVerifyEmailMutationVariables = Exact<{
  callbackUrl: Scalars['String']['input'];
}>;

export type SendVerifyEmailMutation = {
  __typename?: 'Mutation';
  sendVerifyEmail: boolean;
};

export type ServerConfigQueryVariables = Exact<{ [key: string]: never }>;

export type ServerConfigQuery = {
  __typename?: 'Query';
  serverConfig: {
    __typename?: 'ServerConfigType';
    version: string;
    baseUrl: string;
    name: string;
    features: Array<ServerFeature>;
    type: ServerDeploymentType;
    initialized: boolean;
    defaultLanguage: string | null;
    credentialsRequirement: {
      __typename?: 'CredentialsRequirementType';
      password: {
        __typename?: 'PasswordLimitsType';
        minLength: number;
        maxLength: number;
      };
    };
  };
};

export type UpdateDocDefaultRoleMutationVariables = Exact<{
  input: UpdateDocDefaultRoleInput;
}>;

export type UpdateDocDefaultRoleMutation = {
  __typename?: 'Mutation';
  updateDocDefaultRole: boolean;
};

export type UpdateDocUserRoleMutationVariables = Exact<{
  input: UpdateDocUserRoleInput;
}>;

export type UpdateDocUserRoleMutation = {
  __typename?: 'Mutation';
  updateDocUserRole: boolean;
};

export type UpdateUserProfileMutationVariables = Exact<{
  input: UpdateUserInput;
}>;

export type UpdateUserProfileMutation = {
  __typename?: 'Mutation';
  updateProfile: { __typename?: 'UserType'; id: string; name: string | null };
};

export type UpdateUserSettingsMutationVariables = Exact<{
  input: UpdateUserSettingsInput;
}>;

export type UpdateUserSettingsMutation = {
  __typename?: 'Mutation';
  updateSettings: boolean;
};

export type UploadAvatarMutationVariables = Exact<{
  avatar: Scalars['Upload']['input'];
}>;

export type UploadAvatarMutation = {
  __typename?: 'Mutation';
  uploadAvatar: {
    __typename?: 'UserType';
    id: string;
    name: string | null;
    avatarUrl: string | null;
    email: string;
  };
};

export type VerifyEmailMutationVariables = Exact<{
  token: Scalars['String']['input'];
}>;

export type VerifyEmailMutation = {
  __typename?: 'Mutation';
  verifyEmail: boolean;
};

export type WorkspaceBlobQuotaQueryVariables = Exact<{
  id: Scalars['String']['input'];
}>;

export type WorkspaceBlobQuotaQuery = {
  __typename?: 'Query';
  workspace: {
    __typename?: 'WorkspaceType';
    quota: {
      __typename?: 'WorkspaceQuotaType';
      blobLimit: number;
      humanReadable: {
        __typename?: 'HumanReadableQuotaType';
        blobLimit: string;
      };
    } | null;
  };
};

export type GetWorkspaceConfigQueryVariables = Exact<{
  id: Scalars['String']['input'];
}>;

export type GetWorkspaceConfigQuery = {
  __typename?: 'Query';
  workspace: {
    __typename?: 'WorkspaceType';
    enableAi: boolean;
    enableSharing: boolean;
    enableUrlPreview: boolean;
    enableDocEmbedding: boolean;
    inviteLink: {
      __typename?: 'InviteLink';
      link: string;
      expireTime: string;
    } | null;
  };
};

export type InviteByEmailsMutationVariables = Exact<{
  workspaceId: Scalars['String']['input'];
  emails: Array<Scalars['String']['input']> | Scalars['String']['input'];
}>;

export type InviteByEmailsMutation = {
  __typename?: 'Mutation';
  inviteMembers: Array<{
    __typename?: 'InviteUserType';
    email: string | null;
    inviteId: string;
    sentSuccess: boolean;
  }>;
};

export type AcceptInviteByInviteIdMutationVariables = Exact<{
  workspaceId: Scalars['String']['input'];
  inviteId: Scalars['String']['input'];
}>;

export type AcceptInviteByInviteIdMutation = {
  __typename?: 'Mutation';
  acceptInviteById: boolean;
};

export type CreateInviteLinkMutationVariables = Exact<{
  workspaceId: Scalars['String']['input'];
  expireTime: WorkspaceInviteLinkExpireTime;
}>;

export type CreateInviteLinkMutation = {
  __typename?: 'Mutation';
  createInviteLink: {
    __typename?: 'InviteLink';
    link: string;
    expireTime: string;
  };
};

export type RevokeInviteLinkMutationVariables = Exact<{
  workspaceId: Scalars['String']['input'];
}>;

export type RevokeInviteLinkMutation = {
  __typename?: 'Mutation';
  revokeInviteLink: boolean;
};

export type WorkspaceQuotaQueryVariables = Exact<{
  id: Scalars['String']['input'];
}>;

export type WorkspaceQuotaQuery = {
  __typename?: 'Query';
  workspace: {
    __typename?: 'WorkspaceType';
    quota: {
      __typename?: 'WorkspaceQuotaType';
      name: string;
      blobLimit: number;
      storageQuota: number;
      usedStorageQuota: number;
      historyPeriod: number;
      memberLimit: number;
      memberCount: number;
      overcapacityMemberCount: number;
      humanReadable: {
        __typename?: 'HumanReadableQuotaType';
        name: string;
        blobLimit: string;
        storageQuota: string;
        historyPeriod: string;
        memberLimit: string;
        memberCount: number;
        overcapacityMemberCount: number;
      };
    } | null;
  };
};

export type ApproveWorkspaceTeamMemberMutationVariables = Exact<{
  workspaceId: Scalars['String']['input'];
  userId: Scalars['String']['input'];
}>;

export type ApproveWorkspaceTeamMemberMutation = {
  __typename?: 'Mutation';
  approveMember: boolean;
};

export type GrantWorkspaceTeamMemberMutationVariables = Exact<{
  workspaceId: Scalars['String']['input'];
  userId: Scalars['String']['input'];
  permission: Permission;
}>;

export type GrantWorkspaceTeamMemberMutation = {
  __typename?: 'Mutation';
  grantMember: boolean;
};

export type Queries =
  | {
      name: 'adminBackupListQuery';
      variables: AdminBackupListQueryVariables;
      response: AdminBackupListQuery;
    }
  | {
      name: 'adminServerSettingsQuery';
      variables: AdminServerSettingsQueryVariables;
      response: AdminServerSettingsQuery;
    }
  | {
      name: 'adminUserListQuery';
      variables: AdminUserListQueryVariables;
      response: AdminUserListQuery;
    }
  | {
      name: 'adminAuditLogsQuery';
      variables: AdminAuditLogsQueryVariables;
      response: AdminAuditLogsQuery;
    }
  | {
      name: 'adminAuditLogsCsvQuery';
      variables: AdminAuditLogsCsvQueryVariables;
      response: AdminAuditLogsCsvQuery;
    }
  | {
      name: 'listBlobsQuery';
      variables: ListBlobsQueryVariables;
      response: ListBlobsQuery;
    }
  | {
      name: 'listCommentChangesQuery';
      variables: ListCommentChangesQueryVariables;
      response: ListCommentChangesQuery;
    }
  | {
      name: 'listCommentsQuery';
      variables: ListCommentsQueryVariables;
      response: ListCommentsQuery;
    }
  | {
      name: 'getDocRolePermissionsQuery';
      variables: GetDocRolePermissionsQueryVariables;
      response: GetDocRolePermissionsQuery;
    }
  | {
      name: 'getCurrentUserFeaturesQuery';
      variables: GetCurrentUserFeaturesQueryVariables;
      response: GetCurrentUserFeaturesQuery;
    }
  | {
      name: 'getCurrentUserProfileQuery';
      variables: GetCurrentUserProfileQueryVariables;
      response: GetCurrentUserProfileQuery;
    }
  | {
      name: 'getCurrentUserQuery';
      variables: GetCurrentUserQueryVariables;
      response: GetCurrentUserQuery;
    }
  | {
      name: 'getDiscoveryRevisionQuery';
      variables: GetDiscoveryRevisionQueryVariables;
      response: GetDiscoveryRevisionQuery;
    }
  | {
      name: 'getDiscoverySnapshotQuery';
      variables: GetDiscoverySnapshotQueryVariables;
      response: GetDiscoverySnapshotQuery;
    }
  | {
      name: 'getDocDefaultRoleQuery';
      variables: GetDocDefaultRoleQueryVariables;
      response: GetDocDefaultRoleQuery;
    }
  | {
      name: 'getDocSummaryQuery';
      variables: GetDocSummaryQueryVariables;
      response: GetDocSummaryQuery;
    }
  | {
      name: 'getInviteInfoQuery';
      variables: GetInviteInfoQueryVariables;
      response: GetInviteInfoQuery;
    }
  | {
      name: 'getMemberCountByWorkspaceIdQuery';
      variables: GetMemberCountByWorkspaceIdQueryVariables;
      response: GetMemberCountByWorkspaceIdQuery;
    }
  | {
      name: 'getMembersByWorkspaceIdQuery';
      variables: GetMembersByWorkspaceIdQueryVariables;
      response: GetMembersByWorkspaceIdQuery;
    }
  | {
      name: 'oauthProvidersQuery';
      variables: OauthProvidersQueryVariables;
      response: OauthProvidersQuery;
    }
  | {
      name: 'getPageGrantedUsersListQuery';
      variables: GetPageGrantedUsersListQueryVariables;
      response: GetPageGrantedUsersListQuery;
    }
  | {
      name: 'getPublicUserByIdQuery';
      variables: GetPublicUserByIdQueryVariables;
      response: GetPublicUserByIdQuery;
    }
  | {
      name: 'getUserFeaturesQuery';
      variables: GetUserFeaturesQueryVariables;
      response: GetUserFeaturesQuery;
    }
  | {
      name: 'getUserSettingsQuery';
      variables: GetUserSettingsQueryVariables;
      response: GetUserSettingsQuery;
    }
  | {
      name: 'getWorkspaceInfoQuery';
      variables: GetWorkspaceInfoQueryVariables;
      response: GetWorkspaceInfoQuery;
    }
  | {
      name: 'getWorkspacePageByIdQuery';
      variables: GetWorkspacePageByIdQueryVariables;
      response: GetWorkspacePageByIdQuery;
    }
  | {
      name: 'getWorkspacePublicByIdQuery';
      variables: GetWorkspacePublicByIdQueryVariables;
      response: GetWorkspacePublicByIdQuery;
    }
  | {
      name: 'getWorkspacePublicPagesQuery';
      variables: GetWorkspacePublicPagesQueryVariables;
      response: GetWorkspacePublicPagesQuery;
    }
  | {
      name: 'getWorkspaceQuery';
      variables: GetWorkspaceQueryVariables;
      response: GetWorkspaceQuery;
    }
  | {
      name: 'getWorkspacesQuery';
      variables: GetWorkspacesQueryVariables;
      response: GetWorkspacesQuery;
    }
  | {
      name: 'listHistoryQuery';
      variables: ListHistoryQueryVariables;
      response: ListHistoryQuery;
    }
  | {
      name: 'indexerAggregateQuery';
      variables: IndexerAggregateQueryVariables;
      response: IndexerAggregateQuery;
    }
  | {
      name: 'indexerSearchDocsQuery';
      variables: IndexerSearchDocsQueryVariables;
      response: IndexerSearchDocsQuery;
    }
  | {
      name: 'indexerSearchQuery';
      variables: IndexerSearchQueryVariables;
      response: IndexerSearchQuery;
    }
  | {
      name: 'isPasswordTokenValidQuery';
      variables: IsPasswordTokenValidQueryVariables;
      response: IsPasswordTokenValidQuery;
    }
  | {
      name: 'listNotificationsQuery';
      variables: ListNotificationsQueryVariables;
      response: ListNotificationsQuery;
    }
  | {
      name: 'notificationCountQuery';
      variables: NotificationCountQueryVariables;
      response: NotificationCountQuery;
    }
  | {
      name: 'oidcConfigQuery';
      variables: OidcConfigQueryVariables;
      response: OidcConfigQuery;
    }
  | {
      name: 'quotaQuery';
      variables: QuotaQueryVariables;
      response: QuotaQuery;
    }
  | {
      name: 'serverConfigQuery';
      variables: ServerConfigQueryVariables;
      response: ServerConfigQuery;
    }
  | {
      name: 'workspaceBlobQuotaQuery';
      variables: WorkspaceBlobQuotaQueryVariables;
      response: WorkspaceBlobQuotaQuery;
    }
  | {
      name: 'getWorkspaceConfigQuery';
      variables: GetWorkspaceConfigQueryVariables;
      response: GetWorkspaceConfigQuery;
    }
  | {
      name: 'workspaceQuotaQuery';
      variables: WorkspaceQuotaQueryVariables;
      response: WorkspaceQuotaQuery;
    };

export type Mutations =
  | {
      name: 'adminCreateBackupMutation';
      variables: AdminCreateBackupMutationVariables;
      response: AdminCreateBackupMutation;
    }
  | {
      name: 'adminCreateUserMutation';
      variables: AdminCreateUserMutationVariables;
      response: AdminCreateUserMutation;
    }
  | {
      name: 'adminDeleteBackupMutation';
      variables: AdminDeleteBackupMutationVariables;
      response: AdminDeleteBackupMutation;
    }
  | {
      name: 'adminDeleteUserMutation';
      variables: AdminDeleteUserMutationVariables;
      response: AdminDeleteUserMutation;
    }
  | {
      name: 'adminSetUserAdminMutation';
      variables: AdminSetUserAdminMutationVariables;
      response: AdminSetUserAdminMutation;
    }
  | {
      name: 'adminUpdateServerSettingMutation';
      variables: AdminUpdateServerSettingMutationVariables;
      response: AdminUpdateServerSettingMutation;
    }
  | {
      name: 'createChangePasswordUrlMutation';
      variables: CreateChangePasswordUrlMutationVariables;
      response: CreateChangePasswordUrlMutation;
    }
  | {
      name: 'adminValidateUserCsvMutation';
      variables: AdminValidateUserCsvMutationVariables;
      response: AdminValidateUserCsvMutation;
    }
  | {
      name: 'adminImportUsersMutation';
      variables: AdminImportUsersMutationVariables;
      response: AdminImportUsersMutation;
    }
  | {
      name: 'sendTestEmailMutation';
      variables: SendTestEmailMutationVariables;
      response: SendTestEmailMutation;
    }
  | {
      name: 'adminSetUserPasswordMutation';
      variables: AdminSetUserPasswordMutationVariables;
      response: AdminSetUserPasswordMutation;
    }
  | {
      name: 'deleteBlobMutation';
      variables: DeleteBlobMutationVariables;
      response: DeleteBlobMutation;
    }
  | {
      name: 'releaseDeletedBlobsMutation';
      variables: ReleaseDeletedBlobsMutationVariables;
      response: ReleaseDeletedBlobsMutation;
    }
  | {
      name: 'setBlobMutation';
      variables: SetBlobMutationVariables;
      response: SetBlobMutation;
    }
  | {
      name: 'createBlobUploadMutation';
      variables: CreateBlobUploadMutationVariables;
      response: CreateBlobUploadMutation;
    }
  | {
      name: 'changeEmailMutation';
      variables: ChangeEmailMutationVariables;
      response: ChangeEmailMutation;
    }
  | {
      name: 'changeMyPasswordMutation';
      variables: ChangeMyPasswordMutationVariables;
      response: ChangeMyPasswordMutation;
    }
  | {
      name: 'changePasswordMutation';
      variables: ChangePasswordMutationVariables;
      response: ChangePasswordMutation;
    }
  | {
      name: 'createCommentMutation';
      variables: CreateCommentMutationVariables;
      response: CreateCommentMutation;
    }
  | {
      name: 'deleteCommentMutation';
      variables: DeleteCommentMutationVariables;
      response: DeleteCommentMutation;
    }
  | {
      name: 'createReplyMutation';
      variables: CreateReplyMutationVariables;
      response: CreateReplyMutation;
    }
  | {
      name: 'deleteReplyMutation';
      variables: DeleteReplyMutationVariables;
      response: DeleteReplyMutation;
    }
  | {
      name: 'updateReplyMutation';
      variables: UpdateReplyMutationVariables;
      response: UpdateReplyMutation;
    }
  | {
      name: 'resolveCommentMutation';
      variables: ResolveCommentMutationVariables;
      response: ResolveCommentMutation;
    }
  | {
      name: 'updateCommentMutation';
      variables: UpdateCommentMutationVariables;
      response: UpdateCommentMutation;
    }
  | {
      name: 'uploadCommentAttachmentMutation';
      variables: UploadCommentAttachmentMutationVariables;
      response: UploadCommentAttachmentMutation;
    }
  | {
      name: 'createWorkspaceMutation';
      variables: CreateWorkspaceMutationVariables;
      response: CreateWorkspaceMutation;
    }
  | {
      name: 'deleteAccountMutation';
      variables: DeleteAccountMutationVariables;
      response: DeleteAccountMutation;
    }
  | {
      name: 'deleteWorkspaceMutation';
      variables: DeleteWorkspaceMutationVariables;
      response: DeleteWorkspaceMutation;
    }
  | {
      name: 'changeDocTagsMutation';
      variables: ChangeDocTagsMutationVariables;
      response: ChangeDocTagsMutation;
    }
  | {
      name: 'createDocMetaMutation';
      variables: CreateDocMetaMutationVariables;
      response: CreateDocMetaMutation;
    }
  | {
      name: 'deleteDocMetaMutation';
      variables: DeleteDocMetaMutationVariables;
      response: DeleteDocMetaMutation;
    }
  | {
      name: 'setDocTitleMutation';
      variables: SetDocTitleMutationVariables;
      response: SetDocTitleMutation;
    }
  | {
      name: 'setDocTrashMutation';
      variables: SetDocTrashMutationVariables;
      response: SetDocTrashMutation;
    }
  | {
      name: 'grantDocUserRolesMutation';
      variables: GrantDocUserRolesMutationVariables;
      response: GrantDocUserRolesMutation;
    }
  | {
      name: 'leaveWorkspaceMutation';
      variables: LeaveWorkspaceMutationVariables;
      response: LeaveWorkspaceMutation;
    }
  | {
      name: 'mentionUserMutation';
      variables: MentionUserMutationVariables;
      response: MentionUserMutation;
    }
  | {
      name: 'testOidcConnectionMutation';
      variables: TestOidcConnectionMutationVariables;
      response: TestOidcConnectionMutation;
    }
  | {
      name: 'updateOidcConfigMutation';
      variables: UpdateOidcConfigMutationVariables;
      response: UpdateOidcConfigMutation;
    }
  | {
      name: 'readAllNotificationsMutation';
      variables: ReadAllNotificationsMutationVariables;
      response: ReadAllNotificationsMutation;
    }
  | {
      name: 'readNotificationMutation';
      variables: ReadNotificationMutationVariables;
      response: ReadNotificationMutation;
    }
  | {
      name: 'recoverDocMutation';
      variables: RecoverDocMutationVariables;
      response: RecoverDocMutation;
    }
  | {
      name: 'removeAvatarMutation';
      variables: RemoveAvatarMutationVariables;
      response: RemoveAvatarMutation;
    }
  | {
      name: 'revokeDocUserRolesMutation';
      variables: RevokeDocUserRolesMutationVariables;
      response: RevokeDocUserRolesMutation;
    }
  | {
      name: 'revokeMemberPermissionMutation';
      variables: RevokeMemberPermissionMutationVariables;
      response: RevokeMemberPermissionMutation;
    }
  | {
      name: 'sendChangeEmailMutation';
      variables: SendChangeEmailMutationVariables;
      response: SendChangeEmailMutation;
    }
  | {
      name: 'sendVerifyChangeEmailMutation';
      variables: SendVerifyChangeEmailMutationVariables;
      response: SendVerifyChangeEmailMutation;
    }
  | {
      name: 'sendVerifyEmailMutation';
      variables: SendVerifyEmailMutationVariables;
      response: SendVerifyEmailMutation;
    }
  | {
      name: 'updateDocDefaultRoleMutation';
      variables: UpdateDocDefaultRoleMutationVariables;
      response: UpdateDocDefaultRoleMutation;
    }
  | {
      name: 'updateDocUserRoleMutation';
      variables: UpdateDocUserRoleMutationVariables;
      response: UpdateDocUserRoleMutation;
    }
  | {
      name: 'updateUserProfileMutation';
      variables: UpdateUserProfileMutationVariables;
      response: UpdateUserProfileMutation;
    }
  | {
      name: 'updateUserSettingsMutation';
      variables: UpdateUserSettingsMutationVariables;
      response: UpdateUserSettingsMutation;
    }
  | {
      name: 'uploadAvatarMutation';
      variables: UploadAvatarMutationVariables;
      response: UploadAvatarMutation;
    }
  | {
      name: 'verifyEmailMutation';
      variables: VerifyEmailMutationVariables;
      response: VerifyEmailMutation;
    }
  | {
      name: 'inviteByEmailsMutation';
      variables: InviteByEmailsMutationVariables;
      response: InviteByEmailsMutation;
    }
  | {
      name: 'acceptInviteByInviteIdMutation';
      variables: AcceptInviteByInviteIdMutationVariables;
      response: AcceptInviteByInviteIdMutation;
    }
  | {
      name: 'createInviteLinkMutation';
      variables: CreateInviteLinkMutationVariables;
      response: CreateInviteLinkMutation;
    }
  | {
      name: 'revokeInviteLinkMutation';
      variables: RevokeInviteLinkMutationVariables;
      response: RevokeInviteLinkMutation;
    }
  | {
      name: 'approveWorkspaceTeamMemberMutation';
      variables: ApproveWorkspaceTeamMemberMutationVariables;
      response: ApproveWorkspaceTeamMemberMutation;
    }
  | {
      name: 'grantWorkspaceTeamMemberMutation';
      variables: GrantWorkspaceTeamMemberMutationVariables;
      response: GrantWorkspaceTeamMemberMutation;
    };

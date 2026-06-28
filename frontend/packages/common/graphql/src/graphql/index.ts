/* do not manipulate this file manually. */
export interface GraphQLQuery {
  id: string;
  op: string;
  query: string;
  file?: boolean;
  deprecations?: string[];
}
export const credentialsRequirementsFragment = `fragment CredentialsRequirements on CredentialsRequirementType {
  password {
    ...PasswordLimits
  }
}`;
export const currentUserProfileFragment = `fragment CurrentUserProfile on UserType {
  id
  name
  email
  avatarUrl
  emailVerified
  features
  settings {
    receiveInvitationEmail
    receiveMentionEmail
    receiveCommentEmail
  }
  quota {
    name
    blobLimit
    storageQuota
    historyPeriod
    memberLimit
    humanReadable {
      name
      blobLimit
      storageQuota
      historyPeriod
      memberLimit
    }
  }
  quotaUsage {
    storageQuota
  }
}`;
export const passwordLimitsFragment = `fragment PasswordLimits on PasswordLimitsType {
  minLength
  maxLength
}`;
export const generateUserAccessTokenMutation = {
  id: 'generateUserAccessTokenMutation' as const,
  op: 'generateUserAccessToken',
  query: `mutation generateUserAccessToken($input: GenerateAccessTokenInput!) {
  generateUserAccessToken(input: $input) {
    id
    name
    token
    createdAt
    expiresAt
  }
}`,
};

export const listUserAccessTokensQuery = {
  id: 'listUserAccessTokensQuery' as const,
  op: 'listUserAccessTokens',
  query: `query listUserAccessTokens {
  currentUser {
    revealedAccessTokens {
      id
      name
      createdAt
      expiresAt
      token
    }
  }
}`,
};

export const revokeUserAccessTokenMutation = {
  id: 'revokeUserAccessTokenMutation' as const,
  op: 'revokeUserAccessToken',
  query: `mutation revokeUserAccessToken($id: String!) {
  revokeUserAccessToken(id: $id)
}`,
};

export const adminServerConfigQuery = {
  id: 'adminServerConfigQuery' as const,
  op: 'adminServerConfig',
  query: `query adminServerConfig {
  serverConfig {
    version
    baseUrl
    name
    features
    type
    initialized
    credentialsRequirement {
      ...CredentialsRequirements
    }
    availableUpgrade {
      changelog
      version
      publishedAt
      url
    }
    availableUserFeatures
    availableWorkspaceFeatures
  }
}
${passwordLimitsFragment}
${credentialsRequirementsFragment}`,
};

export const adminUpdateWorkspaceMutation = {
  id: 'adminUpdateWorkspaceMutation' as const,
  op: 'adminUpdateWorkspace',
  query: `mutation adminUpdateWorkspace($input: AdminUpdateWorkspaceInput!) {
  adminUpdateWorkspace(input: $input) {
    id
    public
    createdAt
    name
    avatarKey
    enableAi
    enableSharing
    enableUrlPreview
    enableDocEmbedding
    features
    owner {
      id
      name
      email
      avatarUrl
    }
    memberCount
    publicPageCount
    snapshotCount
    snapshotSize
    blobCount
    blobSize
  }
}`,
};

export const adminWorkspaceQuery = {
  id: 'adminWorkspaceQuery' as const,
  op: 'adminWorkspace',
  query: `query adminWorkspace($id: String!, $memberSkip: Int, $memberTake: Int, $memberQuery: String) {
  adminWorkspace(id: $id) {
    id
    public
    createdAt
    name
    avatarKey
    enableAi
    enableSharing
    enableUrlPreview
    enableDocEmbedding
    features
    owner {
      id
      name
      email
      avatarUrl
    }
    memberCount
    publicPageCount
    snapshotCount
    snapshotSize
    blobCount
    blobSize
    sharedLinks {
      docId
      title
      publishedAt
    }
    members(skip: $memberSkip, take: $memberTake, query: $memberQuery) {
      id
      name
      email
      avatarUrl
      role
      status
    }
  }
}`,
};

export const adminWorkspacesQuery = {
  id: 'adminWorkspacesQuery' as const,
  op: 'adminWorkspaces',
  query: `query adminWorkspaces($filter: ListWorkspaceInput!) {
  adminWorkspaces(filter: $filter) {
    id
    public
    createdAt
    name
    avatarKey
    enableAi
    enableSharing
    enableUrlPreview
    enableDocEmbedding
    features
    owner {
      id
      name
      email
      avatarUrl
    }
    memberCount
    publicPageCount
    snapshotCount
    snapshotSize
    blobCount
    blobSize
  }
}`,
};

export const adminWorkspacesCountQuery = {
  id: 'adminWorkspacesCountQuery' as const,
  op: 'adminWorkspacesCount',
  query: `query adminWorkspacesCount($filter: ListWorkspaceInput!) {
  adminWorkspacesCount(filter: $filter)
}`,
};

export const createChangePasswordUrlMutation = {
  id: 'createChangePasswordUrlMutation' as const,
  op: 'createChangePasswordUrl',
  query: `mutation createChangePasswordUrl($callbackUrl: String!, $userId: String!) {
  createChangePasswordUrl(callbackUrl: $callbackUrl, userId: $userId)
}`,
};

export const appConfigQuery = {
  id: 'appConfigQuery' as const,
  op: 'appConfig',
  query: `query appConfig {
  appConfig
}`,
};

export const adminUserListQuery = {
  id: 'adminUserListQuery' as const,
  op: 'adminUserList',
  query: `query adminUserList($search: String, $skip: Int, $take: Int) {
  adminUserList(search: $search, skip: $skip, take: $take) {
    items {
      id
      email
      name
      avatarUrl
      isAdmin
      emailVerified
      createdAt
    }
    totalCount
  }
}`,
};

export const adminCreateUserMutation = {
  id: 'adminCreateUserMutation' as const,
  op: 'adminCreateUser',
  query: `mutation adminCreateUser($input: AdminCreateUserInput!) {
  adminCreateUser(input: $input) {
    id
    email
    name
    avatarUrl
    isAdmin
    emailVerified
    createdAt
  }
}`,
};

export const adminDeleteUserMutation = {
  id: 'adminDeleteUserMutation' as const,
  op: 'adminDeleteUser',
  query: `mutation adminDeleteUser($userId: String!) {
  adminDeleteUser(userId: $userId)
}`,
};

export const adminSetUserAdminMutation = {
  id: 'adminSetUserAdminMutation' as const,
  op: 'adminSetUserAdmin',
  query: `mutation adminSetUserAdmin($userId: String!, $isAdmin: Boolean!) {
  adminSetUserAdmin(userId: $userId, isAdmin: $isAdmin) {
    id
    email
    name
    avatarUrl
    isAdmin
    emailVerified
    createdAt
  }
}`,
};

export const adminServerSettingsQuery = {
  id: 'adminServerSettingsQuery' as const,
  op: 'adminServerSettings',
  query: `query adminServerSettings {
  adminServerSettings {
    key
    value
    updatedAt
  }
}`,
};

export const adminUpdateServerSettingMutation = {
  id: 'adminUpdateServerSettingMutation' as const,
  op: 'adminUpdateServerSetting',
  query: `mutation adminUpdateServerSetting($key: String!, $value: String!) {
  adminUpdateServerSetting(key: $key, value: $value) {
    key
    value
    updatedAt
  }
}`,
};

export const adminBackupListQuery = {
  id: 'adminBackupListQuery' as const,
  op: 'adminBackupList',
  query: `query adminBackupList($skip: Int, $take: Int) {
  adminBackupList(skip: $skip, take: $take) {
    items {
      id
      filename
      size
      workspaceCount
      docCount
      blobCount
      status
      createdAt
    }
    totalCount
  }
}`,
};

export const adminCreateBackupMutation = {
  id: 'adminCreateBackupMutation' as const,
  op: 'adminCreateBackup',
  query: `mutation adminCreateBackup {
  adminCreateBackup {
    id
    filename
    size
    workspaceCount
    docCount
    blobCount
    status
    createdAt
  }
}`,
};

export const adminDeleteBackupMutation = {
  id: 'adminDeleteBackupMutation' as const,
  op: 'adminDeleteBackup',
  query: `mutation adminDeleteBackup($id: String!) {
  adminDeleteBackup(id: $id)
}`,
};

export const deleteBlobMutation = {
  id: 'deleteBlobMutation' as const,
  op: 'deleteBlob',
  query: `mutation deleteBlob($workspaceId: String!, $key: String!, $permanently: Boolean) {
  deleteBlob(workspaceId: $workspaceId, key: $key, permanently: $permanently)
}`,
};

export const listBlobsQuery = {
  id: 'listBlobsQuery' as const,
  op: 'listBlobs',
  query: `query listBlobs($workspaceId: String!) {
  workspace(id: $workspaceId) {
    blobs {
      key
      size
      mime
      createdAt
    }
  }
}`,
};

export const releaseDeletedBlobsMutation = {
  id: 'releaseDeletedBlobsMutation' as const,
  op: 'releaseDeletedBlobs',
  query: `mutation releaseDeletedBlobs($workspaceId: String!) {
  releaseDeletedBlobs(workspaceId: $workspaceId)
}`,
};

export const setBlobMutation = {
  id: 'setBlobMutation' as const,
  op: 'setBlob',
  query: `mutation setBlob($workspaceId: String!, $blob: Upload!) {
  setBlob(workspaceId: $workspaceId, blob: $blob)
}`,
  file: true,
};

export const abortBlobUploadMutation = {
  id: 'abortBlobUploadMutation' as const,
  op: 'abortBlobUpload',
  query: `mutation abortBlobUpload($workspaceId: String!, $key: String!, $uploadId: String!) {
  abortBlobUpload(workspaceId: $workspaceId, key: $key, uploadId: $uploadId)
}`,
};

export const completeBlobUploadMutation = {
  id: 'completeBlobUploadMutation' as const,
  op: 'completeBlobUpload',
  query: `mutation completeBlobUpload($workspaceId: String!, $key: String!, $uploadId: String, $parts: [BlobUploadPartInput!]) {
  completeBlobUpload(
    workspaceId: $workspaceId
    key: $key
    uploadId: $uploadId
    parts: $parts
  )
}`,
};

export const createBlobUploadMutation = {
  id: 'createBlobUploadMutation' as const,
  op: 'createBlobUpload',
  query: `mutation createBlobUpload($workspaceId: String!, $key: String!, $size: Int!, $mime: String!) {
  createBlobUpload(workspaceId: $workspaceId, key: $key, size: $size, mime: $mime) {
    method
    blobKey
    alreadyUploaded
    uploadUrl
    headers
    expiresAt
    uploadId
    partSize
    uploadedParts {
      partNumber
      etag
    }
  }
}`,
};

export const getBlobUploadPartUrlQuery = {
  id: 'getBlobUploadPartUrlQuery' as const,
  op: 'getBlobUploadPartUrl',
  query: `query getBlobUploadPartUrl($workspaceId: String!, $key: String!, $uploadId: String!, $partNumber: Int!) {
  workspace(id: $workspaceId) {
    blobUploadPartUrl(key: $key, uploadId: $uploadId, partNumber: $partNumber) {
      uploadUrl
      headers
      expiresAt
    }
  }
}`,
};

export const changeEmailMutation = {
  id: 'changeEmailMutation' as const,
  op: 'changeEmail',
  query: `mutation changeEmail($token: String!, $email: String!) {
  changeEmail(token: $token, email: $email) {
    id
    email
  }
}`,
};

export const changePasswordMutation = {
  id: 'changePasswordMutation' as const,
  op: 'changePassword',
  query: `mutation changePassword($token: String!, $userId: String!, $newPassword: String!) {
  changePassword(token: $token, userId: $userId, newPassword: $newPassword)
}`,
};

export const changePasswordDirectMutation = {
  id: 'changePasswordDirectMutation' as const,
  op: 'changePassword',
  query: `mutation changePassword($currentPassword: String!, $newPassword: String!) {
  changePassword(currentPassword: $currentPassword, newPassword: $newPassword)
}`,
};

export const listCommentChangesQuery = {
  id: 'listCommentChangesQuery' as const,
  op: 'listCommentChanges',
  query: `query listCommentChanges($workspaceId: String!, $docId: String!, $pagination: PaginationInput!) {
  workspace(id: $workspaceId) {
    commentChanges(docId: $docId, pagination: $pagination) {
      totalCount
      edges {
        cursor
        node {
          action
          id
          commentId
          item
        }
      }
      pageInfo {
        startCursor
        endCursor
        hasNextPage
        hasPreviousPage
      }
    }
  }
}`,
};

export const createCommentMutation = {
  id: 'createCommentMutation' as const,
  op: 'createComment',
  query: `mutation createComment($input: CommentCreateInput!) {
  createComment(input: $input) {
    id
    content
    resolved
    createdAt
    updatedAt
    user {
      id
      name
      avatarUrl
    }
    replies {
      commentId
      id
      content
      createdAt
      updatedAt
      user {
        id
        name
        avatarUrl
      }
    }
  }
}`,
};

export const deleteCommentMutation = {
  id: 'deleteCommentMutation' as const,
  op: 'deleteComment',
  query: `mutation deleteComment($id: String!) {
  deleteComment(id: $id)
}`,
};

export const listCommentsQuery = {
  id: 'listCommentsQuery' as const,
  op: 'listComments',
  query: `query listComments($workspaceId: String!, $docId: String!, $pagination: PaginationInput) {
  workspace(id: $workspaceId) {
    comments(docId: $docId, pagination: $pagination) {
      totalCount
      edges {
        cursor
        node {
          id
          content
          resolved
          createdAt
          updatedAt
          user {
            id
            name
            avatarUrl
          }
          replies {
            commentId
            id
            content
            createdAt
            updatedAt
            user {
              id
              name
              avatarUrl
            }
          }
        }
      }
      pageInfo {
        startCursor
        endCursor
        hasNextPage
        hasPreviousPage
      }
    }
  }
}`,
};

export const createReplyMutation = {
  id: 'createReplyMutation' as const,
  op: 'createReply',
  query: `mutation createReply($input: ReplyCreateInput!) {
  createReply(input: $input) {
    commentId
    id
    content
    createdAt
    updatedAt
    user {
      id
      name
      avatarUrl
    }
  }
}`,
};

export const deleteReplyMutation = {
  id: 'deleteReplyMutation' as const,
  op: 'deleteReply',
  query: `mutation deleteReply($id: String!) {
  deleteReply(id: $id)
}`,
};

export const updateReplyMutation = {
  id: 'updateReplyMutation' as const,
  op: 'updateReply',
  query: `mutation updateReply($input: ReplyUpdateInput!) {
  updateReply(input: $input)
}`,
};

export const resolveCommentMutation = {
  id: 'resolveCommentMutation' as const,
  op: 'resolveComment',
  query: `mutation resolveComment($input: CommentResolveInput!) {
  resolveComment(input: $input)
}`,
};

export const updateCommentMutation = {
  id: 'updateCommentMutation' as const,
  op: 'updateComment',
  query: `mutation updateComment($input: CommentUpdateInput!) {
  updateComment(input: $input)
}`,
};

export const uploadCommentAttachmentMutation = {
  id: 'uploadCommentAttachmentMutation' as const,
  op: 'uploadCommentAttachment',
  query: `mutation uploadCommentAttachment($workspaceId: String!, $docId: String!, $attachment: Upload!) {
  uploadCommentAttachment(
    workspaceId: $workspaceId
    docId: $docId
    attachment: $attachment
  )
}`,
  file: true,
};

export const createWorkspaceMutation = {
  id: 'createWorkspaceMutation' as const,
  op: 'createWorkspace',
  query: `mutation createWorkspace {
  createWorkspace {
    id
    public
    createdAt
  }
}`,
};

export const deleteAccountMutation = {
  id: 'deleteAccountMutation' as const,
  op: 'deleteAccount',
  query: `mutation deleteAccount {
  deleteAccount {
    success
  }
}`,
};

export const deleteWorkspaceMutation = {
  id: 'deleteWorkspaceMutation' as const,
  op: 'deleteWorkspace',
  query: `mutation deleteWorkspace($id: String!) {
  deleteWorkspace(id: $id)
}`,
};

export const getDocRolePermissionsQuery = {
  id: 'getDocRolePermissionsQuery' as const,
  op: 'getDocRolePermissions',
  query: `query getDocRolePermissions($workspaceId: String!, $docId: String!) {
  workspace(id: $workspaceId) {
    doc(docId: $docId) {
      permissions {
        Doc_Copy
        Doc_Delete
        Doc_Duplicate
        Doc_Properties_Read
        Doc_Properties_Update
        Doc_Publish
        Doc_Read
        Doc_Restore
        Doc_TransferOwner
        Doc_Trash
        Doc_Update
        Doc_Users_Manage
        Doc_Users_Read
        Doc_Comments_Create
        Doc_Comments_Delete
        Doc_Comments_Read
        Doc_Comments_Resolve
      }
    }
  }
}`,
};

export const getCurrentUserFeaturesQuery = {
  id: 'getCurrentUserFeaturesQuery' as const,
  op: 'getCurrentUserFeatures',
  query: `query getCurrentUserFeatures {
  currentUser {
    id
    name
    email
    emailVerified
    avatarUrl
    features
  }
}`,
};

export const getCurrentUserProfileQuery = {
  id: 'getCurrentUserProfileQuery' as const,
  op: 'getCurrentUserProfile',
  query: `query getCurrentUserProfile {
  currentUser {
    ...CurrentUserProfile
  }
}
${currentUserProfileFragment}`,
};

export const getCurrentUserQuery = {
  id: 'getCurrentUserQuery' as const,
  op: 'getCurrentUser',
  query: `query getCurrentUser {
  currentUser {
    id
    name
    email
    emailVerified
    avatarUrl
    token {
      sessionToken
    }
  }
}`,
  deprecations: ["'token' is deprecated: use [/api/auth/sign-in?native=true] instead"],
};

export const getDocCreatedByUpdatedByListQuery = {
  id: 'getDocCreatedByUpdatedByListQuery' as const,
  op: 'getDocCreatedByUpdatedByList',
  query: `query getDocCreatedByUpdatedByList($workspaceId: String!, $pagination: PaginationInput!) {
  workspace(id: $workspaceId) {
    docs(pagination: $pagination) {
      totalCount
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          id
          creatorId
          lastUpdaterId
        }
      }
    }
  }
}`,
};

export const getDocDefaultRoleQuery = {
  id: 'getDocDefaultRoleQuery' as const,
  op: 'getDocDefaultRole',
  query: `query getDocDefaultRole($workspaceId: String!, $docId: String!) {
  workspace(id: $workspaceId) {
    doc(docId: $docId) {
      defaultRole
    }
  }
}`,
};

export const getDocSummaryQuery = {
  id: 'getDocSummaryQuery' as const,
  op: 'getDocSummary',
  query: `query getDocSummary($workspaceId: String!, $docId: String!) {
  workspace(id: $workspaceId) {
    doc(docId: $docId) {
      summary
    }
  }
}`,
};

export const getInviteInfoQuery = {
  id: 'getInviteInfoQuery' as const,
  op: 'getInviteInfo',
  query: `query getInviteInfo($inviteId: String!) {
  getInviteInfo(inviteId: $inviteId) {
    workspace {
      id
      name
      avatar
    }
    user {
      id
      name
      avatarUrl
    }
    status
    invitee {
      id
      name
      email
      avatarUrl
    }
  }
}`,
};

export const getMemberCountByWorkspaceIdQuery = {
  id: 'getMemberCountByWorkspaceIdQuery' as const,
  op: 'getMemberCountByWorkspaceId',
  query: `query getMemberCountByWorkspaceId($workspaceId: String!) {
  workspace(id: $workspaceId) {
    memberCount
  }
}`,
};

export const getMembersByWorkspaceIdQuery = {
  id: 'getMembersByWorkspaceIdQuery' as const,
  op: 'getMembersByWorkspaceId',
  query: `query getMembersByWorkspaceId($workspaceId: String!, $skip: Int, $take: Int, $query: String) {
  workspace(id: $workspaceId) {
    memberCount
    members(skip: $skip, take: $take, query: $query) {
      id
      name
      email
      avatarUrl
      permission
      inviteId
      emailVerified
      status
    }
  }
}`,
  deprecations: ["'permission' is deprecated: Use role instead"],
};

export const oauthProvidersQuery = {
  id: 'oauthProvidersQuery' as const,
  op: 'oauthProviders',
  query: `query oauthProviders {
  serverConfig {
    oauthProviders
  }
}`,
};

export const getPageGrantedUsersListQuery = {
  id: 'getPageGrantedUsersListQuery' as const,
  op: 'getPageGrantedUsersList',
  query: `query getPageGrantedUsersList($pagination: PaginationInput!, $docId: String!, $workspaceId: String!) {
  workspace(id: $workspaceId) {
    doc(docId: $docId) {
      grantedUsersList(pagination: $pagination) {
        totalCount
        pageInfo {
          endCursor
          hasNextPage
        }
        edges {
          node {
            role
            user {
              id
              name
              email
              avatarUrl
            }
          }
        }
      }
    }
  }
}`,
};

export const getPublicUserByIdQuery = {
  id: 'getPublicUserByIdQuery' as const,
  op: 'getPublicUserById',
  query: `query getPublicUserById($id: String!) {
  publicUserById(id: $id) {
    id
    avatarUrl
    name
  }
}`,
};

export const getRecentlyUpdatedDocsQuery = {
  id: 'getRecentlyUpdatedDocsQuery' as const,
  op: 'getRecentlyUpdatedDocs',
  query: `query getRecentlyUpdatedDocs($workspaceId: String!, $pagination: PaginationInput!) {
  workspace(id: $workspaceId) {
    recentlyUpdatedDocs(pagination: $pagination) {
      totalCount
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          id
          title
          createdAt
          updatedAt
          creatorId
          lastUpdaterId
        }
      }
    }
  }
}`,
};

export const getUserFeaturesQuery = {
  id: 'getUserFeaturesQuery' as const,
  op: 'getUserFeatures',
  query: `query getUserFeatures {
  currentUser {
    id
    features
  }
}`,
};

export const getUserSettingsQuery = {
  id: 'getUserSettingsQuery' as const,
  op: 'getUserSettings',
  query: `query getUserSettings {
  currentUser {
    settings {
      receiveInvitationEmail
      receiveMentionEmail
      receiveCommentEmail
    }
  }
}`,
};

export const getUserQuery = {
  id: 'getUserQuery' as const,
  op: 'getUser',
  query: `query getUser($email: String!) {
  user(email: $email) {
    __typename
    ... on UserType {
      id
      name
      avatarUrl
      email
      hasPassword
    }
    ... on LimitedUserType {
      email
      hasPassword
    }
  }
}`,
};

export const getWorkspaceInfoQuery = {
  id: 'getWorkspaceInfoQuery' as const,
  op: 'getWorkspaceInfo',
  query: `query getWorkspaceInfo($workspaceId: String!) {
  workspace(id: $workspaceId) {
    permissions {
      Workspace_Administrators_Manage
      Workspace_Blobs_List
      Workspace_Blobs_Read
      Workspace_Blobs_Write
      Workspace_Copilot
      Workspace_CreateDoc
      Workspace_Delete
      Workspace_Organize_Read
      Workspace_Payment_Manage
      Workspace_Properties_Create
      Workspace_Properties_Delete
      Workspace_Properties_Read
      Workspace_Properties_Update
      Workspace_Read
      Workspace_Settings_Read
      Workspace_Settings_Update
      Workspace_Sync
      Workspace_TransferOwner
      Workspace_Users_Manage
      Workspace_Users_Read
    }
    role
    team
  }
}`,
};

export const getWorkspacePageByIdQuery = {
  id: 'getWorkspacePageByIdQuery' as const,
  op: 'getWorkspacePageById',
  query: `query getWorkspacePageById($workspaceId: String!, $pageId: String!) {
  workspace(id: $workspaceId) {
    doc(docId: $pageId) {
      id
      mode
      defaultRole
      public
      title
      summary
    }
  }
}`,
};

export const getWorkspacePageMetaByIdQuery = {
  id: 'getWorkspacePageMetaByIdQuery' as const,
  op: 'getWorkspacePageMetaById',
  query: `query getWorkspacePageMetaById($id: String!, $pageId: String!) {
  workspace(id: $id) {
    pageMeta(pageId: $pageId) {
      createdAt
      updatedAt
      createdBy {
        name
        avatarUrl
      }
      updatedBy {
        name
        avatarUrl
      }
    }
  }
}`,
  deprecations: ["'pageMeta' is deprecated: use [WorkspaceType.doc] instead"],
};

export const getWorkspacePublicByIdQuery = {
  id: 'getWorkspacePublicByIdQuery' as const,
  op: 'getWorkspacePublicById',
  query: `query getWorkspacePublicById($id: String!) {
  workspace(id: $id) {
    public
  }
}`,
};

export const getWorkspacePublicPagesQuery = {
  id: 'getWorkspacePublicPagesQuery' as const,
  op: 'getWorkspacePublicPages',
  query: `query getWorkspacePublicPages($workspaceId: String!) {
  workspace(id: $workspaceId) {
    publicDocs {
      id
      mode
    }
  }
}`,
};

export const getWorkspaceQuery = {
  id: 'getWorkspaceQuery' as const,
  op: 'getWorkspace',
  query: `query getWorkspace($id: String!) {
  workspace(id: $id) {
    id
  }
}`,
};

export const getWorkspacesQuery = {
  id: 'getWorkspacesQuery' as const,
  op: 'getWorkspaces',
  query: `query getWorkspaces {
  workspaces {
    id
    initialized
    team
    owner {
      id
    }
  }
}`,
};

export const grantDocUserRolesMutation = {
  id: 'grantDocUserRolesMutation' as const,
  op: 'grantDocUserRoles',
  query: `mutation grantDocUserRoles($input: GrantDocUserRolesInput!) {
  grantDocUserRoles(input: $input)
}`,
};

export const listHistoryQuery = {
  id: 'listHistoryQuery' as const,
  op: 'listHistory',
  query: `query listHistory($workspaceId: String!, $pageDocId: String!, $take: Int, $before: DateTime) {
  workspace(id: $workspaceId) {
    histories(guid: $pageDocId, take: $take, before: $before) {
      id
      timestamp
      editor {
        name
        avatarUrl
      }
    }
  }
}`,
};

export const indexerAggregateQuery = {
  id: 'indexerAggregateQuery' as const,
  op: 'indexerAggregate',
  query: `query indexerAggregate($id: String!, $input: AggregateInput!) {
  workspace(id: $id) {
    aggregate(input: $input) {
      buckets {
        key
        count
        hits {
          nodes {
            fields
            highlights
          }
        }
      }
      pagination {
        count
        hasMore
        nextCursor
      }
    }
  }
}`,
};

export const indexerSearchDocsQuery = {
  id: 'indexerSearchDocsQuery' as const,
  op: 'indexerSearchDocs',
  query: `query indexerSearchDocs($id: String!, $input: SearchDocsInput!) {
  workspace(id: $id) {
    searchDocs(input: $input) {
      docId
      title
      blockId
      highlight
      createdAt
      updatedAt
      createdByUser {
        id
        name
        avatarUrl
      }
      updatedByUser {
        id
        name
        avatarUrl
      }
    }
  }
}`,
};

export const indexerSearchQuery = {
  id: 'indexerSearchQuery' as const,
  op: 'indexerSearch',
  query: `query indexerSearch($id: String!, $input: SearchInput!) {
  workspace(id: $id) {
    search(input: $input) {
      nodes {
        fields
        highlights
      }
      pagination {
        count
        hasMore
        nextCursor
      }
    }
  }
}`,
};

export const leaveWorkspaceMutation = {
  id: 'leaveWorkspaceMutation' as const,
  op: 'leaveWorkspace',
  query: `mutation leaveWorkspace($workspaceId: String!, $sendLeaveMail: Boolean) {
  leaveWorkspace(workspaceId: $workspaceId, sendLeaveMail: $sendLeaveMail)
}`,
};

export const listNotificationsQuery = {
  id: 'listNotificationsQuery' as const,
  op: 'listNotifications',
  query: `query listNotifications($pagination: PaginationInput!) {
  currentUser {
    notifications(pagination: $pagination) {
      totalCount
      edges {
        cursor
        node {
          id
          type
          level
          read
          createdAt
          updatedAt
          body
        }
      }
      pageInfo {
        startCursor
        endCursor
        hasNextPage
        hasPreviousPage
      }
    }
  }
}`,
};

export const mentionUserMutation = {
  id: 'mentionUserMutation' as const,
  op: 'mentionUser',
  query: `mutation mentionUser($input: MentionInput!) {
  mentionUser(input: $input)
}`,
};

export const notificationCountQuery = {
  id: 'notificationCountQuery' as const,
  op: 'notificationCount',
  query: `query notificationCount {
  currentUser {
    notifications(pagination: {first: 1}) {
      totalCount
    }
  }
}`,
};

export const publishPageMutation = {
  id: 'publishPageMutation' as const,
  op: 'publishPage',
  query: `mutation publishPage($workspaceId: String!, $pageId: String!, $mode: PublicDocMode = Page) {
  publishDoc(workspaceId: $workspaceId, docId: $pageId, mode: $mode) {
    id
    mode
  }
}`,
};

export const quotaQuery = {
  id: 'quotaQuery' as const,
  op: 'quota',
  query: `query quota {
  currentUser {
    id
    quota {
      name
      blobLimit
      storageQuota
      historyPeriod
      memberLimit
      humanReadable {
        name
        blobLimit
        storageQuota
        historyPeriod
        memberLimit
      }
    }
    quotaUsage {
      storageQuota
    }
  }
}`,
  deprecations: ["'storageQuota' is deprecated: use `UserQuotaType['usedStorageQuota']` instead"],
};

export const readAllNotificationsMutation = {
  id: 'readAllNotificationsMutation' as const,
  op: 'readAllNotifications',
  query: `mutation readAllNotifications {
  readAllNotifications
}`,
};

export const readNotificationMutation = {
  id: 'readNotificationMutation' as const,
  op: 'readNotification',
  query: `mutation readNotification($id: String!) {
  readNotification(id: $id)
}`,
};

export const recoverDocMutation = {
  id: 'recoverDocMutation' as const,
  op: 'recoverDoc',
  query: `mutation recoverDoc($workspaceId: String!, $docId: String!, $timestamp: DateTime!) {
  recoverDoc(workspaceId: $workspaceId, guid: $docId, timestamp: $timestamp)
}`,
};

export const removeAvatarMutation = {
  id: 'removeAvatarMutation' as const,
  op: 'removeAvatar',
  query: `mutation removeAvatar {
  removeAvatar {
    success
  }
}`,
};

export const revokeDocUserRolesMutation = {
  id: 'revokeDocUserRolesMutation' as const,
  op: 'revokeDocUserRoles',
  query: `mutation revokeDocUserRoles($input: RevokeDocUserRoleInput!) {
  revokeDocUserRoles(input: $input)
}`,
};

export const revokeMemberPermissionMutation = {
  id: 'revokeMemberPermissionMutation' as const,
  op: 'revokeMemberPermission',
  query: `mutation revokeMemberPermission($workspaceId: String!, $userId: String!) {
  revokeMember(workspaceId: $workspaceId, userId: $userId)
}`,
};

export const revokePublicPageMutation = {
  id: 'revokePublicPageMutation' as const,
  op: 'revokePublicPage',
  query: `mutation revokePublicPage($workspaceId: String!, $pageId: String!) {
  revokePublicDoc(workspaceId: $workspaceId, docId: $pageId) {
    id
    mode
    public
  }
}`,
};

export const sendChangeEmailMutation = {
  id: 'sendChangeEmailMutation' as const,
  op: 'sendChangeEmail',
  query: `mutation sendChangeEmail($callbackUrl: String!) {
  sendChangeEmail(callbackUrl: $callbackUrl)
}`,
};

export const sendChangePasswordEmailMutation = {
  id: 'sendChangePasswordEmailMutation' as const,
  op: 'sendChangePasswordEmail',
  query: `mutation sendChangePasswordEmail($callbackUrl: String!) {
  sendChangePasswordEmail(callbackUrl: $callbackUrl)
}`,
};

export const sendSetPasswordEmailMutation = {
  id: 'sendSetPasswordEmailMutation' as const,
  op: 'sendSetPasswordEmail',
  query: `mutation sendSetPasswordEmail($callbackUrl: String!) {
  sendSetPasswordEmail(callbackUrl: $callbackUrl)
}`,
};

export const sendVerifyChangeEmailMutation = {
  id: 'sendVerifyChangeEmailMutation' as const,
  op: 'sendVerifyChangeEmail',
  query: `mutation sendVerifyChangeEmail($token: String!, $email: String!, $callbackUrl: String!) {
  sendVerifyChangeEmail(token: $token, email: $email, callbackUrl: $callbackUrl)
}`,
};

export const sendVerifyEmailMutation = {
  id: 'sendVerifyEmailMutation' as const,
  op: 'sendVerifyEmail',
  query: `mutation sendVerifyEmail($callbackUrl: String!) {
  sendVerifyEmail(callbackUrl: $callbackUrl)
}`,
};

export const serverConfigQuery = {
  id: 'serverConfigQuery' as const,
  op: 'serverConfig',
  query: `query serverConfig {
  serverConfig {
    version
    baseUrl
    name
    features
    type
    initialized
    defaultLanguage
    credentialsRequirement {
      ...CredentialsRequirements
    }
  }
}
${passwordLimitsFragment}
${credentialsRequirementsFragment}`,
};

export const setWorkspacePublicByIdMutation = {
  id: 'setWorkspacePublicByIdMutation' as const,
  op: 'setWorkspacePublicById',
  query: `mutation setWorkspacePublicById($id: ID!, $public: Boolean!) {
  updateWorkspace(input: {id: $id, public: $public}) {
    id
  }
}`,
};

export const updateDocDefaultRoleMutation = {
  id: 'updateDocDefaultRoleMutation' as const,
  op: 'updateDocDefaultRole',
  query: `mutation updateDocDefaultRole($input: UpdateDocDefaultRoleInput!) {
  updateDocDefaultRole(input: $input)
}`,
};

export const updateDocUserRoleMutation = {
  id: 'updateDocUserRoleMutation' as const,
  op: 'updateDocUserRole',
  query: `mutation updateDocUserRole($input: UpdateDocUserRoleInput!) {
  updateDocUserRole(input: $input)
}`,
};

export const updateUserProfileMutation = {
  id: 'updateUserProfileMutation' as const,
  op: 'updateUserProfile',
  query: `mutation updateUserProfile($input: UpdateUserInput!) {
  updateProfile(input: $input) {
    id
    name
  }
}`,
};

export const updateUserSettingsMutation = {
  id: 'updateUserSettingsMutation' as const,
  op: 'updateUserSettings',
  query: `mutation updateUserSettings($input: UpdateUserSettingsInput!) {
  updateSettings(input: $input)
}`,
};

export const uploadAvatarMutation = {
  id: 'uploadAvatarMutation' as const,
  op: 'uploadAvatar',
  query: `mutation uploadAvatar($avatar: Upload!) {
  uploadAvatar(avatar: $avatar) {
    id
    name
    avatarUrl
    email
  }
}`,
  file: true,
};

export const verifyEmailMutation = {
  id: 'verifyEmailMutation' as const,
  op: 'verifyEmail',
  query: `mutation verifyEmail($token: String!) {
  verifyEmail(token: $token)
}`,
};

export const workspaceBlobQuotaQuery = {
  id: 'workspaceBlobQuotaQuery' as const,
  op: 'workspaceBlobQuota',
  query: `query workspaceBlobQuota($id: String!) {
  workspace(id: $id) {
    quota {
      blobLimit
      humanReadable {
        blobLimit
      }
    }
  }
}`,
};

export const getWorkspaceConfigQuery = {
  id: 'getWorkspaceConfigQuery' as const,
  op: 'getWorkspaceConfig',
  query: `query getWorkspaceConfig($id: String!) {
  workspace(id: $id) {
    enableAi
    enableSharing
    enableUrlPreview
    enableDocEmbedding
    inviteLink {
      link
      expireTime
    }
  }
}`,
};

export const setEnableAiMutation = {
  id: 'setEnableAiMutation' as const,
  op: 'setEnableAi',
  query: `mutation setEnableAi($id: ID!, $enableAi: Boolean!) {
  updateWorkspace(input: {id: $id, enableAi: $enableAi}) {
    id
  }
}`,
};

export const setEnableDocEmbeddingMutation = {
  id: 'setEnableDocEmbeddingMutation' as const,
  op: 'setEnableDocEmbedding',
  query: `mutation setEnableDocEmbedding($id: ID!, $enableDocEmbedding: Boolean!) {
  updateWorkspace(input: {id: $id, enableDocEmbedding: $enableDocEmbedding}) {
    id
  }
}`,
};

export const setEnableSharingMutation = {
  id: 'setEnableSharingMutation' as const,
  op: 'setEnableSharing',
  query: `mutation setEnableSharing($id: ID!, $enableSharing: Boolean!) {
  updateWorkspace(input: {id: $id, enableSharing: $enableSharing}) {
    id
  }
}`,
};

export const setEnableUrlPreviewMutation = {
  id: 'setEnableUrlPreviewMutation' as const,
  op: 'setEnableUrlPreview',
  query: `mutation setEnableUrlPreview($id: ID!, $enableUrlPreview: Boolean!) {
  updateWorkspace(input: {id: $id, enableUrlPreview: $enableUrlPreview}) {
    id
  }
}`,
};

export const inviteByEmailsMutation = {
  id: 'inviteByEmailsMutation' as const,
  op: 'inviteByEmails',
  query: `mutation inviteByEmails($workspaceId: String!, $emails: [String!]!) {
  inviteMembers(workspaceId: $workspaceId, emails: $emails) {
    email
    inviteId
    sentSuccess
  }
}`,
  deprecations: ["'sentSuccess' is deprecated: Notification will be sent asynchronously"],
};

export const acceptInviteByInviteIdMutation = {
  id: 'acceptInviteByInviteIdMutation' as const,
  op: 'acceptInviteByInviteId',
  query: `mutation acceptInviteByInviteId($workspaceId: String!, $inviteId: String!) {
  acceptInviteById(workspaceId: $workspaceId, inviteId: $inviteId)
}`,
};

export const createInviteLinkMutation = {
  id: 'createInviteLinkMutation' as const,
  op: 'createInviteLink',
  query: `mutation createInviteLink($workspaceId: String!, $expireTime: WorkspaceInviteLinkExpireTime!) {
  createInviteLink(workspaceId: $workspaceId, expireTime: $expireTime) {
    link
    expireTime
  }
}`,
};

export const revokeInviteLinkMutation = {
  id: 'revokeInviteLinkMutation' as const,
  op: 'revokeInviteLink',
  query: `mutation revokeInviteLink($workspaceId: String!) {
  revokeInviteLink(workspaceId: $workspaceId)
}`,
};

export const workspaceQuotaQuery = {
  id: 'workspaceQuotaQuery' as const,
  op: 'workspaceQuota',
  query: `query workspaceQuota($id: String!) {
  workspace(id: $id) {
    quota {
      name
      blobLimit
      storageQuota
      usedStorageQuota
      historyPeriod
      memberLimit
      memberCount
      overcapacityMemberCount
      humanReadable {
        name
        blobLimit
        storageQuota
        historyPeriod
        memberLimit
        memberCount
        overcapacityMemberCount
      }
    }
  }
}`,
};

export const getWorkspaceRolePermissionsQuery = {
  id: 'getWorkspaceRolePermissionsQuery' as const,
  op: 'getWorkspaceRolePermissions',
  query: `query getWorkspaceRolePermissions($id: String!) {
  workspaceRolePermissions(id: $id) {
    permissions {
      Workspace_Administrators_Manage
      Workspace_Blobs_List
      Workspace_Blobs_Read
      Workspace_Blobs_Write
      Workspace_Copilot
      Workspace_CreateDoc
      Workspace_Delete
      Workspace_Organize_Read
      Workspace_Payment_Manage
      Workspace_Properties_Create
      Workspace_Properties_Delete
      Workspace_Properties_Read
      Workspace_Properties_Update
      Workspace_Read
      Workspace_Settings_Read
      Workspace_Settings_Update
      Workspace_Sync
      Workspace_TransferOwner
      Workspace_Users_Manage
      Workspace_Users_Read
    }
  }
}`,
  deprecations: ["'workspaceRolePermissions' is deprecated: use WorkspaceType[permissions] instead"],
};

export const approveWorkspaceTeamMemberMutation = {
  id: 'approveWorkspaceTeamMemberMutation' as const,
  op: 'approveWorkspaceTeamMember',
  query: `mutation approveWorkspaceTeamMember($workspaceId: String!, $userId: String!) {
  approveMember(workspaceId: $workspaceId, userId: $userId)
}`,
};

export const grantWorkspaceTeamMemberMutation = {
  id: 'grantWorkspaceTeamMemberMutation' as const,
  op: 'grantWorkspaceTeamMember',
  query: `mutation grantWorkspaceTeamMember($workspaceId: String!, $userId: String!, $permission: Permission!) {
  grantMember(workspaceId: $workspaceId, userId: $userId, permission: $permission)
}`,
};

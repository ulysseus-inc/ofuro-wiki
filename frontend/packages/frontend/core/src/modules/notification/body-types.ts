import type { DocMode } from '@blocksuite/affine/model';
import type { NotificationType, PublicUserType } from '@ofuro/graphql';

/**
 * 通知の本文（`NotificationObjectType.body`）の型。
 *
 * #210: 以前は `@ofuro/graphql` の手書きの `schema.ts` にあった（AFFiNE 由来）。
 * バックエンドは本文を `JSON` で返すため、スキーマには載らない。中身の解釈は
 * クライアントの責務なので、通知のモジュールに置く。
 *
 * ⚠️ 型の保証は無い（`notification.body as MentionNotificationBodyType` のように読み替える）。
 * バックエンドが書く本文は notification.service.ts を参照。
 */

export interface InvitationAcceptedNotificationBodyType {
  __typename?: 'InvitationAcceptedNotificationBodyType';
  /** The user who created the notification, maybe null when user is deleted or sent by system */
  createdByUser: PublicUserType | null;
  inviteId: string;
  /** The type of the notification */
  type: NotificationType;
  workspace: NotificationWorkspaceType | null;
}

export interface InvitationBlockedNotificationBodyType {
  __typename?: 'InvitationBlockedNotificationBodyType';
  /** The user who created the notification, maybe null when user is deleted or sent by system */
  createdByUser: PublicUserType | null;
  inviteId: string;
  /** The type of the notification */
  type: NotificationType;
  workspace: NotificationWorkspaceType | null;
}

export interface InvitationNotificationBodyType {
  __typename?: 'InvitationNotificationBodyType';
  /** The user who created the notification, maybe null when user is deleted or sent by system */
  createdByUser: PublicUserType | null;
  inviteId: string;
  /** The type of the notification */
  type: NotificationType;
  workspace: NotificationWorkspaceType | null;
}

export interface InvitationReviewApprovedNotificationBodyType {
  __typename?: 'InvitationReviewApprovedNotificationBodyType';
  /** The user who created the notification, maybe null when user is deleted or sent by system */
  createdByUser: PublicUserType | null;
  inviteId: string;
  /** The type of the notification */
  type: NotificationType;
  workspace: NotificationWorkspaceType | null;
}

export interface InvitationReviewDeclinedNotificationBodyType {
  __typename?: 'InvitationReviewDeclinedNotificationBodyType';
  /** The user who created the notification, maybe null when user is deleted or sent by system */
  createdByUser: PublicUserType | null;
  /** The type of the notification */
  type: NotificationType;
  workspace: NotificationWorkspaceType | null;
}

export interface InvitationReviewRequestNotificationBodyType {
  __typename?: 'InvitationReviewRequestNotificationBodyType';
  /** The user who created the notification, maybe null when user is deleted or sent by system */
  createdByUser: PublicUserType | null;
  inviteId: string;
  /** The type of the notification */
  type: NotificationType;
  workspace: NotificationWorkspaceType | null;
}

export interface MentionNotificationBodyType {
  __typename?: 'MentionNotificationBodyType';
  /** The user who created the notification, maybe null when user is deleted or sent by system */
  createdByUser: PublicUserType | null;
  doc: MentionDocType;
  /** The type of the notification */
  type: NotificationType;
  workspace: NotificationWorkspaceType | null;
}

export interface MentionDocType {
  __typename?: 'MentionDocType';
  blockId: string | null;
  elementId: string | null;
  id: string;
  mode: DocMode;
  title: string;
}

export interface NotificationWorkspaceType {
  __typename?: 'NotificationWorkspaceType';
  /** Workspace avatar url */
  avatarUrl: string | null;
  id: string;
  /** Workspace name */
  name: string;
}

export type UnionNotificationBodyType =
  | InvitationAcceptedNotificationBodyType
  | InvitationBlockedNotificationBodyType
  | InvitationNotificationBodyType
  | InvitationReviewApprovedNotificationBodyType
  | InvitationReviewDeclinedNotificationBodyType
  | InvitationReviewRequestNotificationBodyType
  | MentionNotificationBodyType;

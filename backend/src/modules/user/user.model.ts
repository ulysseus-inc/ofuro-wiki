import {
  ObjectType,
  Field,
  ID,
  Int,
  InputType,
  ArgsType,
  registerEnumType,
} from '@nestjs/graphql';
import { IsBoolean, IsOptional } from 'class-validator';
import GraphQLJSON from 'graphql-type-json';

@ObjectType('RevealedAccessToken')
export class RevealedAccessTokenType {
  @Field() id: string;
  @Field() name: string;
  @Field() createdAt: Date;
  @Field({ nullable: true }) expiresAt?: Date;
  @Field() token: string;
}

@ObjectType()
class TokenType {
  @Field({ nullable: true })
  sessionToken?: string;
}

@InputType('PaginationInput')
export class PaginationInput {
  @Field(() => Int, { nullable: true })
  first?: number;

  @Field({ nullable: true })
  after?: string;

  @Field(() => Int, { nullable: true })
  last?: number;

  @Field({ nullable: true })
  before?: string;
}

@ObjectType()
export class PageInfo {
  @Field({ nullable: true })
  startCursor?: string;

  @Field({ nullable: true })
  endCursor?: string;

  @Field()
  hasNextPage: boolean;

  @Field()
  hasPreviousPage: boolean;
}

/**
 * #210: 通知の種類。フロントエンドが値として比べる（`type === NotificationType.Mention`）。
 *
 * ⚠️ 以前はこの名前が**通知のオブジェクト型**だった。フロントエンドの `schema.ts` を生成物にすると、
 * 列挙が同名のオブジェクト型に入れ替わり、比較が常に偽になって**通知が1件も描画されなくなる**。
 * オブジェクト型は `NotificationObjectType` に改名した。
 *
 * 作るのは `Comment` / `Mention` / `CommentMention`（notification.service.ts）。
 */
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

registerEnumType(NotificationType, { name: 'NotificationType' });

/**
 * #210: ユーザーの機能。フロントエンドは `features.some(f => f === FeatureType.Admin)` で
 * **管理者かどうかを判定する**。スキーマに無いと比較が常に偽になり、管理画面の入口が消える。
 * 返すのは `Admin`（管理者のみ・user.resolver.ts）。
 */
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

registerEnumType(FeatureType, { name: 'FeatureType' });

@ObjectType('NotificationObjectType')
class NotificationObjectType {
  @Field(() => ID)
  id: string;

  @Field(() => NotificationType)
  type: NotificationType;

  @Field()
  level: string;

  @Field()
  read: boolean;

  @Field(() => GraphQLJSON, { nullable: true })
  body?: any;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}

@ObjectType()
class NotificationEdge {
  @Field()
  cursor: string;

  @Field(() => NotificationObjectType)
  node: NotificationObjectType;
}

@ObjectType('PaginatedNotificationObjectType')
export class PaginatedNotificationType {
  @Field(() => Int)
  totalCount: number;

  @Field(() => [NotificationEdge])
  edges: NotificationEdge[];

  @Field(() => PageInfo)
  pageInfo: PageInfo;
}

@ObjectType()
class UserQuotaHumanReadable {
  @Field() name: string;
  @Field() blobLimit: string;
  @Field() storageQuota: string;
  @Field() historyPeriod: string;
  @Field() memberLimit: string;
}

@ObjectType()
class UserQuota {
  @Field() name: string;
  @Field() blobLimit: number;
  @Field() storageQuota: number;
  @Field() historyPeriod: number;
  @Field() memberLimit: number;
  @Field(() => UserQuotaHumanReadable)
  humanReadable: UserQuotaHumanReadable;
}

@ObjectType()
class UserQuotaUsage {
  @Field() storageQuota: number;
}

@ObjectType()
class CopilotQuotaDetail {
  @Field({ nullable: true }) limit?: number;
  @Field({ nullable: true }) used?: number;
}

@ObjectType()
export class UserCopilot {
  @Field(() => CopilotQuotaDetail, { nullable: true })
  quota?: CopilotQuotaDetail;

  @Field(() => [String], { nullable: true })
  chats?: string[];
}

@ObjectType()
class UserSettings {
  @Field() receiveInvitationEmail: boolean;
  @Field() receiveMentionEmail: boolean;
  @Field() receiveCommentEmail: boolean;
}

@InputType('UpdateUserInput')
export class UpdateUserInput {
  @Field({ nullable: true })
  @IsOptional()
  name?: string;
}

@InputType('UpdateUserSettingsInput')
export class UpdateUserSettingsInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  receiveInvitationEmail?: boolean;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  receiveMentionEmail?: boolean;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  receiveCommentEmail?: boolean;
}

@ObjectType()
export class RemoveAvatarResult {
  @Field()
  success: boolean;
}

@ObjectType()
export class DeleteAccountResult {
  @Field()
  success: boolean;
}

@ObjectType('UserType')
export class UserType {
  @Field(() => ID)
  id: string;

  @Field()
  email: string;

  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  avatarUrl?: string;

  @Field()
  emailVerified: boolean;

  @Field()
  createdAt: Date;

  @Field({ nullable: true })
  hasPassword?: boolean;

  @Field(() => TokenType, { nullable: true })
  token?: TokenType;

  @Field(() => [FeatureType], { nullable: true })
  features?: FeatureType[];

  @Field(() => PaginatedNotificationType, { nullable: true })
  notifications?: PaginatedNotificationType;

  @Field(() => Int, { nullable: true })
  notificationCount?: number;

  @Field(() => UserQuota, { nullable: true })
  quota?: UserQuota;

  @Field(() => UserQuotaUsage, { nullable: true })
  quotaUsage?: UserQuotaUsage;

  @Field(() => UserCopilot, { nullable: true })
  copilot?: UserCopilot;

  @Field(() => UserSettings, { nullable: true })
  settings?: UserSettings;

  @Field(() => [RevealedAccessTokenType])
  revealedAccessTokens?: RevealedAccessTokenType[];

  @Field(() => [String])
  calendarAccounts?: string[];
}

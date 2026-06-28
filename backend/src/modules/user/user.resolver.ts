import { Resolver, Query, Mutation, Args, ResolveField, Parent } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { UserType, PaginatedNotificationType, PaginationInput, UserCopilot, RemoveAvatarResult, UpdateUserInput, UpdateUserSettingsInput } from './user.model';
import { UserService } from './user.service';
import { NotificationService } from '../notification/notification.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import GraphQLUpload from 'graphql-upload/GraphQLUpload.mjs';

interface FileUpload {
  filename: string;
  mimetype: string;
  encoding: string;
  createReadStream: () => NodeJS.ReadableStream;
}

@Resolver(() => UserType)
@UseGuards(JwtAuthGuard)
export class UserResolver {
  constructor(
    private userService: UserService,
    private notificationService: NotificationService,
  ) {}

  @Query(() => UserType, { nullable: true })
  async currentUser(@CurrentUser() user: { id: string }) {
    if (!user) return null;
    const dbUser = await this.userService.findById(user.id);
    if (!dbUser) return null;
    return {
      ...dbUser,
      hasPassword: !!dbUser.passwordHash,
      token: { sessionToken: null },
      features: dbUser.isAdmin ? ['Admin'] : [],
      notificationCount: await this.notificationService.getNotificationCount(user.id),
      quota: {
        name: 'Selfhosted Unlimited',
        blobLimit: 1024 * 1024 * 1024,
        storageQuota: 1024 * 1024 * 1024 * 100,
        historyPeriod: 30 * 24 * 60 * 60 * 1000,
        memberLimit: 1000,
        humanReadable: {
          name: 'Selfhosted Unlimited',
          blobLimit: '1 GB',
          storageQuota: '100 GB',
          historyPeriod: '30 days',
          memberLimit: '1000',
        },
      },
      quotaUsage: { storageQuota: 0 },
      copilot: { quota: { limit: 0, used: 0 }, chats: [] },
      settings: {
        receiveInvitationEmail: dbUser.receiveInvitationEmail,
        receiveMentionEmail: dbUser.receiveMentionEmail,
        receiveCommentEmail: dbUser.receiveCommentEmail,
      },
      revealedAccessTokens: [],
      calendarAccounts: [],
    };
  }

  @ResolveField(() => UserCopilot, { nullable: true })
  copilot(
    @Parent() _user: UserType,
    @Args('workspaceId', { type: () => String, nullable: true }) _workspaceId?: string,
  ) {
    return { quota: { limit: 0, used: 0 }, chats: [] };
  }

  @ResolveField(() => PaginatedNotificationType)
  async notifications(
    @Parent() user: UserType,
    @Args('pagination', { type: () => PaginationInput, nullable: true })
    pagination?: PaginationInput,
  ) {
    return this.notificationService.listNotifications(user.id, pagination);
  }

  @Query(() => UserType, { nullable: true })
  async publicUserById(
    @Args('id', { type: () => String }) id: string,
  ) {
    const dbUser = await this.userService.findById(id);
    if (!dbUser) return null;
    return {
      id: dbUser.id,
      name: dbUser.name,
      email: dbUser.email,
      avatarUrl: dbUser.avatarUrl,
      emailVerified: dbUser.emailVerified ?? false,
      createdAt: dbUser.createdAt,
    };
  }

  @Mutation(() => UserType)
  async updateProfile(
    @CurrentUser() user: { id: string },
    @Args('input', { type: () => UpdateUserInput }) input: UpdateUserInput,
  ) {
    return this.userService.updateUser(user.id, { name: input.name });
  }

  @Mutation(() => UserType)
  async uploadAvatar(
    @CurrentUser() user: { id: string },
    @Args('avatar', { type: () => GraphQLUpload }) avatar: FileUpload,
  ) {
    const file = await avatar;
    await this.userService.saveAvatar(user.id, file);
    const dbUser = await this.userService.findById(user.id);
    if (!dbUser) throw new Error('User not found');
    return {
      id: dbUser.id,
      name: dbUser.name,
      email: dbUser.email,
      avatarUrl: dbUser.avatarUrl,
    };
  }

  @Mutation(() => Boolean)
  async updateSettings(
    @CurrentUser() user: { id: string },
    @Args('input', { type: () => UpdateUserSettingsInput }) input: UpdateUserSettingsInput,
  ): Promise<boolean> {
    const data: Record<string, boolean> = {};
    if (input.receiveInvitationEmail != null) {
      data.receiveInvitationEmail = input.receiveInvitationEmail;
    }
    if (input.receiveMentionEmail != null) {
      data.receiveMentionEmail = input.receiveMentionEmail;
    }
    if (input.receiveCommentEmail != null) {
      data.receiveCommentEmail = input.receiveCommentEmail;
    }
    if (Object.keys(data).length > 0) {
      await this.userService.updateUser(user.id, data);
    }
    return true;
  }

  @Mutation(() => RemoveAvatarResult)
  async removeAvatar(
    @CurrentUser() user: { id: string },
  ) {
    const success = await this.userService.removeAvatar(user.id);
    return { success };
  }
}

import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { AdminOnly } from '../../common/decorators/admin.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminService } from './admin.service';
import { ScheduledBackupService } from '../backup/scheduled-backup.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../../prisma.service';
import {
  AdminUserList,
  AdminUserItem,
  AdminCreateUserInput,
  ServerSettingType,
  BackupRecordType,
  BackupRecordList,
} from './admin.model';
import GraphQLJSON from 'graphql-type-json';

@Resolver()
export class AdminResolver {
  constructor(
    private adminService: AdminService,
    private scheduledBackupService: ScheduledBackupService,
    private mailService: MailService,
    private prisma: PrismaService,
  ) {}

  @AdminOnly()
  @Query(() => AdminUserList)
  async adminUserList(
    @Args('search', { nullable: true }) search?: string,
    @Args('skip', { type: () => Int, nullable: true, defaultValue: 0 })
    skip?: number,
    @Args('take', { type: () => Int, nullable: true, defaultValue: 20 })
    take?: number,
  ) {
    return this.adminService.listUsers(search, skip, take);
  }

  @AdminOnly()
  @Mutation(() => AdminUserItem)
  async adminCreateUser(@Args('input', { type: () => AdminCreateUserInput }) input: AdminCreateUserInput) {
    return this.adminService.createUser(input.email, input.password, input.name);
  }

  @AdminOnly()
  @Mutation(() => Boolean)
  async adminDeleteUser(
    @Args('userId', { type: () => String }) userId: string,
  ) {
    return this.adminService.deleteUser(userId);
  }

  @AdminOnly()
  @Mutation(() => AdminUserItem)
  async adminSetUserAdmin(
    @Args('userId', { type: () => String }) userId: string,
    @Args('isAdmin', { type: () => Boolean }) isAdmin: boolean,
  ) {
    return this.adminService.setAdmin(userId, isAdmin);
  }

  @AdminOnly()
  @Query(() => [ServerSettingType])
  async adminServerSettings() {
    return this.adminService.getSettings();
  }

  @AdminOnly()
  @Mutation(() => ServerSettingType)
  async adminUpdateServerSetting(
    @Args('key', { type: () => String }) key: string,
    @Args('value', { type: () => String }) value: string,
  ) {
    return this.adminService.updateSetting(key, value);
  }

  @AdminOnly()
  @Query(() => BackupRecordList)
  async adminBackupList(
    @Args('skip', { type: () => Int, nullable: true, defaultValue: 0 })
    skip?: number,
    @Args('take', { type: () => Int, nullable: true, defaultValue: 20 })
    take?: number,
  ) {
    const result = await this.scheduledBackupService.listBackups(skip, take);
    return {
      items: result.items.map((item) => ({
        ...item,
        size: item.size.toString(),
      })),
      totalCount: result.totalCount,
    };
  }

  @AdminOnly()
  @Mutation(() => BackupRecordType)
  async adminCreateBackup(@CurrentUser() user: { id: string }) {
    const record = await this.scheduledBackupService.createFullBackup(user.id);
    return { ...record, size: record.size.toString() };
  }

  @AdminOnly()
  @Mutation(() => Boolean)
  async adminDeleteBackup(
    @Args('id', { type: () => String }) id: string,
  ) {
    return this.scheduledBackupService.deleteBackup(id);
  }

  @AdminOnly()
  @Mutation(() => String)
  async createChangePasswordUrl(
    @Args('callbackUrl', { type: () => String }) callbackUrl: string,
    @Args('userId', { type: () => String }) userId: string,
  ): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new BadRequestException('User not found');

    const token = await this.mailService.createEmailToken(
      userId,
      'password_reset',
    );
    return this.mailService.createPasswordResetUrl(token, callbackUrl);
  }

  @AdminOnly()
  @Mutation(() => Boolean)
  async sendTestEmail(
    @Args('config', { type: () => GraphQLJSON }) config: {
      host: string;
      port: number;
      sender: string;
      username: string;
      password: string;
      ignoreTLS: boolean;
    },
  ): Promise<boolean> {
    await this.mailService.sendTestEmail(config);
    return true;
  }
}

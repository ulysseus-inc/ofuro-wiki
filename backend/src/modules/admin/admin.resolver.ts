import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { BadRequestException, Logger } from '@nestjs/common';
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
  CsvImportResult,
  CsvUserRowResult,
} from './admin.model';
import { parseUserCsv, CsvFormatError } from './user-csv.util';
import GraphQLJSON from 'graphql-type-json';

@Resolver()
export class AdminResolver {
  private readonly logger = new Logger(AdminResolver.name);

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

  // #92: CSV の検証のみ行う（登録しない）。画面はこの結果を一覧表示し、
  // Admin が確認してから adminImportUsers を呼ぶ。
  @AdminOnly()
  @Mutation(() => CsvImportResult)
  async adminValidateUserCsv(
    @Args('csv', { type: () => String }) csv: string,
  ): Promise<CsvImportResult> {
    const rows = this.parseCsvOrThrow(csv);
    return this.toResult(await this.adminService.validateUserCsv(rows));
  }

  // #92: CSV の内容を登録する。検証結果は信用せず、ここでも同じ検証を行う。
  @AdminOnly()
  @Mutation(() => CsvImportResult)
  async adminImportUsers(
    @Args('csv', { type: () => String }) csv: string,
    @CurrentUser() actor: { id: string; email: string },
  ): Promise<CsvImportResult> {
    const rows = this.parseCsvOrThrow(csv);
    return this.toResult(
      await this.adminService.importUsersFromCsv(rows, actor.email),
    );
  }

  /** CSV の書式エラーは行単位ではなく全体の失敗として返す。 */
  private parseCsvOrThrow(csv: string) {
    try {
      return parseUserCsv(csv);
    } catch (e) {
      if (e instanceof CsvFormatError) {
        throw new BadRequestException(e.message);
      }
      throw e;
    }
  }

  private toResult(rows: CsvUserRowResult[]): CsvImportResult {
    const okCount = rows.filter((r) => r.ok).length;
    return { rows, okCount, ngCount: rows.length - okCount };
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

  // L-1: 管理者が対象ユーザーの全セッションを強制失効させる。
  @AdminOnly()
  @Mutation(() => Boolean)
  async adminRevokeUserSessions(
    @Args('userId', { type: () => String }) userId: string,
  ) {
    return this.adminService.revokeUserSessions(userId);
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

  // #115: パスワード変更機能の 3（Admin による直接変更）。
  // 管理者が新しいパスワードを決め、利用者はサインイン後に自分で変更し直す。
  // 本人に URL を渡せる場合は 4（createChangePasswordUrl）を優先する。
  @AdminOnly()
  @Mutation(() => Boolean)
  async adminSetUserPassword(
    @Args('userId', { type: () => String }) userId: string,
    @Args('password', { type: () => String }) password: string,
    @CurrentUser() actor: { id: string; email: string },
  ): Promise<boolean> {
    return this.adminService.setUserPassword(userId, password, actor.email);
  }

  @AdminOnly()
  @Mutation(() => String)
  async createChangePasswordUrl(
    @Args('callbackUrl', { type: () => String }) callbackUrl: string,
    @Args('userId', { type: () => String }) userId: string,
    @CurrentUser() actor: { id: string; email: string },
  ): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new BadRequestException('User not found');

    // #115: 管理者が手渡す URL なので 24時間有効（メール送信の1時間とは別）。
    const token = await this.mailService.createEmailToken(
      userId,
      'password_reset',
      undefined,
      MailService.ADMIN_ISSUED_TOKEN_TTL_MS,
    );

    // #115: 発行された URL は、それ単体でパスワードを変更できる。
    // 誰が誰の分を発行したかを残す（監査ログ #90 の対象）。
    this.logger.log(
      `Password reset URL issued for ${user.email} by admin ${actor.email}`,
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

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
  AuditLogList,
} from './admin.model';
import { parseUserCsv, CsvFormatError } from './user-csv.util';
import GraphQLJSON from 'graphql-type-json';
import { AuditService } from '../audit/audit.service';
import { AuditQueryService } from '../audit/audit-query.service';

@Resolver()
export class AdminResolver {
  private readonly logger = new Logger(AdminResolver.name);

  constructor(
    private adminService: AdminService,
    private scheduledBackupService: ScheduledBackupService,
    private mailService: MailService,
    private prisma: PrismaService,
    private audit: AuditService,
    private auditQuery: AuditQueryService,
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
    @CurrentUser() actor: { id: string; email: string },
  ) {
    return this.adminService.deleteUser(userId, actor);
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
    // 誰が誰の分を発行したかを残す。対象のメールアドレスを残したいので、
    // Interceptor ではなくここで記録する。
    await this.audit.record({
      action: 'user.password.url',
      actor: { id: actor.id, email: actor.email },
      targetType: 'user',
      targetId: userId,
      targetName: user.email,
    });

    return this.mailService.createPasswordResetUrl(token, callbackUrl);
  }

  // #90: 監査ログの閲覧。Admin のみ。
  @AdminOnly()
  @Query(() => AuditLogList)
  async adminAuditLogs(
    @Args('actor', { nullable: true }) actor?: string,
    @Args('action', { nullable: true }) action?: string,
    @Args('from', { nullable: true }) from?: string,
    @Args('to', { nullable: true }) to?: string,
    @Args('skip', { type: () => Int, nullable: true, defaultValue: 0 })
    skip?: number,
    @Args('take', { type: () => Int, nullable: true, defaultValue: 50 })
    take?: number,
  ): Promise<AuditLogList> {
    const result = await this.auditQuery.list(
      { actor, action, from: parseDate(from), to: parseDate(to) },
      skip,
      take,
    );
    return {
      items: result.items.map((item) => ({
        ...item,
        actorId: item.actorId ?? undefined,
        actorName: item.actorName ?? undefined,
        targetType: item.targetType ?? undefined,
        targetId: item.targetId ?? undefined,
        targetName: item.targetName ?? undefined,
        workspaceId: item.workspaceId ?? undefined,
        ip: item.ip ?? undefined,
        userAgent: item.userAgent ?? undefined,
        detail: item.detail ?? undefined,
      })),
      totalCount: result.totalCount,
    };
  }

  // #90: CSV エクスポート。件数上限を設けている（全件だと応答が返らない）
  @AdminOnly()
  @Query(() => String)
  async adminAuditLogsCsv(
    @Args('actor', { nullable: true }) actor?: string,
    @Args('action', { nullable: true }) action?: string,
    @Args('from', { nullable: true }) from?: string,
    @Args('to', { nullable: true }) to?: string,
  ): Promise<string> {
    return this.auditQuery.toCsv({
      actor,
      action,
      from: parseDate(from),
      to: parseDate(to),
    });
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

/** 不正な日付は「指定なし」として扱う（画面の入力ミスで500にしない）。 */
function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

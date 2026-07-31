import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma.service';
import { getAdminEmail } from '../../common/admin-email';
import { BCRYPT_ROUNDS } from '../../common/security.constants';
import { deriveUserName } from '../../common/user-name.util';
import { validatePasswordStrength } from '../../common/password.util';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private prisma: PrismaService) {}

  async listUsers(search?: string, skip = 0, take = 20) {
    // #72: システム内部アカウント（マニュアルWS所有等）は外部に出さない。
    const where: any = { isSystem: false };
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' as const } },
        { name: { contains: search, mode: 'insensitive' as const } },
      ];
    }

    const [items, totalCount] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          isAdmin: true,
          emailVerified: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, totalCount };
  }

  async createUser(email: string, password: string, name?: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    validatePasswordStrength(password);

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    return this.prisma.user.create({
      data: {
        email,
        passwordHash,
        name: deriveUserName(email, name),
        emailVerified: true,
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        isAdmin: true,
        emailVerified: true,
        createdAt: true,
      },
    });
  }

  /**
   * #115: 管理者が対象ユーザーのパスワードを直接再設定する（機能 3）。
   *
   * パスワードを忘れた利用者の復旧経路。現在のパスワードは要求しない
   * （忘れているから使えない）ため、Admin 権限そのものが唯一の防壁になる。
   * この操作の後、Admin は対象利用者のパスワードを知った状態になる。
   * 本人に URL を渡せる場合は 4（変更 URL 発行）を使うこと。
   * 設定後は対象ユーザーの全セッションを失効させる（tokenVersion +1）。
   * 乗っ取り時に「気づかれずに居座る」ことを防ぐため、既存セッションは残さない。
   */
  async setUserPassword(userId: string, password: string, actorEmail: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    validatePasswordStrength(password);

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });

    // 誰が誰の分を設定したかを残す（監査ログ #90 の対象）。
    this.logger.log(
      `Password reset directly for ${user.email} by admin ${actorEmail}`,
    );
    return true;
  }

  async deleteUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Delete owned workspaces first to avoid FK constraint on ownerId
    await this.prisma.workspace.deleteMany({ where: { ownerId: userId } });
    await this.prisma.user.delete({ where: { id: userId } });
    return true;
  }

  /** L-1: 対象ユーザーの全トークンを失効させる（tokenVersion +1）。 */
  async revokeUserSessions(userId: string): Promise<boolean> {
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
      });
      return true;
    } catch (error: any) {
      // 対象ユーザーが存在しない場合 Prisma は P2025 を投げる
      if (error?.code === 'P2025') {
        throw new NotFoundException('User not found');
      }
      throw error;
    }
  }

  async setAdmin(userId: string, isAdmin: boolean) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { isAdmin },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        isAdmin: true,
        emailVerified: true,
        createdAt: true,
      },
    });
  }

  async getSettings() {
    return this.prisma.serverSetting.findMany({
      orderBy: { key: 'asc' },
    });
  }

  async updateSetting(key: string, value: string) {
    return this.prisma.serverSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  async getSettingValue(key: string): Promise<string | null> {
    const setting = await this.prisma.serverSetting.findUnique({
      where: { key },
    });
    return setting?.value ?? null;
  }

  async seedAdmin() {
    const adminEmail = getAdminEmail();
    if (!adminEmail) {
      this.logger.log('ADMIN_EMAIL not set, skipping admin seed');
      return;
    }

    // #77: 完全一致で引く（AuthService の isAdminEmail と同じ判定）。
    // 大文字小文字を無視すると、第三者が ADMIN_EMAIL の大文字小文字違いで
    // サインアップしておくだけで、再起動時に管理者へ昇格させられてしまう。
    const user = await this.prisma.user.findUnique({
      where: { email: adminEmail },
    });

    if (!user) {
      // #77: サインアップ時にも付与するようになったため、この文言どおりに動く
      this.logger.log(
        `ADMIN_EMAIL=${adminEmail} not found in database. Admin will be set when this user signs up.`,
      );
      return;
    }

    if (!user.isAdmin) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { isAdmin: true },
      });
      this.logger.log(`Admin role granted to ${adminEmail}`);
    } else {
      this.logger.log(`${adminEmail} is already admin`);
    }
  }
}

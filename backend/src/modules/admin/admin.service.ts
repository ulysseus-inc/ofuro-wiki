import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private prisma: PrismaService) {}

  async listUsers(search?: string, skip = 0, take = 20) {
    const where = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' as const } },
            { name: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

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

    if (password.length < 8 || password.length > 128) {
      throw new BadRequestException(
        'Password must be between 8 and 128 characters',
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    return this.prisma.user.create({
      data: { email, passwordHash, name, emailVerified: true },
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
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) {
      this.logger.log('ADMIN_EMAIL not set, skipping admin seed');
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { email: adminEmail },
    });

    if (!user) {
      this.logger.warn(
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

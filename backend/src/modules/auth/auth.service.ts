import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  private async isRegistrationOpen(): Promise<boolean> {
    const setting = await this.prisma.serverSetting.findUnique({
      where: { key: 'registration_open' },
    });
    // Default to open if not set
    return setting?.value !== 'false';
  }

  async signUp(email: string, password: string, name?: string) {
    if (!(await this.isRegistrationOpen())) {
      throw new ForbiddenException('Registration is closed');
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.prisma.user.create({
      data: { email, passwordHash, name, emailVerified: true },
    });

    return this.generateTokenResponse(user);
  }

  async signIn(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.generateTokenResponse(user);
  }

  async signInOrSignUp(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      if (!(await this.isRegistrationOpen())) {
        throw new ForbiddenException('Registration is closed');
      }
      // Auto sign-up for new users
      return this.signUp(email, password);
    }
    return this.signIn(email, password);
  }

  async preflight(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    return {
      registered: !!user,
      hasPassword: true, // Always force password input (no magic link support)
      magicLink: false,
      name: user?.name ?? null,
    };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Wrong password');
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });
    return true;
  }

  async deleteAccount(userId: string): Promise<boolean> {
    // Check if this is the last admin
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.isAdmin) {
      const adminCount = await this.prisma.user.count({ where: { isAdmin: true } });
      if (adminCount <= 1) {
        throw new ForbiddenException('Cannot delete the last admin account');
      }
    }

    // Cascade delete handles related data
    await this.prisma.user.delete({ where: { id: userId } });
    return true;
  }

  async validateUser(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        emailVerified: true,
        createdAt: true,
      },
    });
  }

  private generateTokenResponse(user: { id: string; email: string }) {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    const token = this.jwtService.sign(payload);
    return { token, user };
  }
}

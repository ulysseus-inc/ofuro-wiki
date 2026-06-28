import { Resolver, Mutation, Args } from '@nestjs/graphql';
import { UseGuards, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../../prisma.service';
import { UserType } from '../user/user.model';

@Resolver()
@UseGuards(JwtAuthGuard)
export class AuthEmailResolver {
  constructor(
    private authService: AuthService,
    private mailService: MailService,
    private prisma: PrismaService,
  ) {}

  @Mutation(() => Boolean)
  async sendVerifyEmail(
    @CurrentUser() user: { id: string },
    @Args('callbackUrl') callbackUrl: string,
  ): Promise<boolean> {
    this.mailService.ensureEnabled();

    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
    });
    if (!dbUser) throw new BadRequestException('User not found');

    await this.mailService.sendVerificationEmail(
      user.id,
      dbUser.email,
      callbackUrl,
    );
    return true;
  }

  @Public()
  @Mutation(() => Boolean)
  async verifyEmail(
    @Args('token') token: string,
  ): Promise<boolean> {
    const result = await this.mailService.verifyToken(
      token,
      'email_verification',
    );
    if (!result) throw new BadRequestException('Invalid or expired token');

    await this.prisma.user.update({
      where: { id: result.userId },
      data: { emailVerified: true },
    });

    await this.mailService.deleteToken(token);
    return true;
  }

  @Mutation(() => Boolean)
  async sendChangeEmail(
    @CurrentUser() user: { id: string },
    @Args('callbackUrl') callbackUrl: string,
  ): Promise<boolean> {
    this.mailService.ensureEnabled();

    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
    });
    if (!dbUser) throw new BadRequestException('User not found');

    await this.mailService.sendChangeEmailNotification(
      user.id,
      dbUser.email,
      callbackUrl,
    );
    return true;
  }

  @Public()
  @Mutation(() => Boolean)
  async sendVerifyChangeEmail(
    @Args('token') token: string,
    @Args('email') email: string,
    @Args('callbackUrl') callbackUrl: string,
  ): Promise<boolean> {
    this.mailService.ensureEnabled();

    const result = await this.mailService.verifyToken(token, 'email_change');
    if (!result) throw new BadRequestException('Invalid or expired token');

    // Check if new email is already in use
    const existing = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existing) throw new BadRequestException('Email already in use');

    const user = await this.prisma.user.findUnique({
      where: { id: result.userId },
    });
    if (!user) throw new BadRequestException('User not found');

    await this.mailService.sendNewEmailVerification(
      result.userId,
      user.email,
      email,
      callbackUrl,
    );

    await this.mailService.deleteToken(token);
    return true;
  }

  @Public()
  @Mutation(() => UserType)
  async changeEmail(
    @Args('token') token: string,
    @Args('email') email: string,
  ): Promise<UserType> {
    const result = await this.mailService.verifyToken(
      token,
      'new_email_verification',
    );
    if (!result) throw new BadRequestException('Invalid or expired token');
    if (result.email !== email) {
      throw new BadRequestException('Email mismatch');
    }

    // Check if email is already in use
    const existing = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existing) throw new BadRequestException('Email already in use');

    const user = await this.prisma.user.update({
      where: { id: result.userId },
      data: { email, emailVerified: true },
    });

    await this.mailService.deleteToken(token);

    return {
      id: user.id,
      email: user.email,
      name: user.name ?? undefined,
      avatarUrl: user.avatarUrl ?? undefined,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    };
  }

  @Mutation(() => Boolean)
  async sendChangePasswordEmail(
    @CurrentUser() user: { id: string },
    @Args('callbackUrl') callbackUrl: string,
    @Args('email', { nullable: true }) _email?: string,
  ): Promise<boolean> {
    this.mailService.ensureEnabled();

    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
    });
    if (!dbUser) throw new BadRequestException('User not found');

    await this.mailService.sendPasswordResetEmail(
      user.id,
      dbUser.email,
      callbackUrl,
    );
    return true;
  }

  @Mutation(() => Boolean)
  async sendSetPasswordEmail(
    @CurrentUser() user: { id: string },
    @Args('callbackUrl') callbackUrl: string,
    @Args('email', { nullable: true }) _email?: string,
  ): Promise<boolean> {
    this.mailService.ensureEnabled();

    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
    });
    if (!dbUser) throw new BadRequestException('User not found');

    await this.mailService.sendSetPasswordEmail(
      user.id,
      dbUser.email,
      callbackUrl,
    );
    return true;
  }

  @Public()
  @Mutation(() => Boolean)
  async changePassword(
    @CurrentUser() user: { id: string } | undefined,
    @Args('newPassword') newPassword: string,
    @Args('token', { nullable: true }) token?: string,
    @Args('userId', { nullable: true }) userId?: string,
    @Args('currentPassword', { nullable: true }) currentPassword?: string,
  ): Promise<boolean> {
    // Token-based flow (from email link) — no login required
    if (token) {
      const result =
        (await this.mailService.verifyToken(token, 'password_reset')) ||
        (await this.mailService.verifyToken(token, 'password_set'));
      if (!result) {
        throw new BadRequestException('Invalid or expired token');
      }
      if (userId && result.userId !== userId) {
        throw new BadRequestException('Invalid token');
      }
      const hash = await bcrypt.hash(newPassword, 10);
      await this.prisma.user.update({
        where: { id: result.userId },
        data: { passwordHash: hash },
      });
      await this.mailService.deleteToken(token);
      return true;
    }

    // Direct flow (logged-in user changing own password)
    if (currentPassword && user) {
      return this.authService.changePassword(
        user.id,
        currentPassword,
        newPassword,
      );
    }

    throw new BadRequestException('Invalid parameters');
  }
}

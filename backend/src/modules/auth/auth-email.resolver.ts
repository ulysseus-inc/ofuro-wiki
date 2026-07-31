import { Resolver, Mutation, Query, Args } from '@nestjs/graphql';
import { UseGuards, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../../prisma.service';
import { UserType } from '../user/user.model';
import { BCRYPT_ROUNDS } from '../../common/security.constants';

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
    if (!result) throw new BadRequestException('INVALID_EMAIL_TOKEN');

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
    if (!result) throw new BadRequestException('INVALID_EMAIL_TOKEN');

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
    if (!result) throw new BadRequestException('INVALID_EMAIL_TOKEN');
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

  /**
   * 再設定 URL（トークン）によるパスワード設定。サインイン不要。
   *
   * ⚠️ **サインイン中の利用者が自分のパスワードを変更する経路はこちらではない。**
   * `@Public()` は認証を飛ばすため `@CurrentUser()` が埋まらず、
   * 「現在のパスワードを検証して変更する」処理には到達できない。
   * その用途は {@link changeMyPassword}（認証必須）を使う。
   */
  @Public()
  @Mutation(() => Boolean)
  async changePassword(
    @Args('newPassword') newPassword: string,
    @Args('token') token: string,
    @Args('userId', { nullable: true }) userId?: string,
  ): Promise<boolean> {
    const result =
      (await this.mailService.verifyToken(token, 'password_reset')) ||
      (await this.mailService.verifyToken(token, 'password_set'));
    if (!result) {
      throw new BadRequestException('INVALID_EMAIL_TOKEN');
    }
    if (userId && result.userId !== userId) {
      throw new BadRequestException('INVALID_EMAIL_TOKEN');
    }
    this.authService.validatePasswordStrength(newPassword);
    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    // L-1: リセット時も既存の全トークンを失効させる（tokenVersion +1）。
    // #93: 併せてログイン失敗カウントと一時ロックを解除する。ロック中でも
    //      本人はパスワードリセットで復帰でき、15分待つ必要がない。
    await this.prisma.user.update({
      where: { id: result.userId },
      data: {
        passwordHash: hash,
        tokenVersion: { increment: 1 },
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await this.mailService.deleteToken(token);
    return true;
  }

  /**
   * #115: 再設定 URL のトークンが今も使えるかどうかだけを返す。
   *
   * 画面を開いた時点で「使用済み・期限切れ」を案内するために使う。
   * これが無いと、無効な URL でもフォームが出てしまい、利用者は
   * パスワードを入力して送信するまで気づけない。
   *
   * ⚠️ **状態を変えない**（トークンを消費しない）。
   * 未認証で叩ける点は changePassword と同じで、得られる情報も
   * 「そのトークンが有効か」だけであり、changePassword を叩いても
   * 同じことが分かるため、新たに漏れる情報は無い。
   * トークンは32バイト乱数のため総当たりは非現実的。
   */
  @Public()
  @Query(() => Boolean)
  async isPasswordTokenValid(
    @Args('token') token: string,
  ): Promise<boolean> {
    const result =
      (await this.mailService.verifyToken(token, 'password_reset')) ||
      (await this.mailService.verifyToken(token, 'password_set'));
    return !!result;
  }

  /**
   * サインイン中の利用者が、自分のパスワードを変更する。
   *
   * 現在のパスワードの検証が必要なため、**認証必須**（`@Public()` を付けない）。
   * 付けると `@CurrentUser()` が埋まらず、誰の変更なのか分からなくなる。
   */
  @Mutation(() => Boolean)
  async changeMyPassword(
    @CurrentUser() user: { id: string },
    @Args('currentPassword') currentPassword: string,
    @Args('newPassword') newPassword: string,
  ): Promise<boolean> {
    return this.authService.changePassword(
      user.id,
      currentPassword,
      newPassword,
    );
  }
}

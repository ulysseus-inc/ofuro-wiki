import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import { AuthService, JwtPayload } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { SignInDto, SignUpDto, PreflightDto } from './dto/auth.dto';
// #89: OIDC と共通のクッキー設定（片方だけ属性がずれる事故を防ぐ）
import { clearAuthCookies, setAuthCookies } from './auth-cookie.util';

@Controller('api/auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private jwtService: JwtService,
  ) {}

  // #93: ここは「連射・DoS の抑制」に徹する。
  //
  // この制限は「失敗」ではなく**リクエスト数**を数えるため、成功したサインインも枠を
  // 消費する。厳しくすると、複数端末・複数タブ・CI から正当にサインインしただけで
  // 締め出される（可用性の問題）。
  //
  // パスワードの総当たりに対する防御は、**失敗だけを数える** AuthService 側の制限
  // （SIGNIN_MAX_FAILURES: 5回/5分）と、アカウントロックアウト（10回で15分）が担う。
  @Public()
  @Throttle({ default: { limit: 60, ttl: 5 * 60_000 } })
  @Post('sign-in')
  async signIn(
    @Body() body: SignInDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, user } = await this.authService.signInOrSignUp(
      body.email,
      body.password,
      req.ip,
    );
    setAuthCookies(res, token);
    return { id: user.id, email: user.email };
  }

  // #93: 大量アカウント作成の抑止
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  @Post('sign-up')
  async signUp(
    @Body() body: SignUpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, user } = await this.authService.signUp(
      body.email,
      body.password,
      body.name,
      req.ip,
    );
    setAuthCookies(res, token);
    return { id: user.id, email: user.email };
  }

  /**
   * サインアウト。
   *
   * ⚠️ **認証を要求しない。**
   * パスワード変更やロックで手元のトークンが失効していると、認証を要求すると
   * 401 で弾かれ、**クッキーが消せずサインアウトできない状態で固定される**
   * （実際に発生した）。サインアウトは「認証が壊れているときこそ使いたい」
   * 操作なので、常に成功してクッキーを消す。
   *
   * 認証を求めないことで第三者に強制サインアウトさせられる余地は残るが、
   * 失うのは手元のセッションだけで、実害は再サインインの手間にとどまる。
   */
  @Public()
  @Post('sign-out')
  async signOut(@Res({ passthrough: true }) res: Response) {
    clearAuthCookies(res);
    return { success: true };
  }

  // L-1: 全端末サインアウト。tokenVersion を +1 して発行済みトークンを一括失効させる。
  //
  // こちらは対象の利用者を特定する必要があるため認証を要求する。
  // トークンが既に失効している場合はセッションも失効済みなので、
  // 手元を片付けるだけなら上の sign-out で足りる。
  @Post('sign-out-all')
  @UseGuards(JwtAuthGuard)
  async signOutAll(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = (req as any).user?.id;
    if (userId) {
      await this.authService.revokeAllSessions(userId);
    }
    clearAuthCookies(res);
    return { success: true };
  }

  // #93: メールアドレス列挙の試行回数を抑える
  @Public()
  @Throttle({ default: { limit: 30, ttl: 5 * 60_000 } })
  @Post('preflight')
  async preflight(@Body() body: PreflightDto) {
    const result = await this.authService.preflight(body.email);
    return result;
  }

  // Public endpoint: returns { user: null } when unauthenticated (no 401).
  // This avoids spurious console errors during session revalidation.
  @Public()
  @Get('session')
  async getSession(@Req() req: Request) {
    const token = (req.cookies as Record<string, string>)?.affine_token;
    if (!token) {
      return { user: null };
    }
    try {
      const payload = this.jwtService.verify<JwtPayload>(token);
      // L-1: tokenVersion を検証し、失効済みトークンは未認証扱いにする。
      const fullUser = await this.authService.validateTokenPayload(payload);
      if (!fullUser) {
        return { user: null };
      }
      return {
        user: {
          id: fullUser.id,
          email: fullUser.email,
          name: fullUser.name,
          avatarUrl: fullUser.avatarUrl,
          emailVerified: fullUser.emailVerified,
          createdAt: fullUser.createdAt.toISOString(),
        },
      };
    } catch {
      // Expired or invalid token — treat as unauthenticated
      return { user: null };
    }
  }
}

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
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import * as crypto from 'crypto';

// COOKIE_SECURE=false で HTTP 環境でも動作可能（デフォルト: 本番は true）
const cookieSecure =
  process.env.COOKIE_SECURE !== undefined
    ? process.env.COOKIE_SECURE === 'true'
    : process.env.NODE_ENV === 'production';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: cookieSecure,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

@Controller('api/auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private jwtService: JwtService,
  ) {}

  @Public()
  @Post('sign-in')
  async signIn(
    @Body() body: { email: string; password: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, user } = await this.authService.signInOrSignUp(
      body.email,
      body.password,
    );
    this.setAuthCookies(res, token);
    return { id: user.id, email: user.email };
  }

  @Public()
  @Post('sign-up')
  async signUp(
    @Body() body: { email: string; password: string; name?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, user } = await this.authService.signUp(
      body.email,
      body.password,
      body.name,
    );
    this.setAuthCookies(res, token);
    return { id: user.id, email: user.email };
  }

  @Post('sign-out')
  @UseGuards(JwtAuthGuard)
  async signOut(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('affine_token');
    res.clearCookie('affine_csrf_token');
    return { success: true };
  }

  @Public()
  @Post('preflight')
  async preflight(@Body() body: { email: string }) {
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
      const payload = this.jwtService.verify<{ sub: string }>(token);
      const fullUser = await this.authService.validateUser(payload.sub);
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

  private setAuthCookies(res: Response, token: string) {
    res.cookie('affine_token', token, COOKIE_OPTIONS);
    const csrfToken = crypto.randomBytes(32).toString('hex');
    res.cookie('affine_csrf_token', csrfToken, {
      ...COOKIE_OPTIONS,
      httpOnly: false, // CSRF token must be readable by JS
    });
  }
}

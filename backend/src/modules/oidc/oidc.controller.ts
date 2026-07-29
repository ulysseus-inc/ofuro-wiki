import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from '../auth/auth.service';
import {
  clearAllOidcStateCookies,
  oidcStateCookieName,
  setAuthCookies,
  setOidcStateCookie,
} from '../auth/auth-cookie.util';
import { OidcConfigService } from './oidc-config.service';
import { OidcService } from './oidc.service';
import { OauthCallbackDto, OauthPreflightDto } from './dto/oidc.dto';

/**
 * #89: OIDC（シングルサインオン）のエンドポイント。
 *
 * フロントエンドの実装に合わせた形。Web 版のフローは以下:
 *
 *   ① ボタン押下 → ポップアップで /oauth/login（フロントのページ）
 *   ② そのページが POST /api/oauth/preflight を呼ぶ → 認可URLを返す
 *   ③ IdP へ遷移・認証
 *   ④ IdP が {BASE_URL}/oauth/callback（フロントのページ）へ戻す
 *   ⑤ そのページが POST /api/oauth/callback を呼ぶ → セッション発行
 */
@Controller('api/oauth')
export class OidcController {
  constructor(
    private oidcService: OidcService,
    private oidcConfigService: OidcConfigService,
    private authService: AuthService,
  ) {}

  /** 認可URLを返す。IdP へのリダイレクト先はここで決まる。 */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 5 * 60_000 } })
  @Post('preflight')
  async preflight(
    @Body() _body: OauthPreflightDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // 現時点で対応するプロバイダは OIDC のみ。provider の値は検証済み（DTO）。
    const { url, state } = await this.oidcService.createAuthorizationUrl();

    // ログイン CSRF 対策: 認証を開始したブラウザに state を束縛する。
    // これが無いと、攻撃者が取得した code/state を被害者に踏ませることで、
    // 被害者を攻撃者のアカウントでサインインさせられる。
    // 試行ごとに別名のクッキーになるため、同時に認証が始まっても互いを壊さない
    setOidcStateCookie(res, state);

    return { url };
  }

  /**
   * 認可コードを受け取り、サインインを完了させる。
   *
   * ⚠️ ここで初めてアカウントが作られる可能性がある（自動作成が有効な場合のみ）。
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 5 * 60_000 } })
  @Post('callback')
  async callback(
    @Body() body: OauthCallbackDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const config = await this.oidcConfigService.getConfig();
    if (!config) {
      throw new BadRequestException('シングルサインオンが設定されていません。');
    }

    // ログイン CSRF 対策: 認証を開始したブラウザと同一であることを確認する
    const cookies = req.cookies as Record<string, string> | undefined;
    const stateCookie = cookies?.[oidcStateCookieName(body.state)];

    // この試行だけでなく、途中で離脱した試行のクッキーもここで片付ける
    clearAllOidcStateCookies(res, cookies);

    const profile = await this.oidcService.verifyCallback(
      body.code,
      body.state,
      stateCookie,
    );

    const { token, user } = await this.authService.signInWithOidc({
      email: profile.email,
      name: profile.name,
      autoCreateUser: config.autoCreateUser,
      ip: req.ip,
    });

    setAuthCookies(res, token);

    return { id: user.id, email: user.email };
  }
}

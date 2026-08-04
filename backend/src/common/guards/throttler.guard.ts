import { ExecutionContext, Inject, Injectable } from '@nestjs/common';
import {
  ThrottlerGuard,
  type ThrottlerLimitDetail,
} from '@nestjs/throttler';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AttackCounterService } from '../../modules/security/attack-counter.service';

/** #93: メールアドレス単位でも数えるエンドポイント（サインイン系） */
const EMAIL_SCOPED_PATHS = ['/api/auth/sign-in'];

@Injectable()
export class GqlThrottlerGuard extends ThrottlerGuard {
  /**
   * #117: 拒否した回数を数えるためだけに使う。
   * ガード本体の判定には一切関与しない（数えられなくても拒否は続ける）。
   */
  @Inject(AttackCounterService)
  private readonly attackCounter!: AttackCounterService;

  /**
   * #117: レート制限で弾いた回数を数える（検知条件C）。
   *
   * **429 はアクセスログにステータスコードとして残るだけで、集計できない。**
   * 監査ログに1件ずつ書くと攻撃中に大量発生して DB が膨らむため、
   * メモリ上のカウンタに計上する（docs/intrusion-detection.md 2.1）。
   *
   * ⚠️ ここで例外を出してはいけない。計上に失敗しても**拒否は必ず行う**。
   */
  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    try {
      const { req } = this.getRequestResponse(context);
      this.attackCounter?.recordThrottled((req as any)?.ip);
    } catch {
      // 数えられなくても拒否は続ける
    }
    return super.throwThrottlingException(context, throttlerLimitDetail);
  }

  getRequestResponse(context: ExecutionContext) {
    const contextType = context.getType<string>();

    // WebSocket (Socket.IO) はスキップ
    if (contextType === 'ws') {
      return { req: { ip: '0.0.0.0' }, res: {} };
    }

    // GraphQL コンテキスト
    if (contextType === 'graphql') {
      const gqlCtx = GqlExecutionContext.create(context);
      const ctx = gqlCtx.getContext();
      const req = ctx.req ?? { ip: '0.0.0.0' };
      return { req, res: ctx.res ?? {} };
    }

    return super.getRequestResponse(context);
  }

  /**
   * #93: サインインは「IP + メールアドレス」で数える。
   *
   * IP だけで数えると、NAT 配下の会社（全社員が同一のグローバルIP）で
   * 誰か1人の打ち間違いが全員を巻き込んで締め出してしまう。
   * メールアドレスを含めることで、影響を該当アカウントに限定する。
   *
   * 1つのIPから多数のアカウントを試す攻撃（パスワードスプレー）はこの制限では
   * 防ぎきれないが、アカウント単位のロックアウトとグローバル制限
   * （60秒/300リクエスト）で抑止する。
   *
   * ⚠️ メールアドレスごとに枠が分かれるため、この制限だけでは
   *    「アドレスを変えながらのアカウント量産」を防げない。
   *    アカウント作成の上限は AuthService 側（SIGNUP_MAX_PER_IP）で担保する。
   */
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // GraphQL / WebSocket 経路では getRequestResponse がダミーを返すため既定値を持つ
    const ip: string = req?.ip ?? '0.0.0.0';
    const path: string = req?.originalUrl ?? req?.url ?? '';

    if (EMAIL_SCOPED_PATHS.some((target) => path.startsWith(target))) {
      const email = req?.body?.email;
      if (typeof email === 'string' && email) {
        return `${ip}:${email.toLowerCase()}`;
      }
    }

    return ip;
  }
}

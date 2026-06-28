import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { GqlExecutionContext } from '@nestjs/graphql';

@Injectable()
export class GqlThrottlerGuard extends ThrottlerGuard {
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
}

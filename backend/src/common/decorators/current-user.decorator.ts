import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    // Support both REST and GraphQL contexts
    const type = ctx.getType<string>();
    if (type === 'graphql') {
      const gqlCtx = GqlExecutionContext.create(ctx);
      return gqlCtx.getContext().req?.user;
    }
    return ctx.switchToHttp().getRequest().user;
  },
);

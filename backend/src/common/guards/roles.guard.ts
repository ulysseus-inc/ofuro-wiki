import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles) {
      return true;
    }

    const type = context.getType<string>();
    let user: any;
    if (type === 'graphql') {
      const ctx = GqlExecutionContext.create(context);
      user = ctx.getContext().req?.user;
    } else {
      user = context.switchToHttp().getRequest().user;
    }

    if (!user) {
      return false;
    }

    return requiredRoles.some((role) => user.role === role);
  }
}

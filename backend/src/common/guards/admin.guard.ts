import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const type = context.getType<string>();
    let user: any;
    if (type === 'graphql') {
      const ctx = GqlExecutionContext.create(context);
      user = ctx.getContext().req?.user;
    } else {
      user = context.switchToHttp().getRequest().user;
    }

    if (!user?.id) {
      throw new ForbiddenException('Admin access required');
    }

    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { isAdmin: true },
    });

    if (!dbUser?.isAdmin) {
      throw new ForbiddenException('Admin access required');
    }

    return true;
  }
}

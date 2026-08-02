import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { PrismaService } from '../../prisma.service';
import { AuditService } from '../../modules/audit/audit.service';
import { recordDenial } from './audit-denial.util';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private prisma: PrismaService,
    // #90: 拒否は Interceptor に届かないため、ここで記録する
    private audit: AuditService,
  ) {}

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
      // #90: **未認証は記録しない。**
      // JwtAuthGuard がグローバル（APP_GUARD）で先に走るため通常ここには来ないが、
      // 記録しても実行者が分からず、「誰が」の無い記録は監査の役に立たない
      // （単独のサインアウトを記録しないのと同じ理由・docs/logging.md 2.2）。
      // 記録すると、トークン無しで叩くだけで監査ログを膨らませられる余地も残る。
      throw new ForbiddenException('Admin access required');
    }

    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { isAdmin: true },
    });

    if (!dbUser?.isAdmin) {
      // 一般利用者が管理操作を試みた記録。#117 の検知対象
      await recordDenial(this.audit, context, 'admin.denied', {
        reason: 'not_admin',
      });
      throw new ForbiddenException('Admin access required');
    }

    return true;
  }
}

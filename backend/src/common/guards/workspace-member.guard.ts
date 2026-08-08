import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { PrismaService } from '../../prisma.service';
import { AuditService } from '../../modules/audit/audit.service';
import { recordDenial } from './audit-denial.util';
import {
  WORKSPACE_ROLE_KEY,
  WORKSPACE_ROLE_RANK,
  WorkspaceRoleRequirement,
} from '../decorators/workspace-role.decorator';

/**
 * H-1 対策: ワークスペース越境（IDOR）を防ぐ共通認可ガード。
 *
 * `@WorkspaceRole(minRole, argName)` が付いたハンドラに対して、
 * リクエスト中の workspaceId を解決し、呼び出しユーザーがそのワークスペースの
 * メンバーで、かつ要求ロール以上かを検証する。
 * サーバ全体 Admin（user.isAdmin）は全ワークスペースをバイパスする。
 *
 * JwtAuthGuard（グローバル）で認証済みであることが前提。
 */
@Injectable()
export class WorkspaceMemberGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
    // #90: 拒否は Interceptor に届かないため、ここで記録する
    private audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<WorkspaceRoleRequirement>(
      WORKSPACE_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );

    // メタデータが無いハンドラには何も課さない（ガードの誤爆防止）。
    if (!requirement) {
      return true;
    }

    const { req, workspaceId } = this.resolveRequestAndWorkspaceId(
      context,
      requirement.argName,
    );

    const user = req?.user;
    if (!user?.id) {
      throw new ForbiddenException('Authentication required');
    }

    if (!workspaceId || typeof workspaceId !== 'string') {
      throw new ForbiddenException('workspaceId is required');
    }

    // UUID 形式でない workspaceId を Prisma の uuid カラムに渡すと
    // `invalid input syntax for type uuid` で生の 500 になるため、
    // クエリ前に形式検証して不在と同じ 404 に倒す。
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(workspaceId)) {
      throw new NotFoundException('Workspace not found');
    }

    // ワークスペース存在・Admin判定・メンバーシップを並行取得。
    const [workspaceExists, dbUser, member] = await Promise.all([
      this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { id: true },
      }),
      this.prisma.user.findUnique({
        where: { id: user.id },
        select: { isAdmin: true },
      }),
      this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: user.id } },
        select: { role: true, status: true },
      }),
    ]);

    // 存在しないワークスペースは非Adminでも 403 ではなく一貫して 404 を返す。
    if (!workspaceExists) {
      throw new NotFoundException('Workspace not found');
    }

    // サーバ全体 Admin は全ワークスペースにアクセス可能。
    if (dbUser?.isAdmin) {
      return true;
    }

    if (!member || member.status !== 'accepted') {
      // 非メンバーによるワークスペースへのアクセス試行。#117 の検知対象
      await recordDenial(this.audit, context, 'workspace.denied', {
        workspaceId,
        reason: member ? `status_${member.status}` : 'not_member',
      });
      throw new ForbiddenException('Access denied to this workspace');
    }

    const userRank = WORKSPACE_ROLE_RANK[member.role] ?? 0;
    const requiredRank = WORKSPACE_ROLE_RANK[requirement.minRole] ?? 0;
    if (userRank < requiredRank) {
      await recordDenial(this.audit, context, 'workspace.denied', {
        workspaceId,
        reason: 'insufficient_role',
        role: member.role,
        required: requirement.minRole,
      });
      throw new ForbiddenException(
        `Requires '${requirement.minRole}' role in this workspace`,
      );
    }

    return true;
  }

  private resolveRequestAndWorkspaceId(
    context: ExecutionContext,
    argName: string,
  ): { req: any; workspaceId: unknown } {
    const type = context.getType<string>();

    if (type === 'graphql') {
      const gqlCtx = GqlExecutionContext.create(context);
      const args = gqlCtx.getArgs<Record<string, any>>();
      // ⚠️ **`input: { workspaceId }` 形式の mutation がある。**
      // 平の引数しか見ないと workspaceId を見つけられず、
      // 「workspaceId is required」で**正当な呼び出しまで拒否する**
      // （#97 の権限操作がすべて弾かれていた。E2E で検出）。
      const fromInput =
        args?.input && typeof args.input === 'object'
          ? args.input[argName]
          : undefined;
      return {
        req: gqlCtx.getContext().req,
        workspaceId: args?.[argName] ?? fromInput,
      };
    }

    const req = context.switchToHttp().getRequest();
    // HTTP: ルートパラメータ優先、無ければボディから解決する。
    const workspaceId = req?.params?.[argName] ?? req?.body?.[argName];
    return { req, workspaceId };
  }
}

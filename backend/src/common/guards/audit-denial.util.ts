import { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AuditService } from '../../modules/audit/audit.service';
import { createDedupeWindow } from '../dedupe-window.util';

/**
 * #90: Guard による認可拒否を監査ログに記録する。
 *
 * ⚠️ **Guard の拒否は Interceptor に届かない。**
 * NestJS の実行順序は Guard → Interceptor → ハンドラであり、
 * Guard が `ForbiddenException` を投げた時点で Interceptor は一度も実行されない。
 * 「Interceptor で横断的に記録する」だけの設計では、
 * **Admin 以外による管理操作の試行が1件も残らない**（docs/logging.md 2.7）。
 *
 * 判断した場所で記録するのが最も確実で、`ExecutionContext` から
 * 利用者・IP・UserAgent も取れる。
 */

/** GraphQL と REST の両方から、元のリクエストを取り出す。 */
export function requestOf(context: ExecutionContext): any {
  if (context.getType<string>() === 'graphql') {
    return GqlExecutionContext.create(context).getContext().req;
  }
  return context.switchToHttp().getRequest();
}

/** 操作名。GraphQL は解決対象のフィールド名、REST はメソッドとパス。 */
export function operationOf(context: ExecutionContext): string {
  if (context.getType<string>() === 'graphql') {
    const info = GqlExecutionContext.create(context).getInfo();
    return info?.fieldName ?? 'unknown';
  }
  const req = context.switchToHttp().getRequest();
  return `${req?.method ?? '?'} ${req?.route?.path ?? req?.url ?? '?'}`;
}

/**
 * 同じ拒否を短時間に何度も記録しないための窓。
 *
 * ⚠️ 認証済みの利用者は**拒否される操作を連打できる**。1回ごとに1行残すと、
 * 監査ログを一方的に膨らませられる（保持は3年）。
 * 一方で**まったく記録しないと #117 の検知材料が消える**ため、
 * 「同じ利用者・同じ操作・同じ対象」は**1分に1回だけ**記録する。
 */
const denialWindow = createDedupeWindow(60 * 1000);

/** テスト用。窓の状態を消す。 */
export function resetDenialWindow(): void {
  denialWindow.reset();
}

/** テスト用。保持しているキーの数。 */
export function denialWindowSize(): number {
  return denialWindow.size();
}

/**
 * 認可拒否を記録する。**記録の失敗で拒否そのものを妨げない**
 * （`AuditService.record` が例外を外へ出さない）。
 */
export async function recordDenial(
  audit: AuditService,
  context: ExecutionContext,
  action: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  const req = requestOf(context);
  const user = req?.user;

  const key = `${user?.id ?? 'anonymous'}:${action}:${operationOf(context)}:${
    meta?.workspaceId ?? '-'
  }`;
  if (denialWindow.shouldSkip(key)) return;

  await audit.record({
    action,
    actor: { id: user?.id, email: user?.email, name: user?.name },
    ip: req?.ip,
    userAgent: req?.headers?.['user-agent'],
    detail: { meta: { operation: operationOf(context), ...meta } },
  });
}

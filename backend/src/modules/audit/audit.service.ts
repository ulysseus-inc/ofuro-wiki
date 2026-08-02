import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma.service';

/**
 * #90: 監査ログの記録（docs/logging.md 2章）。
 *
 * **記録に失敗しても、本来の操作は成功させる**（fail-open）。
 * 監査ログは同じ PostgreSQL に書くため、DB が落ちていれば大半の操作が失敗する。
 * 操作を止めても守れる範囲は狭く、一方で「一時的な書き込み失敗で Admin が
 * ユーザー管理を一切できない」状態になると復旧の手立てまで失われる。
 *
 * ⚠️ ただし**記録に失敗した事実は必ず残す**（アプリケーションログへ error）。
 * 黙って記録されないのが最悪であり、「監査ログがある」と信じている運用者を欺く。
 */

/**
 * 列ごとの保存上限（`schema.prisma` の `@db.VarChar` と一致させること）。
 *
 * ⚠️ **超過したまま書くと INSERT が失敗し、fail-open で黙って捨てられる。**
 * つまり**攻撃者が自分の痕跡を消せる**。実例として、`X-Forwarded-For` に
 * 46文字以上を入れるだけで `ip` が上限を超え、その操作の監査記録が残らなくなる
 * （`sync.gateway` はこのヘッダをそのまま読む）。
 *
 * 監査ログの値は**すべて切り詰めてから保存する**。記録が欠けるより、
 * 末尾が切れている方がはるかにましである。
 */
const COLUMN_LIMITS = {
  actorEmail: 255,
  actorName: 255,
  action: 64,
  targetType: 32,
  targetId: 255,
  targetName: 255,
  ip: 45,
  userAgent: 255,
} as const;

/**
 * UUID 列に渡してよい値か。
 *
 * ⚠️ **UUID 以外を渡すと INSERT が失敗し、fail-open で記録が黙って消える。**
 * 列長（COLUMN_LIMITS）で塞いだのと**同じ失敗経路**であり、
 * 引数由来の値（`workspaceId` 等）をそのまま渡してはいけない。
 * 不正な値は列には入れず、`detail.meta` に退避して情報自体は残す。
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function asUuid(value: string | null | undefined): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
}

/** 上限まで切り詰める。null / undefined はそのまま返す。 */
function clip<T extends string | null | undefined>(
  value: T,
  max: number,
): T extends string ? string : T {
  return (typeof value === 'string' ? value.slice(0, max) : value) as any;
}

/** 保持日数の設定キー。既定は3年（docs/logging.md 2.9）。 */
export const RETENTION_SETTING_KEY = 'audit_log_retention_days';
export const DEFAULT_RETENTION_DAYS = 1095;

export interface AuditActor {
  id?: string | null;
  email?: string | null;
  name?: string | null;
}

export interface AuditEntry {
  /** `<対象>.<操作>` 形式（`user.create` / `auth.signin.failed` 等）。 */
  action: string;
  actor: AuditActor;
  targetType?: string;
  targetId?: string;
  /** 対象の表示名。**対象が削除された後でも追えるように値で残す。** */
  targetName?: string;
  workspaceId?: string;
  ip?: string;
  userAgent?: string;
  /** `before` / `after` / `meta` の3キーのみを使う（docs/logging.md 2.4）。 */
  detail?: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    meta?: Record<string, unknown>;
  };
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 監査ログを1件記録する。
   *
   * **例外を外へ出さない。** 呼び出し側は結果を待たずに済むが、
   * 記録の取りこぼしを避けるため await して使うことを推奨する。
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: clip(entry.action, COLUMN_LIMITS.action),
          actorId: asUuid(entry.actor.id),
          // 未認証の操作（サインイン失敗など）でも「誰を騙ろうとしたか」は残す
          actorEmail: clip(
            entry.actor.email ?? 'anonymous',
            COLUMN_LIMITS.actorEmail,
          ),
          actorName: clip(entry.actor.name ?? null, COLUMN_LIMITS.actorName),
          targetType: clip(entry.targetType ?? null, COLUMN_LIMITS.targetType),
          targetId: clip(entry.targetId ?? null, COLUMN_LIMITS.targetId),
          targetName: clip(entry.targetName ?? null, COLUMN_LIMITS.targetName),
          workspaceId: asUuid(entry.workspaceId),
          ip: clip(entry.ip ?? null, COLUMN_LIMITS.ip),
          userAgent: clip(entry.userAgent ?? null, COLUMN_LIMITS.userAgent),
          detail: withRejectedIds(entry) as any,
        },
      });
    } catch (e) {
      // fail-open。ただし「記録できなかった」ことは必ず残す
      this.logger.error(
        `監査ログを記録できませんでした (action=${entry.action}, actor=${
          entry.actor.email ?? 'anonymous'
        }): ${(e as Error).message}`,
      );
    }
  }

  /**
   * #90: 保持期間を過ぎた監査ログを削除する。
   *
   * ⚠️ **削除したこと自体も記録する。** 記録が消えた事実が残らないと、
   * 「元から無かったのか、消されたのか」を区別できない（docs/logging.md 2.9）。
   */
  @Cron(CronExpression.EVERY_DAY_AT_5AM)
  async cleanupOldLogs(): Promise<number> {
    const days = await this.retentionDays();
    const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    try {
      const { count } = await this.prisma.auditLog.deleteMany({
        where: { createdAt: { lt: threshold } },
      });
      if (count > 0) {
        this.logger.log(`古い監査ログを削除しました: ${count}件（保持 ${days}日）`);
        await this.record({
          action: 'audit.cleanup',
          actor: { email: 'system' },
          detail: { meta: { deleted: count, retentionDays: days } },
        });
      }
      return count;
    } catch (e) {
      this.logger.error(
        `監査ログの削除に失敗しました: ${(e as Error).message}`,
      );
      return 0;
    }
  }

  /**
   * 保持日数を設定から読む。
   *
   * 不正な値は既定として扱う。素通しすると `NaN` から
   * 「全件削除」や「1件も消えない」といった事故になる。
   */
  async retentionDays(): Promise<number> {
    const setting = await this.prisma.serverSetting
      .findUnique({ where: { key: RETENTION_SETTING_KEY } })
      .catch(() => null);
    const parsed = Number(setting?.value);
    return Number.isFinite(parsed) && parsed > 0
      ? Math.floor(parsed)
      : DEFAULT_RETENTION_DAYS;
  }
}

/**
 * UUID でないために列へ入れられなかった値を `detail.meta` に退避する。
 * **記録を捨てるより、形の違う値でも残す方がよい。**
 */
function withRejectedIds(entry: AuditEntry): AuditEntry['detail'] | undefined {
  const rejected: Record<string, unknown> = {};
  if (entry.actor.id && !asUuid(entry.actor.id)) {
    rejected.actorId = entry.actor.id;
  }
  if (entry.workspaceId && !asUuid(entry.workspaceId)) {
    rejected.workspaceId = entry.workspaceId;
  }
  if (Object.keys(rejected).length === 0) return entry.detail;

  return {
    ...entry.detail,
    meta: { ...entry.detail?.meta, rejected },
  };
}

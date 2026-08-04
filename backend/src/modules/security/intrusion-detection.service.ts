import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { AttackCounterService } from './attack-counter.service';
import { type AlertConfig, loadAlertConfig } from './alert-config';
import {
  alertBody,
  alertSubject,
  resolvedBody,
  resolvedSubject,
} from './alert-message';
import {
  type AlertKind,
  type Detection,
  type MailStatus,
  detectionKey,
  SAMPLE_ACCOUNT_LIMIT,
  SEVERITY_OF,
  TOP_IP_LIMIT,
} from './alert.types';

/**
 * #117: 不審なログイン試行の検知と通知（docs/intrusion-detection.md）。
 *
 * **5分ごとに、直近60分を評価する。**
 *
 * 設計の要点:
 * - **記録が先、通知が後。** メールが送れなくても `security.alert` は必ず残す
 * - **抑制の状態は audit_logs 自体**。メモリに持つと再起動のたびに再送される
 * - **終息はヒステリシス付き**。「条件を満たさない」ではなく「事象が無い」で判定する
 * - **失敗してもアプリを止めない**（fail-open）。ただし失敗した事実は必ず残す
 */

/** 監査ログを遡って「未終息の警報」を探す範囲。抑制により件数はごく少ない。 */
const OPEN_ALERT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

const ALERT_ACTION = 'security.alert';
const RESOLVED_ACTION = 'security.alert.resolved';

/**
 * メール送信の結果。
 *
 * ⚠️ `recipients`（送ろうとした人数）と `delivered`（実際に受理された人数）を
 * **分けて持つ。** 一部の宛先が拒否されても送信自体は成功するため、
 * 送った人数だけでは「誰にも届いていない」状態を判別できない。
 */
interface MailOutcome {
  status: MailStatus;
  recipients: number;
  delivered: number;
  rejected: number;
}

@Injectable()
export class IntrusionDetectionService implements OnModuleInit {
  private readonly logger = new Logger(IntrusionDetectionService.name);
  private config: AlertConfig = loadAlertConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly counter: AttackCounterService,
  ) {}

  onModuleInit(): void {
    this.config = loadAlertConfig();
    this.counter.setRetention(
      this.config.windowMinutes,
      this.config.quietMinutes,
    );

    // ⚠️ 運用で最も怖いのは「止めたまま忘れる」こと。攻撃されても何も起きず、
    // しかも**何も起きないこと自体が正常に見える**。起動ログに残しておけば
    // 「攻撃が無かった」のか「止めていた」のかを後から区別できる。
    if (this.config.disabled) {
      this.logger.warn(
        '検知は無効化されています（ALERT_DISABLED=true）。攻撃を検知しても通知されません。',
      );
    }
  }

  /** 5分ごと。 */
  @Cron('*/5 * * * *')
  async scan(): Promise<void> {
    if (this.config.disabled) return;

    try {
      await this.runOnce();
    } catch (e) {
      // fail-open。検知の失敗でアプリを止めない。ただし黙って終わらない
      this.logger.error(
        `不審なログイン試行の検知に失敗しました: ${(e as Error).message}`,
      );
    }
  }

  /** 1周ぶん。テストから直接呼ぶ。 */
  async runOnce(now: Date = new Date()): Promise<void> {
    const detections = [
      ...(await this.detectTargeted(now)),
      ...(await this.detectSpray(now)),
      ...this.detectThrottled(),
      ...this.detectUnknownEmail(),
    ];

    for (const detection of detections) {
      await this.raise(detection);
    }

    // 終息の判定は、いま検知したものに依存しない。
    // 未終息の警報を監査ログから引き直し、静穏条件だけで判断する（4.0）
    await this.resolveQuietAlerts(now);
  }

  // ───────────────────────────────── 検知

  private since(now: Date, minutes: number): Date {
    return new Date(now.getTime() - minutes * 60 * 1000);
  }

  /**
   * 種別A: 同一アカウントが窓内に N 回以上ロックされた。
   *
   * ロックは頻繁には起きないため、行をそのまま読んで集計する。
   */
  private async detectTargeted(now: Date): Promise<Detection[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        action: 'auth.locked',
        createdAt: { gte: this.since(now, this.config.windowMinutes) },
      },
      select: { actorEmail: true, actorId: true, ip: true },
    });

    const byAccount = new Map<
      string,
      { userId?: string; count: number; ips: Map<string, number> }
    >();

    for (const row of rows) {
      let entry = byAccount.get(row.actorEmail);
      if (!entry) {
        entry = { userId: row.actorId ?? undefined, count: 0, ips: new Map() };
        byAccount.set(row.actorEmail, entry);
      }
      entry.count += 1;
      const ip = row.ip ?? 'unknown';
      entry.ips.set(ip, (entry.ips.get(ip) ?? 0) + 1);
    }

    const out: Detection[] = [];
    for (const [email, entry] of byAccount) {
      if (entry.count < this.config.lockThreshold) continue;
      out.push({
        kind: 'A',
        targetEmail: email,
        targetUserId: entry.userId,
        threshold: this.config.lockThreshold,
        observed: entry.count,
        ips: sortIps(entry.ips),
      });
    }
    return out;
  }

  /**
   * 種別B: 窓内に N アカウント以上でログイン失敗。
   *
   * ⚠️ **アカウント数（広さ）と総回数（深さ）を両方取る。**
   * 「24アカウント」だけでは、1アカウントあたり1回なのか100回なのかが分からず、
   * 偵察なのか本気の総当たりなのか判断できない。
   *
   * ⚠️ 存在しないアドレスへの試行は記録側で重複抑止がかかるため、
   * ここにはほとんど現れない。それは**種別D**で数える
   * （docs/intrusion-detection.md 2.2）。
   */
  private async detectSpray(now: Date): Promise<Detection[]> {
    const where = {
      action: 'auth.signin.failed',
      createdAt: { gte: this.since(now, this.config.windowMinutes) },
    };

    const byAccount = await this.prisma.auditLog.groupBy({
      by: ['actorEmail'],
      where,
      _count: { _all: true },
    });

    if (byAccount.length < this.config.sprayAccountThreshold) return [];

    const totalFailures = byAccount.reduce((sum, r) => sum + r._count._all, 0);

    const byIp = await this.prisma.auditLog.groupBy({
      by: ['ip'],
      where,
      _count: { _all: true },
    });

    const ips = new Map<string, number>();
    for (const row of byIp) ips.set(row.ip ?? 'unknown', row._count._all);

    return [
      {
        kind: 'B',
        threshold: this.config.sprayAccountThreshold,
        observed: byAccount.length,
        accounts: byAccount.length,
        totalFailures,
        // 数字だけでは調査を始められない。どのアカウントかが分かると、
        // 退職者か・特定部署に偏っているか等がすぐ見える
        sampleAccounts: byAccount
          .slice(0, SAMPLE_ACCOUNT_LIMIT)
          .map((r) => r.actorEmail),
        ips: sortIps(ips),
      },
    ];
  }

  /** 種別C: 窓内に 429 が N 回以上。 */
  private detectThrottled(): Detection[] {
    const summary = this.counter.summarize(
      'throttled',
      this.config.windowMinutes,
    );
    if (summary.total < this.config.throttleThreshold) return [];
    return [
      {
        kind: 'C',
        threshold: this.config.throttleThreshold,
        observed: summary.total,
        ips: summary.ips,
      },
    ];
  }

  /** 種別D: 窓内に存在しないアドレスへの試行が N 回以上。 */
  private detectUnknownEmail(): Detection[] {
    const summary = this.counter.summarize(
      'unknownEmail',
      this.config.windowMinutes,
    );
    if (summary.total < this.config.unknownEmailThreshold) return [];
    return [
      {
        kind: 'D',
        threshold: this.config.unknownEmailThreshold,
        observed: summary.total,
        ips: summary.ips,
      },
    ];
  }

  // ───────────────────────────────── 通知と記録

  /** 検知1件を処理する。抑制中なら何もしない。 */
  private async raise(detection: Detection): Promise<void> {
    if (await this.isSuppressed(detection)) return;

    const body = alertBody(detection, this.config.windowMinutes);
    const { status, recipients, delivered, rejected } = await this.send(
      alertSubject(detection.kind),
      body,
    );

    // ⚠️ 記録は送信の成否によらず必ず行う。
    // 「通知が来なかった＝攻撃が無かった」と誤解されるのを防ぐ
    await this.audit.record({
      action: ALERT_ACTION,
      actor: { email: 'system' },
      targetType: detection.targetUserId ? 'user' : undefined,
      targetId: detection.targetUserId,
      targetName: detection.targetEmail,
      detail: {
        meta: {
          kind: detection.kind,
          severity: SEVERITY_OF[detection.kind],
          windowMinutes: this.config.windowMinutes,
          threshold: detection.threshold,
          observed: detection.observed,
          ...(detection.accounts !== undefined && {
            accounts: detection.accounts,
            totalFailures: detection.totalFailures,
            sampleAccounts: detection.sampleAccounts,
          }),
          topIps: detection.ips.slice(0, TOP_IP_LIMIT),
          otherIpCount: Math.max(0, detection.ips.length - TOP_IP_LIMIT),
          mailStatus: status,
          recipients,
          // 送ろうとした人数と、実際に受理された人数を分けて残す
          delivered,
          rejected,
        },
      },
    });

    this.logger.warn(
      `不審なログイン試行を検知しました: 種別${detection.kind} ` +
        `観測=${detection.observed} 閾値=${detection.threshold} ` +
        `対象=${detection.targetEmail ?? '-'} メール=${status}`,
    );
  }

  /**
   * 同一の種別・対象について、窓内にすでに警報を出していれば送らない。
   *
   * **状態は audit_logs 自体**（docs/intrusion-detection.md 4.1）。
   * メモリに持つと、再起動のたびに同じ警報が再送される。
   */
  private async isSuppressed(detection: Detection): Promise<boolean> {
    const found = await this.prisma.auditLog.findFirst({
      where: {
        action: ALERT_ACTION,
        createdAt: {
          gte: new Date(Date.now() - this.config.windowMinutes * 60 * 1000),
        },
        detail: { path: ['meta', 'kind'], equals: detection.kind },
        ...(detection.targetEmail && { targetName: detection.targetEmail }),
      },
      select: { id: true },
    });
    return found !== null;
  }

  // ───────────────────────────────── 終息

  /**
   * 未終息の警報のうち、静穏条件を満たしたものに終息通知を出す。
   *
   * ⚠️ **「条件を満たさない」ではなく「事象が1件も無い」で判定する。**
   * 前者だと、しきい値を下回っただけの**攻撃継続中に終息通知が飛ぶ**
   * （例: ロックが3回→2回に減っただけ）。
   */
  private async resolveQuietAlerts(now: Date): Promise<void> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        action: { in: [ALERT_ACTION, RESOLVED_ACTION] },
        createdAt: { gte: new Date(now.getTime() - OPEN_ALERT_LOOKBACK_MS) },
      },
      select: {
        action: true,
        targetName: true,
        targetId: true,
        detail: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    /** キー → 最後の警報 / 最後の終息。 */
    const latest = new Map<
      string,
      {
        kind: AlertKind;
        targetEmail?: string;
        targetUserId?: string;
        alertAt?: Date;
        resolvedAt?: Date;
      }
    >();

    for (const row of rows) {
      const kind = (row.detail as any)?.meta?.kind as AlertKind | undefined;
      if (!kind) continue;
      const targetEmail = row.targetName ?? undefined;
      const key = detectionKey(kind, targetEmail);

      const entry = latest.get(key) ?? {
        kind,
        targetEmail,
        targetUserId: row.targetId ?? undefined,
      };
      if (row.action === ALERT_ACTION) entry.alertAt = row.createdAt;
      else entry.resolvedAt = row.createdAt;
      latest.set(key, entry);
    }

    for (const entry of latest.values()) {
      if (!entry.alertAt) continue;
      // すでに終息済み（終息が警報より後）ならなにもしない
      if (entry.resolvedAt && entry.resolvedAt > entry.alertAt) continue;

      if (!(await this.isQuiet(entry.kind, entry.targetEmail, now))) continue;

      await this.resolve(entry.kind, entry.targetEmail, entry.targetUserId, entry.alertAt);
    }
  }

  /** 直近 `quietMinutes` に、その条件に該当する事象が1件も無いか。 */
  private async isQuiet(
    kind: AlertKind,
    targetEmail: string | undefined,
    now: Date,
  ): Promise<boolean> {
    const since = this.since(now, this.config.quietMinutes);

    if (kind === 'A') {
      const count = await this.prisma.auditLog.count({
        where: {
          action: 'auth.locked',
          createdAt: { gte: since },
          ...(targetEmail && { actorEmail: targetEmail }),
        },
      });
      return count === 0;
    }

    if (kind === 'B') {
      const count = await this.prisma.auditLog.count({
        where: { action: 'auth.signin.failed', createdAt: { gte: since } },
      });
      return count === 0;
    }

    const counterKind = kind === 'C' ? 'throttled' : 'unknownEmail';
    return (
      this.counter.summarize(counterKind, this.config.quietMinutes).total === 0
    );
  }

  private async resolve(
    kind: AlertKind,
    targetEmail: string | undefined,
    targetUserId: string | undefined,
    detectedAt: Date,
  ): Promise<void> {
    const { status, recipients, delivered, rejected } = await this.send(
      resolvedSubject(),
      resolvedBody(kind, targetEmail, detectedAt, this.config.quietMinutes),
    );

    await this.audit.record({
      action: RESOLVED_ACTION,
      actor: { email: 'system' },
      targetType: targetUserId ? 'user' : undefined,
      targetId: targetUserId,
      targetName: targetEmail,
      detail: {
        meta: {
          kind,
          severity: SEVERITY_OF[kind],
          quietMinutes: this.config.quietMinutes,
          detectedAt: detectedAt.toISOString(),
          mailStatus: status,
          recipients,
          // 送ろうとした人数と、実際に受理された人数を分けて残す
          delivered,
          rejected,
        },
      },
    });

    this.logger.log(
      `不審なログイン試行は収まりました: 種別${kind} 対象=${targetEmail ?? '-'}`,
    );
  }

  // ───────────────────────────────── メール

  /**
   * Admin 全員へ送る。
   *
   * ⚠️ 送信の失敗を呼び出し側へ投げない。**検知が止まるのが最悪**であり、
   * 通知できないことは次善の状態にすぎない。結果は mailStatus として記録する。
   */
  private async send(
    subject: string,
    body: string,
  ): Promise<MailOutcome> {
    if (!this.mail.isEnabled()) {
      // ⚠️ ここで警告を出さない。5分ごとに出るとアプリログが埋まり、
      // 本当の異常が見えなくなる。未設定は起動時に MailService が1回警告済み
      return { status: 'disabled', recipients: 0, delivered: 0, rejected: 0 };
    }

    let admins: { email: string }[] = [];
    try {
      admins = await this.prisma.user.findMany({
        where: { isAdmin: true, isSystem: false },
        select: { email: true },
      });
    } catch (e) {
      this.logger.error(`Admin の取得に失敗しました: ${(e as Error).message}`);
      return { status: 'failed', recipients: 0, delivered: 0, rejected: 0 };
    }

    if (admins.length === 0) {
      // Admin が1人もいないのは構成の異常。記録の recipients=0 でも分かるが、
      // 気づけるようログにも残す
      this.logger.error(
        '検知を通知できません: Admin が1人も登録されていません',
      );
      return { status: 'failed', recipients: 0, delivered: 0, rejected: 0 };
    }

    try {
      const { delivered, rejected } = await this.mail.sendSecurityAlert(
        admins.map((a) => a.email),
        subject,
        body,
      );

      // ⚠️ 一部の宛先が拒否されても sendMail は例外を投げない。
      // 「送った」だけを記録すると、**1人にも届いていないのに成功に見える**。
      if (delivered === 0) {
        this.logger.error(
          `検知通知メールが1人にも届きませんでした（${rejected}件が拒否されました）`,
        );
        return {
          status: 'failed',
          recipients: admins.length,
          delivered,
          rejected,
        };
      }

      return {
        status: 'success',
        recipients: admins.length,
        delivered,
        rejected,
      };
    } catch (e) {
      this.logger.error(
        `検知通知メールの送信に失敗しました: ${(e as Error).message}`,
      );
      // ⚠️ ここを rejected: admins.length にしてはいけない。
      // 例外の大半は接続不能・認証失敗であり、**宛先が拒否されたわけではない**。
      // 「2件拒否」と記録すると、運用者は Admin のアドレスが無効だと考えて
      // アカウントの整理を始めてしまう。実際は SMTP サーバー側の問題である。
      //
      // 送信そのものが成立していない事実は status: 'failed' が示す。
      return {
        status: 'failed',
        recipients: admins.length,
        delivered: 0,
        rejected: 0,
      };
    }
  }
}

/** 件数の多い順に並べる。 */
function sortIps(ips: Map<string, number>): { ip: string; count: number }[] {
  return [...ips.entries()]
    .map(([ip, count]) => ({ ip, count }))
    .sort((a, b) => b.count - a.count);
}

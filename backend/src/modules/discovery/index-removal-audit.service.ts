import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { IndexReaderService } from './index-reader.service';
import { judgeIndexEntry, sameTags } from './index-entry-safety';

/**
 * #151 段階3 PR5-b: **共有目次（`meta.pages`）を消してよいかを判定する。**
 *
 * ## なぜ専用の判定が要るのか
 *
 * 既存の `DocMetaAuditService` は「台帳と目次が一致しているか」を見る。
 * それは段階2-2（表示元を台帳へ切り替える）の問いだった。
 *
 * ⚠️ **PR5-b の問いは違う。** 段階3 では台帳のほうが新しいのが**正常**で、
 * 一致しないこと自体は異常ではない。問うべきは1つだけ。
 *
 * > **目次を消したときに、失われる情報があるか。**
 *
 * ## 判定
 *
 * | 状態 | 消してよいか | 理由 |
 * |---|:---:|---|
 * | 目次にあって**台帳に無い** | ❌ | **復元手段が無い。消すと題が永久に失われる** |
 * | 不一致で、そのフィールドの**版数が 0** | ❌ | 台帳がまだ所有していない＝**目次が正**（7.7.2） |
 * | 不一致だが**版数が 1 以上** | ✅ | 台帳が所有済み。目次が古いだけ |
 * | 一致 | ✅ | — |
 * | 台帳にしか無い | ✅ | 目次に無いのだから消しても影響しない |
 *
 * ⚠️ **「不一致 0 件」を条件にしないこと。** 段階3 が動いていれば
 * 台帳のほうが新しくなるため、**永久に条件を満たさない**。
 * それを待つと掃除できず、既存ワークスペースでは題が漏れ続ける。
 *
 * 詳細は docs/discovery-stage3-comparison.md 7.7
 */
@Injectable()
export class IndexRemovalAuditService {
  constructor(
    private prisma: PrismaService,
    private sync: IndexReaderService,
  ) {}

  async auditWorkspace(workspaceId: string): Promise<IndexRemovalAudit> {
    const pages = await this.sync.readIndex(workspaceId);

    const metas = await this.prisma.docMeta.findMany({
      where: { workspaceId },
      select: {
        docId: true,
        title: true,
        tagIds: true,
        trash: true,
        titleRevision: true,
        trashRevision: true,
        tagsRevision: true,
      },
    });
    const byId = new Map(metas.map((m) => [m.docId, m]));

    const result: IndexRemovalAudit = {
      workspaceId,
      indexed: pages?.length ?? 0,
      noIndex: pages === null,
      unrecoverable: [],
      indexAuthoritative: [],
      safeStale: 0,
      changedDuringAudit: false,
    };
    if (pages === null) return result;

    for (const page of pages) {
      const meta = byId.get(page.id);

      // ⚠️ 台帳に行が無い＝**消したら復元できない**
      if (!meta) {
        result.unrecoverable.push({
          docId: page.id,
          title: page.title,
          reason: '台帳に行が無い',
        });
        continue;
      }

      // ⚠️ **判定は `judgeIndexEntry` に委ねること。** 掃除側と別々に
      // 書いたところ食い違い、点検は「安全」と言うのに掃除はほとんど
      // 消せない、という状態になった（2026-08-27）
      const judgement = judgeIndexEntry(page, meta);
      const risky = judgement.purgeable ? [] : [judgement.reason];

      if (risky.length > 0) {
        result.indexAuthoritative.push({ docId: page.id, reasons: risky });
        continue;
      }

      // 一致していない（が台帳が所有済み）なら「古いだけ」として数える
      const stale =
        (page.title !== null && (meta.title ?? null) !== page.title) ||
        meta.trash !== page.trash ||
        !sameTags(meta.tagIds, page.tags);
      if (stale) result.safeStale++;
    }

    // ⚠️ **判定は「その瞬間」のものでしかない。**
    // 目次と台帳は別の時点で読んでいるうえ、稼働中はいつでも
    // 目次が動く。動いていたら、その分を見落としたまま
    // 「安全」と答えている可能性がある。
    //
    // ```
    // 目次を読む → （この間に別の利用者がページを追加）→ 台帳を読む
    //            ↓ 追加分は目次にも台帳にも現れず、判定に入らない
    // 「安全」と答える → 掃除する → 追加されたページの題が失われる
    // ```
    //
    // 読み直して変化を見れば、少なくとも**見落としたことに気づける**。
    const after = await this.sync.readIndex(workspaceId);
    result.changedDuringAudit = !sameIndex(pages, after);

    return result;
  }

  async auditAll(): Promise<IndexRemovalReport> {
    const workspaces = await this.prisma.workspace.findMany({
      select: { id: true, name: true },
    });

    const results: IndexRemovalAudit[] = [];
    for (const ws of workspaces) {
      const audit = await this.auditWorkspace(ws.id);
      results.push({ ...audit, name: ws.name });
    }

    return {
      workspaces: results,
      indexed: results.reduce((n, r) => n + r.indexed, 0),
      unrecoverable: results.reduce((n, r) => n + r.unrecoverable.length, 0),
      indexAuthoritative: results.reduce(
        (n, r) => n + r.indexAuthoritative.length,
        0,
      ),
      safeStale: results.reduce((n, r) => n + r.safeStale, 0),
      changedDuringAudit: results.filter((r) => r.changedDuringAudit).length,
    };
  }
}

export interface IndexRemovalAudit {
  workspaceId: string;
  name?: string | null;
  /** 目次に載っている件数 */
  indexed: number;
  /** 目次そのものが無い（未同期） */
  noIndex: boolean;
  /** ⚠️ **消すと失われる。** 台帳に行が無い */
  unrecoverable: Array<{ docId: string; title: string | null; reason: string }>;
  /** ⚠️ **消すと失われる。** 版数 0 ＝台帳がまだ所有しておらず、目次が正 */
  indexAuthoritative: Array<{ docId: string; reasons: string[] }>;
  /** 不一致だが台帳が所有済み（＝消してよい） */
  safeStale: number;
  /**
   * ⚠️ **点検中に目次が動いた。** その分を見落としている可能性があり、
   * この結果を根拠に掃除してはいけない。書き込みが止まっている時間帯に
   * 取り直すこと。
   */
  changedDuringAudit: boolean;
}

export interface IndexRemovalReport {
  workspaces: IndexRemovalAudit[];
  indexed: number;
  unrecoverable: number;
  indexAuthoritative: number;
  safeStale: number;
  /** ⚠️ 点検中に目次が動いたワークスペースの数 */
  changedDuringAudit: number;
}


/**
 * 点検の前後で目次が同じか。
 *
 * ⚠️ 中身まで見ること。件数だけでは、**題の変更を見落とす**。
 */
function sameIndex(
  before: Array<{ id: string; title: string | null; tags: string[]; trash: boolean }> | null,
  after: Array<{ id: string; title: string | null; tags: string[]; trash: boolean }> | null,
): boolean {
  if (before === null || after === null) return before === after;
  return JSON.stringify(before) === JSON.stringify(after);
}

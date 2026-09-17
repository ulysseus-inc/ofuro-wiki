import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { IndexReaderService } from './index-reader.service';

/**
 * #151: Yjs の目次と `doc_meta`（台帳）が一致しているかを検査する。
 *
 * ## なぜ要るか
 *
 * いまの `doc_meta` は**誰も見ていない台帳**で、ズレていても誰も気づかない。
 * 段階2-2 で一覧の表示元を台帳に切り替えた瞬間、そのズレは
 * **そのまま利用者に見える不具合**になる。
 *
 * 切り替える前に「全件一致している」ことを実データで示すために作った。
 *
 * ## 何を異常と呼ぶか
 *
 * ⚠️ **差異＝異常ではない。** 分けないと、正常な差異に埋もれて
 * 本当の異常を見落とす。
 *
 * | 差異 | 判定 |
 * |---|---|
 * | 目次にあり台帳に無い | **異常**（一覧から消える） |
 * | `trash` 不一致 | **異常**（ゴミ箱のページが一覧に出る） |
 * | `title` / `tags` 不一致 | **異常** |
 * | 台帳にあり目次に無い | 正常（内部API 由来。消さない設計） |
 * | `updatedAt` 不一致 | 許容（版数を上げない設計。並び順が一手古いだけ） |
 */
@Injectable()
export class DocMetaAuditService {
  constructor(
    private prisma: PrismaService,
    private sync: IndexReaderService,
  ) {}

  /** 1ワークスペースを検査する。 */
  async auditWorkspace(workspaceId: string): Promise<WorkspaceAudit> {
    // ⚠️ 同期と**同じ読み取り経路**を使う。別に書くと、
    // 検査は通るのに同期が壊れている（またはその逆）が起こる
    const pages = await this.sync.readIndex(workspaceId);

    const metas = await this.prisma.docMeta.findMany({
      where: { workspaceId },
      select: { docId: true, title: true, tagIds: true, trash: true },
    });
    const byId = new Map(metas.map((m) => [m.docId, m]));

    const result: WorkspaceAudit = {
      workspaceId,
      indexed: pages?.length ?? 0,
      recorded: metas.length,
      missing: [],
      mismatched: [],
      extra: 0,
      noIndex: pages === null,
    };
    if (pages === null) return result;

    const seen = new Set<string>();
    for (const page of pages) {
      seen.add(page.id);
      const meta = byId.get(page.id);
      if (!meta) {
        result.missing.push(page.id);
        continue;
      }

      const reasons: string[] = [];
      // ⚠️ 目次に題が無いときは同期が書かない。**書かない値を異常と呼ばない**
      if (page.title !== null && (meta.title ?? null) !== page.title) {
        reasons.push(
          `題: 台帳=${JSON.stringify(meta.title)} 目次=${JSON.stringify(page.title)}`,
        );
      }
      if (meta.trash !== page.trash) {
        reasons.push(`ゴミ箱: 台帳=${meta.trash} 目次=${page.trash}`);
      }
      if (
        meta.tagIds.length !== page.tags.length ||
        meta.tagIds.some((t, i) => t !== page.tags[i])
      ) {
        reasons.push(
          `タグ: 台帳=${meta.tagIds.length}件 目次=${page.tags.length}件`,
        );
      }
      if (reasons.length > 0) {
        result.mismatched.push({ docId: page.id, reasons });
      }
    }

    // 台帳にしか無いもの。設計上ありうるので件数だけ数える
    result.extra = metas.filter((m) => !seen.has(m.docId)).length;
    return result;
  }

  /** 全ワークスペースを検査する。 */
  async auditAll(): Promise<Audit> {
    const workspaces = await this.prisma.workspace.findMany({
      select: { id: true, name: true },
    });

    const results: WorkspaceAudit[] = [];
    for (const ws of workspaces) {
      const r = await this.auditWorkspace(ws.id);
      r.name = ws.name;
      results.push(r);
    }

    return {
      workspaces: results,
      indexed: results.reduce((n, r) => n + r.indexed, 0),
      missing: results.reduce((n, r) => n + r.missing.length, 0),
      mismatched: results.reduce((n, r) => n + r.mismatched.length, 0),
      extra: results.reduce((n, r) => n + r.extra, 0),
    };
  }
}

export interface WorkspaceAudit {
  workspaceId: string;
  name?: string | null;
  /** 目次にある件数 */
  indexed: number;
  /** 台帳にある件数 */
  recorded: number;
  /** ⚠️ 目次にあるのに台帳に無い＝一覧から消える */
  missing: string[];
  /** ⚠️ 内容が食い違う */
  mismatched: Array<{ docId: string; reasons: string[] }>;
  /** 台帳にしか無い件数（設計上ありうる） */
  extra: number;
  /** 目次そのものが無い（未同期のワークスペース） */
  noIndex: boolean;
}

export interface Audit {
  workspaces: WorkspaceAudit[];
  indexed: number;
  missing: number;
  mismatched: number;
  extra: number;
}

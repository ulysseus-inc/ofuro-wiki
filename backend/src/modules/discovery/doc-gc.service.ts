import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { DiscoveryRevisionService } from './discovery-revision.service';

/** 完全削除の結果。`deleted` は実際に何かを消したかどうか。 */
export interface DocPurgeResult {
  deleted: boolean;
}

/**
 * #45: ページを完全に消す。**消す対象を知っている唯一の場所。**
 *
 * 入口は2つあり、どちらもここを通る（docs/permanent-delete.md 5章）。
 *
 * ```
 *   space:delete-doc ──┐
 *                      ├──▶ DocGcService.purge
 *   deleteDocMeta ─────┘
 * ```
 *
 * ⚠️ **認可はここでは見ない。** 入口が済ませてから呼ぶ。
 * 判定を2か所に置くと、いつか食い違う（docs/doc-permission.md）。
 */
@Injectable()
export class DocGcService {
  private readonly logger = new Logger(DocGcService.name);

  constructor(
    private prisma: PrismaService,
    private discovery: DiscoveryRevisionService,
  ) {}

  async purge(workspaceId: string, docId: string): Promise<DocPurgeResult> {
    const [, , , meta] = await this.prisma.$transaction([
      this.prisma.docUpdate.deleteMany({ where: { workspaceId, docId } }),
      this.prisma.docSnapshot.deleteMany({ where: { workspaceId, docId } }),
      // ⚠️ #45: 履歴も本文そのもの。残すと、台帳が無いぶん権限が
      // ワークスペースの権限に落ち、**消したページの過去の版を
      // 履歴APIから読めてしまう**（doc.resolver.ts の listHistory）
      this.prisma.docHistory.deleteMany({ where: { workspaceId, docId } }),
      // ⚠️ #151: 台帳から消える＝一覧の中身が変わる
      this.prisma.docMeta.deleteMany({ where: { workspaceId, docId } }),
      // ⚠️ #45: 索引を残すと、doc ごとの権限を引けずに
      // 「ワークスペースのメンバーなら読める」に落ち、
      // **消したページの本文が検索結果に出る**
      this.prisma.searchIndex.deleteMany({ where: { workspaceId, docId } }),
      // #101: 作り直し待ちの印も消す。残すと、消えたページを
      // 巡回が延々と作り直そうとする
      this.prisma.searchIndexQueue.deleteMany({ where: { workspaceId, docId } }),
    ]);

    // ⚠️ **版数は削除した「あと」に上げる。**
    // 先に上げると、その間に一覧を取った利用者が
    // 「新しい版数 ＋ 削除前の一覧」を固定し、**永久に取り直さない**。
    // 失敗したときに版数だけ進むことも避けられる。
    if (meta.count > 0) {
      await this.discovery.bump(workspaceId, 'doc-delete');
    }

    this.logger.log(`Deleted doc ${workspaceId}/${docId}`);
    return { deleted: meta.count > 0 };
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { createDocFromUpdates } from '../sync/yjs.utils';

/**
 * #151: **共有目次（`rootYDoc.meta.pages`）を読む。**
 *
 * ## ⚠️ 読むだけ。台帳へは書かない
 *
 * かつてここには `DocMetaSyncService` があり、目次を `doc_meta` へ写していた。
 * 段階3 で**台帳が正**になり、目次への書き込みも止めたため、写す仕事は
 * 無くなった（7.7.5）。**目次は空**なので、残しても何もしない。
 *
 * いま残っているのは**点検のための読み取り**だけ。
 *
 * | 使う人 | 何のために |
 * |---|---|
 * | `DocMetaAuditService` | 台帳と目次の食い違いを数える |
 * | `IndexRemovalAuditService` | 目次を消してよいかを判定する（7.8.5） |
 *
 * ⚠️ **書き込みを戻さないこと。** 戻すと、台帳が正という前提が崩れ、
 * 版数 0 の行を黙って書き換える経路が復活する（7.7.2 の移行判定は
 * 段階3 の完了とともに捨てた）。
 */
@Injectable()
export class IndexReaderService {
  constructor(private prisma: PrismaService) {}

  async readIndex(workspaceId: string): Promise<IndexedPage[] | null> {
    // 目次は docId === workspaceId のドキュメント
    const [snapshot, updates] = await Promise.all([
      this.prisma.docSnapshot.findUnique({
        where: { workspaceId_docId: { workspaceId, docId: workspaceId } },
        select: { blob: true },
      }),
      this.prisma.docUpdate.findMany({
        where: { workspaceId, docId: workspaceId },
        select: { blob: true },
        orderBy: { timestamp: 'asc' },
      }),
    ]);
    if (!snapshot && updates.length === 0) return null;

    const doc = createDocFromUpdates([
      ...(snapshot ? [new Uint8Array(snapshot.blob)] : []),
      ...updates.map((u) => new Uint8Array(u.blob)),
    ]);

    const pages = doc.getMap('meta').get('pages') as any;
    if (!pages || typeof pages.length !== 'number') return null;

    const out: IndexedPage[] = [];
    for (let i = 0; i < pages.length; i++) {
      const entry = pages.get(i);
      const id = this.field(entry, 'id');
      if (typeof id !== 'string' || !id) continue;

      const title = this.field(entry, 'title');
      const tags = this.field(entry, 'tags');
      out.push({
        id,
        title: typeof title === 'string' ? title : null,
        // タグは Y.Array のことも配列のこともある
        tags: this.toStringArray(tags),
        trash: this.field(entry, 'trash') === true,
        createdAt: this.toDate(this.field(entry, 'createDate')),
        updatedAt: this.toDate(this.field(entry, 'updatedDate')),
      });
    }
    return out;
  }

  /**
   * 目次の項目から値を取り出す。
   *
   * ⚠️ 項目は `Y.Map` とは限らない。Yjs の配列には素のオブジェクトも入る。
   * `entry.get(...)` だけで読むと、そういう項目は id を取れずに読み飛ばされ、
   * **そのページが黙って一覧から消える**。
   *
   * （開発 DB の実測では 590 項目すべて `Y.Map` で、現に起きてはいない。
   * それでも入れているのは、壊れ方が無言だから）
   */
  private field(entry: unknown, key: string): unknown {
    if (entry && typeof (entry as any).get === 'function') {
      return (entry as any).get(key);
    }
    if (entry && typeof entry === 'object') return (entry as any)[key];
    return undefined;
  }

  private toStringArray(value: unknown): string[] {
    const arr =
      value && typeof (value as any).toArray === 'function'
        ? (value as any).toArray()
        : value;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === 'string');
  }

  private toDate(value: unknown): Date | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
}

export interface IndexedPage {
  id: string;
  title: string | null;
  tags: string[];
  trash: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

import { Injectable, Logger } from '@nestjs/common';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma.service';

interface BlockData {
  blockId: string;
  blockType: string;
  content: string;
}

/** #91: 巨大な表で1レコードが肥大化しないための上限 */
const MAX_DATABASE_TEXT_LENGTH = 10000;

@Injectable()
export class IndexerService {
  private readonly logger = new Logger(IndexerService.name);
  private debounceTimers = new Map<string, NodeJS.Timeout>();

  constructor(private prisma: PrismaService) {}

  scheduleIndex(workspaceId: string, docId: string) {
    const key = `${workspaceId}:${docId}`;
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key);
        this.indexDocument(workspaceId, docId).catch((err) => {
          this.logger.error(
            `Failed to index ${workspaceId}/${docId}: ${err.message}`,
          );
        });
      }, 3000),
    );
  }

  async indexDocument(workspaceId: string, docId: string) {
    // Load the latest doc state
    const snapshot = await this.prisma.docSnapshot.findUnique({
      where: { workspaceId_docId: { workspaceId, docId } },
    });

    const updates = await this.prisma.docUpdate.findMany({
      where: { workspaceId, docId },
      orderBy: { timestamp: 'asc' },
    });

    const doc = new Y.Doc();
    if (snapshot) {
      Y.applyUpdate(doc, new Uint8Array(snapshot.blob));
    }
    for (const u of updates) {
      Y.applyUpdate(doc, new Uint8Array(u.blob));
    }

    // Extract blocks from Yjs doc
    const blocks = this.extractBlocks(doc);
    const title = this.extractTitle(doc);

    // Delete old index entries for this doc
    await this.prisma.searchIndex.deleteMany({
      where: { workspaceId, docId },
    });

    // Insert new entries
    if (blocks.length > 0) {
      await this.prisma.searchIndex.createMany({
        data: blocks.map((block) => ({
          workspaceId,
          docId,
          blockId: block.blockId,
          title,
          content: block.content,
          blockType: block.blockType,
        })),
      });
    } else if (title) {
      // At minimum, index the title
      await this.prisma.searchIndex.create({
        data: {
          workspaceId,
          docId,
          title,
          content: title,
          blockType: 'title',
        },
      });
    }

    this.logger.log(
      `Indexed ${workspaceId}/${docId}: ${blocks.length} blocks`,
    );
  }

  async indexAllDocuments(workspaceId: string) {
    // Get all distinct docIds for this workspace from snapshots
    const snapshots = await this.prisma.docSnapshot.findMany({
      where: { workspaceId },
      select: { docId: true },
    });

    this.logger.log(
      `Reindexing workspace ${workspaceId}: ${snapshots.length} documents`,
    );

    for (const { docId } of snapshots) {
      try {
        await this.indexDocument(workspaceId, docId);
      } catch (err) {
        this.logger.error(
          `Failed to index ${workspaceId}/${docId}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(`Reindex complete for workspace ${workspaceId}`);
  }

  private extractTitle(doc: Y.Doc): string | undefined {
    // AFFiNE stores page meta in a shared map
    try {
      const meta = doc.getMap('meta');
      const title = meta?.get('title');
      if (typeof title === 'string') return title;
    } catch {
      // ignore
    }

    // Fallback: try to get title from blocks
    try {
      const blocks = doc.getMap('blocks');
      if (blocks) {
        for (const [, value] of blocks.entries()) {
          if (value instanceof Y.Map) {
            const flavour = value.get('sys:flavour');
            if (flavour === 'affine:page') {
              const title = value.get('prop:title');
              if (title instanceof Y.Text) {
                return title.toString();
              }
            }
          }
        }
      }
    } catch {
      // ignore
    }

    return undefined;
  }

  /**
   * #91: データベースブロック（affine:database）から検索対象テキストを取り出す。
   *
   * データ構造（`frontend/blocksuite/affine/model/.../database-model.ts`）:
   *   prop:columns … [{ id, type, name, data }]
   *   prop:cells   … { 行ID: { 列ID: { columnId, value } } }
   *
   * 行の見出し（タイトル列）は子ブロック（affine:paragraph / affine:list）として
   * 別途インデックスされるため、ここでは扱わない。
   */
  private extractDatabaseText(block: Y.Map<any>): string | undefined {
    const parts: string[] = [];
    let truncated = false;

    try {
      // 列の定義（列名・型・選択肢）を先に読む
      const columns = this.toPlain(block.get('prop:columns'));
      const columnById = new Map<
        string,
        { type?: string; options: Map<string, string> }
      >();

      if (Array.isArray(columns)) {
        for (const column of columns) {
          if (!column || typeof column !== 'object') continue;

          // 列名そのものも検索対象にする（「担当者」で探せるように）
          if (typeof column.name === 'string' && column.name.trim()) {
            parts.push(column.name.trim());
          }

          const options = new Map<string, string>();
          const rawOptions = (column.data as Record<string, unknown>)?.options;
          if (Array.isArray(rawOptions)) {
            for (const option of rawOptions) {
              if (option && typeof option === 'object' && option.id != null) {
                options.set(String(option.id), String(option.value ?? ''));
              }
            }
          }

          if (column.id != null) {
            columnById.set(String(column.id), {
              type: typeof column.type === 'string' ? column.type : undefined,
              options,
            });
          }
        }
      }

      // セルの値
      let length = parts.reduce((sum, part) => sum + part.length + 1, 0);
      const cells = this.toPlain(block.get('prop:cells'));

      if (cells && typeof cells === 'object') {
        rows: for (const row of Object.values(cells as Record<string, unknown>)) {
          if (!row || typeof row !== 'object') continue;

          for (const cell of Object.values(row as Record<string, unknown>)) {
            if (!cell || typeof cell !== 'object') continue;

            const { columnId, value } = cell as {
              columnId?: unknown;
              value?: unknown;
            };
            const column =
              columnId != null ? columnById.get(String(columnId)) : undefined;

            const rendered = this.renderCellValue(value, column);
            if (!rendered) continue;

            // 上限に達したら打ち切る。文字列を積んでから切り捨てるのではなく、
            // 積む前に止めることで巨大な表でも余分なメモリを使わない。
            if (length + rendered.length + 1 > MAX_DATABASE_TEXT_LENGTH) {
              truncated = true;
              break rows;
            }

            parts.push(rendered);
            length += rendered.length + 1;
          }
        }
      }
    } catch (err) {
      this.logger.warn(`Database block extraction failed: ${err}`);
    }

    if (parts.length === 0) return undefined;

    if (truncated) {
      // 静かに欠落すると原因調査が困難になるため記録する
      this.logger.debug(
        `Database block text truncated at ${MAX_DATABASE_TEXT_LENGTH} chars; ` +
          `後半の行は検索対象に含まれません`
      );
    }

    return parts.join(' ').trim();
  }

  /** セルの値を検索用テキストに変換する。検索の役に立たない値は undefined を返す。 */
  private renderCellValue(
    value: unknown,
    column?: { type?: string; options: Map<string, string> }
  ): string | undefined {
    if (value == null) return undefined;

    // チェックボックスは true/false であり、検索語にならない
    if (typeof value === 'boolean') return undefined;

    if (typeof value === 'number') {
      if (column?.type === 'date') return this.renderDateValue(value);

      // 進捗（0〜100）は「0」「50」といった値が大量に入り、検索ノイズになるだけなので除外する
      if (column?.type === 'progress') return undefined;

      return String(value);
    }

    if (typeof value === 'string') {
      // select は選択肢 ID が入るため、表示名に解決する
      return column?.options.get(value) ?? value;
    }

    if (Array.isArray(value)) {
      // multi-select
      const items = value
        .map(item =>
          typeof item === 'string'
            ? (column?.options.get(item) ?? item)
            : this.renderCellValue(item, column)
        )
        .filter(Boolean);
      return items.length ? items.join(' ') : undefined;
    }

    return undefined;
  }

  /**
   * 日付セル（タイムスタンプ）を検索用の `YYYY-MM-DD` に変換する。
   *
   * フロントエンドは date-fns の `format(value, 'yyyy-MM-dd')`（＝ブラウザの
   * ローカルタイムゾーン）で表示・保存する。一方サーバーを UTC で動かすと、
   * JST で 2026-07-28 を選んだ値が UTC では 2026-07-27 になり、
   * **画面に見えている日付で検索してもヒットしない**。
   *
   * サーバーとブラウザのタイムゾーンが一致する保証はないため、
   * 両方が異なる場合は両方を検索対象に含める。
   */
  private renderDateValue(value: number): string | undefined {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;

    const local = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
    const utc = date.toISOString().slice(0, 10);

    return local === utc ? local : `${local} ${utc}`;
  }

  /** Yjs の型（Y.Map / Y.Array / Y.Text）を素の JS 値に変換する。 */
  private toPlain(value: unknown): unknown {
    if (value instanceof Y.Text) return value.toString();
    if (value instanceof Y.Map || value instanceof Y.Array) {
      return value.toJSON();
    }
    return value;
  }

  private extractBlocks(doc: Y.Doc): BlockData[] {
    const results: BlockData[] = [];

    try {
      const blocks = doc.getMap('blocks');
      if (!blocks) return results;

      for (const [blockId, value] of blocks.entries()) {
        if (!(value instanceof Y.Map)) continue;

        const flavour = value.get('sys:flavour') as string | undefined;
        if (!flavour) continue;

        // #91: データベースブロックはセルの値が prop:cells に入るため、
        // prop:text / prop:title だけでは中身を拾えない。
        const parts = [this.extractText(value)];
        if (flavour === 'affine:database') {
          parts.push(this.extractDatabaseText(value));
        }
        const content = parts.filter(Boolean).join(' ');

        if (content) {
          results.push({
            blockId,
            blockType: flavour,
            content,
          });
        }
      }
    } catch (err) {
      this.logger.warn(`Block extraction failed: ${err}`);
    }

    return results;
  }

  private extractText(block: Y.Map<any>): string | undefined {
    // Try prop:text (most common text field in AFFiNE blocks)
    const propText = block.get('prop:text');
    if (propText instanceof Y.Text) {
      const text = propText.toString().trim();
      if (text) return text;
    }

    // Try prop:title (page blocks)
    const propTitle = block.get('prop:title');
    if (propTitle instanceof Y.Text) {
      const text = propTitle.toString().trim();
      if (text) return text;
    }

    return undefined;
  }
}

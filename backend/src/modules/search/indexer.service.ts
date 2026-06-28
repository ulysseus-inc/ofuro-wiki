import { Injectable, Logger } from '@nestjs/common';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma.service';

interface BlockData {
  blockId: string;
  blockType: string;
  content: string;
}

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

  private extractBlocks(doc: Y.Doc): BlockData[] {
    const results: BlockData[] = [];

    try {
      const blocks = doc.getMap('blocks');
      if (!blocks) return results;

      for (const [blockId, value] of blocks.entries()) {
        if (!(value instanceof Y.Map)) continue;

        const flavour = value.get('sys:flavour') as string | undefined;
        if (!flavour) continue;

        const text = this.extractText(value);
        if (text) {
          results.push({
            blockId,
            blockType: flavour,
            content: text,
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

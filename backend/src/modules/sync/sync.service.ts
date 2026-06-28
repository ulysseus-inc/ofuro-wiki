import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { mergeUpdates, diffUpdate, encodeStateVector } from './yjs.utils';

const SNAPSHOT_THRESHOLD = 50; // Rebuild snapshot after N updates

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(private prisma: PrismaService) {}

  async loadDoc(
    workspaceId: string,
    docId: string,
    clientStateVector?: Uint8Array,
  ): Promise<{
    missing: Uint8Array;
    state: Uint8Array;
    timestamp: number;
  }> {
    // Get snapshot
    const snapshot = await this.prisma.docSnapshot.findUnique({
      where: {
        workspaceId_docId: { workspaceId, docId },
      },
    });

    // Get pending updates since snapshot
    const updates = await this.prisma.docUpdate.findMany({
      where: { workspaceId, docId },
      orderBy: { timestamp: 'asc' },
    });

    const allUpdates: Uint8Array[] = [];
    if (snapshot) {
      allUpdates.push(new Uint8Array(snapshot.blob));
    }
    for (const u of updates) {
      allUpdates.push(new Uint8Array(u.blob));
    }

    let fullUpdate: Uint8Array;
    if (allUpdates.length === 0) {
      // New doc — empty state
      const { encodeStateAsUpdate } = await import('yjs');
      const { Doc } = await import('yjs');
      const doc = new Doc();
      fullUpdate = encodeStateAsUpdate(doc);
    } else {
      fullUpdate = mergeUpdates(allUpdates);
    }

    const stateVector = encodeStateVector(fullUpdate);

    let missing: Uint8Array;
    if (clientStateVector && clientStateVector.length > 0) {
      missing = diffUpdate(fullUpdate, clientStateVector);
    } else {
      missing = fullUpdate;
    }

    return {
      missing,
      state: stateVector,
      timestamp: Date.now(),
    };
  }

  async pushUpdate(
    workspaceId: string,
    docId: string,
    update: Uint8Array,
    editorId?: string,
  ): Promise<number> {
    const now = new Date();

    // Guard against stale client data: reject if workspace no longer exists
    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    });
    if (!ws) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }

    await this.prisma.docUpdate.create({
      data: {
        workspaceId,
        docId,
        blob: Buffer.from(update),
        timestamp: now,
        editorId,
      },
    });

    // Check if we should rebuild the snapshot
    const updateCount = await this.prisma.docUpdate.count({
      where: { workspaceId, docId },
    });

    if (updateCount >= SNAPSHOT_THRESHOLD) {
      await this.rebuildSnapshot(workspaceId, docId, editorId);
    }

    return now.getTime();
  }

  private async rebuildSnapshot(
    workspaceId: string,
    docId: string,
    editorId?: string,
  ) {
    this.logger.log(`Rebuilding snapshot for ${workspaceId}/${docId}`);

    const snapshot = await this.prisma.docSnapshot.findUnique({
      where: { workspaceId_docId: { workspaceId, docId } },
    });

    const updates = await this.prisma.docUpdate.findMany({
      where: { workspaceId, docId },
      orderBy: { timestamp: 'asc' },
    });

    const allUpdates: Uint8Array[] = [];
    if (snapshot) {
      allUpdates.push(new Uint8Array(snapshot.blob));
    }
    for (const u of updates) {
      allUpdates.push(new Uint8Array(u.blob));
    }

    if (allUpdates.length === 0) return;

    const merged = mergeUpdates(allUpdates);
    const now = new Date();

    // マージした更新のIDのみを削除対象にする（マージ中に届いた新規更新を消さないため）
    const mergedIds = updates.map((u) => u.id);

    await this.prisma.$transaction([
      // Update snapshot (DocHistory saving is handled by hourly cron)
      this.prisma.docSnapshot.upsert({
        where: { workspaceId_docId: { workspaceId, docId } },
        create: {
          workspaceId,
          docId,
          blob: Buffer.from(merged),
          timestamp: now,
          editorId,
        },
        update: {
          blob: Buffer.from(merged),
          timestamp: now,
          editorId,
        },
      }),
      // マージ済みの更新のみ削除（新規到着分は残す）
      this.prisma.docUpdate.deleteMany({
        where: { id: { in: mergedIds } },
      }),
    ]);

    this.logger.log(
      `Snapshot rebuilt for ${workspaceId}/${docId} (${updates.length} updates merged)`,
    );
  }

  async getDocSnapshot(workspaceId: string, docId: string) {
    return this.prisma.docSnapshot.findUnique({
      where: { workspaceId_docId: { workspaceId, docId } },
    });
  }

  async getDocTimestamps(
    workspaceId: string,
    after?: number,
  ): Promise<Record<string, number>> {
    // Get latest timestamp for each doc from snapshots and updates
    const snapshots = await this.prisma.docSnapshot.findMany({
      where: {
        workspaceId,
        ...(after && { timestamp: { gt: new Date(after) } }),
      },
      select: { docId: true, timestamp: true },
    });

    const updates = await this.prisma.docUpdate.groupBy({
      by: ['docId'],
      where: {
        workspaceId,
        ...(after && { timestamp: { gt: new Date(after) } }),
      },
      _max: { timestamp: true },
    });

    const result: Record<string, number> = {};

    for (const s of snapshots) {
      result[s.docId] = s.timestamp.getTime();
    }

    for (const u of updates) {
      const ts = u._max.timestamp?.getTime() ?? 0;
      if (!result[u.docId] || ts > result[u.docId]) {
        result[u.docId] = ts;
      }
    }

    return result;
  }

  async deleteDoc(workspaceId: string, docId: string) {
    await this.prisma.$transaction([
      this.prisma.docUpdate.deleteMany({ where: { workspaceId, docId } }),
      this.prisma.docSnapshot.deleteMany({
        where: { workspaceId, docId },
      }),
      this.prisma.docMeta.deleteMany({ where: { workspaceId, docId } }),
      this.prisma.searchIndex.deleteMany({ where: { workspaceId, docId } }),
    ]);
    this.logger.log(`Deleted doc ${workspaceId}/${docId}`);
  }
}

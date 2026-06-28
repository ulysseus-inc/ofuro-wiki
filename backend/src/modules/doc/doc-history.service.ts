import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import * as Y from 'yjs';

@Injectable()
export class DocHistoryService {
  constructor(private prisma: PrismaService) {}

  async listHistory(
    workspaceId: string,
    docId: string,
    options?: { take?: number; before?: Date },
  ) {
    return this.prisma.docHistory.findMany({
      where: {
        workspaceId,
        docId,
        ...(options?.before && { timestamp: { lt: options.before } }),
      },
      orderBy: { timestamp: 'desc' },
      take: options?.take ?? 20,
      select: {
        id: true,
        timestamp: true,
        editorId: true,
        editor: {
          select: { name: true, avatarUrl: true },
        },
      },
    });
  }

  async getHistoryByTimestamp(
    workspaceId: string,
    docId: string,
    timestamp: Date,
  ) {
    return this.prisma.docHistory.findFirst({
      where: {
        workspaceId,
        docId,
        timestamp,
      },
    });
  }

  async recoverDoc(workspaceId: string, docId: string, historyId: bigint) {
    const history = await this.prisma.docHistory.findUnique({
      where: { id: historyId },
    });
    if (!history) {
      throw new Error('History entry not found');
    }

    // Apply the historical snapshot as the current state
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.docSnapshot.upsert({
        where: { workspaceId_docId: { workspaceId, docId } },
        create: {
          workspaceId,
          docId,
          blob: history.blob,
          timestamp: now,
        },
        update: {
          blob: history.blob,
          timestamp: now,
        },
      }),
      // Clear pending updates
      this.prisma.docUpdate.deleteMany({
        where: { workspaceId, docId },
      }),
    ]);

    return { timestamp: now };
  }

  async recoverDocByTimestamp(
    workspaceId: string,
    docId: string,
    timestamp: Date,
  ) {
    const history = await this.getHistoryByTimestamp(workspaceId, docId, timestamp);
    if (!history) {
      throw new Error('History entry not found');
    }
    return this.recoverDoc(workspaceId, docId, history.id);
  }
}

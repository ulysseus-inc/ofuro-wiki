import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class DocService {
  constructor(private prisma: PrismaService) {}

  async getDocMeta(workspaceId: string, docId: string) {
    return this.prisma.docMeta.findUnique({
      where: { workspaceId_docId: { workspaceId, docId } },
    });
  }

  async listDocs(workspaceId: string) {
    return this.prisma.docMeta.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async upsertDocMeta(
    workspaceId: string,
    docId: string,
    data: {
      title?: string;
      mode?: string;
      createdById?: string;
      updatedById?: string;
    },
  ) {
    return this.prisma.docMeta.upsert({
      where: { workspaceId_docId: { workspaceId, docId } },
      create: {
        workspaceId,
        docId,
        ...data,
      },
      update: {
        ...data,
        updatedAt: new Date(),
      },
    });
  }

  async publishPage(workspaceId: string, docId: string, mode?: string) {
    return this.prisma.docMeta.upsert({
      where: { workspaceId_docId: { workspaceId, docId } },
      create: { workspaceId, docId, public: true, mode: mode || 'page' },
      update: { public: true, mode: mode || undefined },
    });
  }

  async revokePublicPage(workspaceId: string, docId: string) {
    return this.prisma.docMeta.update({
      where: { workspaceId_docId: { workspaceId, docId } },
      data: { public: false },
    });
  }

  async getDocSnapshot(workspaceId: string, docId: string) {
    const snapshot = await this.prisma.docSnapshot.findUnique({
      where: { workspaceId_docId: { workspaceId, docId } },
    });
    if (!snapshot) return null;
    return snapshot;
  }

  async grantDocUserRole(
    workspaceId: string,
    docId: string,
    userId: string,
    role: string,
  ) {
    await this.prisma.docPermission.upsert({
      where: {
        workspaceId_docId_userId: { workspaceId, docId, userId },
      },
      create: { workspaceId, docId, userId, role },
      update: { role },
    });
    return true;
  }

  async revokeDocUserRole(
    workspaceId: string,
    docId: string,
    userId: string,
  ) {
    await this.prisma.docPermission.deleteMany({
      where: { workspaceId, docId, userId },
    });
    return true;
  }
}

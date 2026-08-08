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

  /**
   * #97: ドキュメントの既定ロールを変える（docs/doc-permission.md 8章）。
   *
   * ⚠️ **これは doc の設定であって、個人の設定ではない。**
   * 変えると、個別の設定を持たない**全員**の判定が変わる。
   */
  async updateDocDefaultRole(
    workspaceId: string,
    docId: string,
    role: string,
  ) {
    await this.prisma.docMeta.upsert({
      where: { workspaceId_docId: { workspaceId, docId } },
      create: { workspaceId, docId, defaultRole: role },
      update: { defaultRole: role },
    });
    return true;
  }

  /**
   * #97: 個別の権限を持つ利用者の一覧（8章 `grantedUsersList`）。
   *
   * ⚠️ **既定ロールで読めている人はここに出ない。** 出るのは
   * 「明示的に設定された人」だけである。画面で「この人しか見られない」と
   * 誤読させないよう、既定ロールと併せて示すこと。
   */
  async listDocGrantedUsers(
    workspaceId: string,
    docId: string,
    skip: number,
    take: number,
  ) {
    const where = { workspaceId, docId };
    const [rows, totalCount] = await Promise.all([
      this.prisma.docPermission.findMany({
        where,
        orderBy: { userId: 'asc' },
        skip,
        take,
      }),
      this.prisma.docPermission.count({ where }),
    ]);

    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.userId) } },
      select: { id: true, name: true, email: true, avatarUrl: true },
    });
    const userOf = new Map(users.map((u) => [u.id, u]));

    return {
      rows: rows.map((r) => ({ role: r.role, user: userOf.get(r.userId) })),
      totalCount,
    };
  }
}

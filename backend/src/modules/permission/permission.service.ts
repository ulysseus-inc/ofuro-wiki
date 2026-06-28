import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class PermissionService {
  constructor(private prisma: PrismaService) {}

  async getWorkspaceRole(workspaceId: string, userId: string): Promise<string | null> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    return member?.role ?? null;
  }

  async getDocRole(
    workspaceId: string,
    docId: string,
    userId: string,
  ): Promise<string | null> {
    // Check doc-level permission first
    const docPerm = await this.prisma.docPermission.findUnique({
      where: {
        workspaceId_docId_userId: { workspaceId, docId, userId },
      },
    });
    if (docPerm) return docPerm.role;

    // Fall back to workspace role
    const wsRole = await this.getWorkspaceRole(workspaceId, userId);
    if (!wsRole) return null;

    // Map workspace roles to doc roles
    switch (wsRole) {
      case 'owner':
      case 'admin':
        return 'owner';
      case 'member':
        return 'editor';
      case 'reader':
        return 'reader';
      default:
        return null;
    }
  }

  async canEditDoc(
    workspaceId: string,
    docId: string,
    userId: string,
  ): Promise<boolean> {
    const role = await this.getDocRole(workspaceId, docId, userId);
    return role === 'owner' || role === 'editor';
  }

  async canReadDoc(
    workspaceId: string,
    docId: string,
    userId: string,
  ): Promise<boolean> {
    // Check if doc is public
    const doc = await this.prisma.docMeta.findUnique({
      where: { workspaceId_docId: { workspaceId, docId } },
    });
    if (doc?.public) return true;

    const role = await this.getDocRole(workspaceId, docId, userId);
    return role !== null;
  }
}

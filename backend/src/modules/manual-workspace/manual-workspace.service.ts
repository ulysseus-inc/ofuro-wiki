import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma.service';

/**
 * #72 マニュアル専用ワークスペース（読み取り専用・自動配布）の共有ロジック。
 *
 * - システムアカウント（ログイン不可・isSystem）が所有するワークスペースを「マニュアル」とする。
 * - 本サービスは Prisma のみに依存し、WS一覧取得時の遅延 Reader 参加（`ensureMembership`）を担う。
 * - シード（本文 import）は BackupService に依存するため `ManualSeedService` に分離している
 *   （WorkspaceModule → BackupModule → BlobModule → WorkspaceModule の循環依存を避けるため）。
 */
@Injectable()
export class ManualWorkspaceService {
  /** システムアカウントの既知メール（ログイン不可）。 */
  static readonly SYSTEM_EMAIL = 'manual-system@ofuro-wiki.local';
  /** マニュアルWSの表示名。 */
  static readonly WORKSPACE_NAME = '📖 マニュアル';
  /**
   * マニュアルWSの ID を内容バージョンから決める。
   * - 先頭を all-f 固定にし、フロントの workspace.id ソートで常に最下部に来るようにする。
   * - 末尾はバージョンのハッシュにし、**内容が変わると ID も変わる**ようにする。
   *   これにより更新時、クライアントは「別WS」として空から再同期し、旧内容が
   *   Yjs CRDT でマージ（残骸表示）されるのを防ぐ。
   */
  static workspaceIdForVersion(version: string): string {
    const h = createHash('sha256').update(version).digest('hex');
    // ffffffff-ffff-4fff-bfff-XXXXXXXXXXXX（version=4, variant=b の有効な UUID）
    return `ffffffff-ffff-4fff-bfff-${h.slice(0, 12)}`;
  }

  constructor(private readonly prisma: PrismaService) {}

  /** システムアカウントを取得（無ければ作成）。ログイン不可（passwordHash=null）。 */
  async ensureSystemUser() {
    const email = ManualWorkspaceService.SYSTEM_EMAIL;
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) return existing;
    return this.prisma.user.create({
      data: {
        email,
        name: 'ofuro-wiki マニュアル',
        isSystem: true,
        emailVerified: true,
        // passwordHash は未設定＝ログイン不可
      },
    });
  }

  /** マニュアルWS（システムアカウント所有＝ID はバージョンで変わる）を返す（無ければ null）。 */
  async findManualWorkspace() {
    const system = await this.prisma.user.findUnique({
      where: { email: ManualWorkspaceService.SYSTEM_EMAIL },
    });
    if (!system) return null;
    return this.prisma.workspace.findFirst({
      where: { ownerId: system.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 対象ユーザーをマニュアルWSに Reader として遅延参加させる（冪等）。
   * WS一覧取得時に呼ぶ。システムアカウント自身・マニュアル未整備時は何もしない。
   */
  async ensureMembership(userId: string) {
    const ws = await this.findManualWorkspace();
    if (!ws) return;
    if (ws.ownerId === userId) return; // システムアカウント自身

    const existing = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: ws.id, userId } },
    });
    if (existing) return;

    await this.prisma.workspaceMember.create({
      data: {
        workspaceId: ws.id,
        userId,
        role: 'reader',
        status: 'accepted',
      },
    });
  }
}

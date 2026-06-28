import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../prisma.service';
import {
  markdownToYjsUpdate,
  upsertWorkspaceRootDoc,
  upsertFoldersDoc,
  yjsUpdateToMarkdown,
} from './yjs-doc-builder';

interface UpsertDocBody {
  workspaceId: string;
  docId: string;
  title: string;
  markdown: string;
}

interface GetMarkdownBody {
  workspaceId: string;
  docId: string;
}

/**
 * 外部・内部の連携ツールからドキュメントを作成・更新するエンドポイント。
 * JWT 認証（Bearer トークン or Cookie）を使用。
 * ドキュメント本体と同時にワークスペース root doc の meta.pages も更新する。
 */
@Controller('api/internal/docs')
@UseGuards(JwtAuthGuard)
export class InternalDocController {
  constructor(private prisma: PrismaService) {}

  /**
   * 対象 workspace が存在することを保証する。
   * 不在の場合は明示的な 404 を投げ、FK 制約違反による生の 500 を防ぐ。
   */
  private async ensureWorkspaceExists(workspaceId: string) {
    // workspace.id は PostgreSQL の uuid 型。UUID 形式でない文字列を findUnique に
    // 渡すと Prisma が `invalid input syntax for type uuid` で生の 500 を投げるため、
    // クエリ前に形式を検証して不在と同じ 404 に倒す。
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(workspaceId)) {
      throw new NotFoundException(
        `workspace が存在しません (workspaceId: ${workspaceId})`,
      );
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    });
    if (!workspace) {
      throw new NotFoundException(
        `workspace が存在しません (workspaceId: ${workspaceId})`,
      );
    }
  }

  @Post('upsert')
  @HttpCode(HttpStatus.OK)
  async upsertDoc(@Body() body: UpsertDocBody) {
    const { workspaceId, docId, title, markdown } = body;
    if (!workspaceId || !docId || !title) {
      throw new BadRequestException('workspaceId, docId, title は必須です');
    }

    // workspace の存在を検証する。不在のまま docSnapshot を upsert すると
    // FK 制約違反（P2003）で生の 500 になり、異常検知・原因切り分けを遅らせるため、
    // 明示的な 404 を返す（Issue #33 / インシデント #32）。
    await this.ensureWorkspaceExists(workspaceId);

    // ドキュメント本体を upsert
    const blob = markdownToYjsUpdate(title, markdown ?? '');
    await this.prisma.docSnapshot.upsert({
      where: { workspaceId_docId: { workspaceId, docId } },
      create: {
        workspaceId,
        docId,
        blob: Buffer.from(blob),
        timestamp: new Date(),
      },
      update: {
        blob: Buffer.from(blob),
        timestamp: new Date(),
      },
    });

    await this.prisma.docMeta.upsert({
      where: { workspaceId_docId: { workspaceId, docId } },
      create: { workspaceId, docId, title },
      update: { title, updatedAt: new Date() },
    });

    // 差分アップデートをクリア（スナップショット再構築済みのため不要）
    await this.prisma.docUpdate.deleteMany({ where: { workspaceId, docId } });

    // ワークスペース root doc の meta.pages を更新してサイドバーに表示させる
    const rootDocId = workspaceId;
    const rootSnapshot = await this.prisma.docSnapshot.findUnique({
      where: { workspaceId_docId: { workspaceId, docId: rootDocId } },
    });

    const updatedRoot = upsertWorkspaceRootDoc(
      rootSnapshot ? Buffer.from(rootSnapshot.blob) : null,
      docId,
      title,
    );

    await this.prisma.docSnapshot.upsert({
      where: { workspaceId_docId: { workspaceId, docId: rootDocId } },
      create: {
        workspaceId,
        docId: rootDocId,
        blob: Buffer.from(updatedRoot),
        timestamp: new Date(),
      },
      update: {
        blob: Buffer.from(updatedRoot),
        timestamp: new Date(),
      },
    });

    // root doc の差分アップデートもクリア
    await this.prisma.docUpdate.deleteMany({ where: { workspaceId, docId: rootDocId } });

    // db$<workspaceId>$folders を更新してサイドバーのフォルダ構造に配置
    const foldersDocId = `db$${workspaceId}$folders`;
    const foldersSnapshot = await this.prisma.docSnapshot.findUnique({
      where: { workspaceId_docId: { workspaceId, docId: foldersDocId } },
    });
    const foldersUpdates = await this.prisma.docUpdate.findMany({
      where: { workspaceId, docId: foldersDocId },
      orderBy: { timestamp: 'asc' },
    });

    const updatedFolders = upsertFoldersDoc(
      foldersSnapshot ? Buffer.from(foldersSnapshot.blob) : null,
      foldersUpdates.map(u => Buffer.from(u.blob)),
      docId,
    );

    if (updatedFolders.length > 0) {
      await this.prisma.docSnapshot.upsert({
        where: { workspaceId_docId: { workspaceId, docId: foldersDocId } },
        create: {
          workspaceId,
          docId: foldersDocId,
          blob: Buffer.from(updatedFolders),
          timestamp: new Date(),
        },
        update: {
          blob: Buffer.from(updatedFolders),
          timestamp: new Date(),
        },
      });
      await this.prisma.docUpdate.deleteMany({ where: { workspaceId, docId: foldersDocId } });
    }

    return { ok: true, workspaceId, docId, title };
  }

  /**
   * upsert の対になる読み取りエンドポイント（Issue #30）。
   * Yjs スナップショット + 未マージ差分を復元し、本文を Markdown で返す。
   * 外部RAG/検索ツール が ofuro-wiki の本文をインデックスするために使用する。
   */
  @Post('get-markdown')
  @HttpCode(HttpStatus.OK)
  async getMarkdown(@Body() body: GetMarkdownBody) {
    const { workspaceId, docId } = body;
    if (!workspaceId || !docId) {
      throw new BadRequestException('workspaceId, docId は必須です');
    }

    // workspace 不在の文脈を明示する（snapshot 不在とは区別したエラーメッセージ）。
    await this.ensureWorkspaceExists(workspaceId);

    const snapshot = await this.prisma.docSnapshot.findUnique({
      where: { workspaceId_docId: { workspaceId, docId } },
    });
    if (!snapshot) {
      throw new NotFoundException('ドキュメントが見つかりません');
    }

    // snapshot を先頭に、未マージの差分アップデートを時系列順に適用して最新状態を復元
    const updates = await this.prisma.docUpdate.findMany({
      where: { workspaceId, docId },
      orderBy: { timestamp: 'asc' },
    });

    const buffers: Uint8Array[] = [
      new Uint8Array(snapshot.blob),
      ...updates.map(u => new Uint8Array(u.blob)),
    ];

    const { title, markdown } = yjsUpdateToMarkdown(buffers);

    return { workspaceId, docId, title, markdown };
  }
}

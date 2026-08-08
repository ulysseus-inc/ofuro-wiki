import { Controller, Get, Param, Res, UseGuards, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import * as Y from 'yjs';
import { DocService } from './doc.service';
import { DocHistoryService } from './doc-history.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceMemberGuard } from '../../common/guards/workspace-member.guard';
import { WorkspaceRole } from '../../common/decorators/workspace-role.decorator';
import { PrismaService } from '../../prisma.service';
import { PermissionService } from '../permission/permission.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('api/workspaces/:workspaceId/docs')
export class DocController {
  constructor(
    private docService: DocService,
    private docHistoryService: DocHistoryService,
    private prisma: PrismaService,
    // #97: 判定はすべて PermissionService に委ねる
    private permission: PermissionService,
  ) {}

  @Get(':docId')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  @WorkspaceRole('reader')
  async getDoc(
    @Param('workspaceId') workspaceId: string,
    @Param('docId') docId: string,
    @CurrentUser() user: { id: string },
    @Res() res: Response,
  ) {
    // #97: ⚠️ 読めない doc は「無い」ものとして 404 を返す。
    // 403 だと「存在するが権限が無い」ことが伝わり、存在を漏らす
    if (!(await this.permission.canRead(workspaceId, docId, user.id))) {
      return res.status(404).json({ message: 'Document not found' });
    }

    const snapshot = await this.docService.getDocSnapshot(workspaceId, docId);
    if (!snapshot) {
      return res.status(404).json({ message: 'Document not found' });
    }
    res.set('Content-Type', 'application/octet-stream');
    res.send(Buffer.from(snapshot.blob));
  }

  @Get(':docId/histories/:timestamp')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  @WorkspaceRole('reader')
  async getDocHistory(
    @Param('workspaceId') workspaceId: string,
    @Param('docId') docId: string,
    @Param('timestamp') timestamp: string,
    @CurrentUser() user: { id: string },
    @Res() res: Response,
  ) {
    // #97: 版も本文である。現在の doc が読めないなら過去も読ませない
    if (!(await this.permission.canRead(workspaceId, docId, user.id))) {
      throw new NotFoundException('History not found');
    }

    const ts = new Date(decodeURIComponent(timestamp));
    const history = await this.docHistoryService.getHistoryByTimestamp(
      workspaceId,
      docId,
      ts,
    );
    if (!history) {
      throw new NotFoundException('History not found');
    }
    res.set('Content-Type', 'application/octet-stream');
    res.send(Buffer.from(history.blob));
  }

  @Get(':docId/preview')
  @UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
  @WorkspaceRole('reader')
  async getDocPreview(
    @Param('workspaceId') workspaceId: string,
    @Param('docId') docId: string,
    @CurrentUser() user: { id: string },
    @Res() res: Response,
  ) {
    // #97: OGP は本文の冒頭を出す。読めないなら出さない
    if (!(await this.permission.canRead(workspaceId, docId, user.id))) {
      return res.status(404).send(this.buildOgpHtml('Not Found', ''));
    }

    const snapshot = await this.docService.getDocSnapshot(workspaceId, docId);
    if (!snapshot) {
      return res.status(404).send(this.buildOgpHtml('Not Found', ''));
    }

    // Extract title and content from Yjs doc
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(snapshot.blob));

    const title = this.extractTitle(doc) || 'Untitled';
    const description = this.extractDescription(doc);

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(this.buildOgpHtml(title, description));
  }

  private extractTitle(doc: Y.Doc): string | undefined {
    try {
      const meta = doc.getMap('meta');
      const title = meta?.get('title');
      if (typeof title === 'string') return title;
    } catch {
      // ignore
    }

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

  private extractDescription(doc: Y.Doc): string {
    const texts: string[] = [];
    try {
      const blocks = doc.getMap('blocks');
      if (!blocks) return '';

      for (const [, value] of blocks.entries()) {
        if (!(value instanceof Y.Map)) continue;
        const flavour = value.get('sys:flavour') as string | undefined;
        if (!flavour || flavour === 'affine:page') continue;

        const propText = value.get('prop:text');
        if (propText instanceof Y.Text) {
          const text = propText.toString().trim();
          if (text) texts.push(text);
        }
        if (texts.join(' ').length > 200) break;
      }
    } catch {
      // ignore
    }
    const joined = texts.join(' ');
    return joined.length > 200 ? joined.slice(0, 197) + '...' : joined;
  }

  private buildOgpHtml(title: string, description: string): string {
    const escTitle = this.escapeHtml(title);
    const escDesc = this.escapeHtml(description);
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escTitle} - ofuro-wiki</title>
  <meta property="og:title" content="${escTitle}">
  <meta property="og:description" content="${escDesc}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="ofuro-wiki">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escTitle}">
  <meta name="twitter:description" content="${escDesc}">
</head>
<body>
  <h1>${escTitle}</h1>
  <p>${escDesc}</p>
</body>
</html>`;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

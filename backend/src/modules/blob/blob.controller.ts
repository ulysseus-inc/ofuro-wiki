import { Controller, Get, Put, Param, Res, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { BlobService } from './blob.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('api/workspaces/:workspaceId/blobs')
@UseGuards(JwtAuthGuard)
export class BlobController {
  constructor(
    private blobService: BlobService,
    private workspaceService: WorkspaceService,
  ) {}

  @Get(':key')
  async getBlob(
    @Param('workspaceId') workspaceId: string,
    @Param('key') key: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const user = (req as any).user;
    const userId = user?.id;

    // ユーザーがこのワークスペースにアクセス権があるか確認
    const role = await this.workspaceService.getMemberRole(workspaceId, userId);
    if (!role) {
      throw new ForbiddenException('Access denied to this workspace');
    }

    const blob = await this.blobService.getBlob(workspaceId, key);
    if (!blob) {
      return res.status(404).json({ message: 'Blob not found' });
    }
    if (blob.mime) {
      res.set('Content-Type', blob.mime);
    }
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(blob.data);
  }

  @Put(':key')
  async putBlob(
    @Param('workspaceId') workspaceId: string,
    @Param('key') key: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }
    const data = Buffer.concat(chunks);
    const mime = req.headers['content-type'] || undefined;

    const resultKey = await this.blobService.setBlob(workspaceId, data, mime, key);
    res.json({ key: resultKey });
  }
}

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

    // M-4: 格納された Content-Type をそのまま返すと SVG/HTML 等で Stored XSS に
    // なり得る。MIMEスニッフィング防止 + CSP sandbox で万一のスクリプト実行を無効化し、
    // スクリプト実行が主目的になり得る HTML/XML 系は添付ダウンロードに倒す。
    // （SVG は <img> 経由ではスクリプトが動かず、直接ナビゲーション時も CSP sandbox が
    //  無効化するためインラインのまま表示可能。）
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'none'; sandbox");

    // ブラウザは Content-Type の前後空白をトリムして解釈するため、こちらも
    // trim() してから判定する（" text/html" 等で FORCE_DOWNLOAD をすり抜けて
    // XSS になるのを防ぐ）。判定後の Content-Type にもトリム済み値を用いる。
    const mime = (blob.mime || '').trim().toLowerCase();
    const FORCE_DOWNLOAD = [
      'text/html',
      'application/xhtml+xml',
      'application/xml',
      'text/xml',
    ];
    if (!mime || FORCE_DOWNLOAD.some((d) => mime.startsWith(d))) {
      res.set('Content-Type', 'application/octet-stream');
      res.set('Content-Disposition', 'attachment');
    } else {
      // mime が truthy であることは上の分岐で確認済み
      res.set('Content-Type', mime);
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

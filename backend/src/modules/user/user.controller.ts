import { Controller, Get, Param, Res } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import type { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const AVATAR_DIR = process.env.AVATAR_STORAGE_PATH || './data/avatars';

@Controller('api/avatars')
export class UserController {
  @Public()
  @Get(':filename')
  async getAvatar(
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    // Sanitize filename to prevent path traversal
    const sanitized = path.basename(filename);
    const filePath = path.join(AVATAR_DIR, sanitized);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Avatar not found' });
    }

    const ext = path.extname(sanitized).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };

    res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(filePath).pipe(res);
  }
}

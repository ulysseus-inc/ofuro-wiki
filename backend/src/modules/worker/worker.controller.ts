import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Res,
  HttpCode,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { WorkerService } from './worker.service';

interface LinkPreviewBody {
  url?: string;
}

@Controller('api/worker')
export class WorkerController {
  constructor(private readonly workerService: WorkerService) {}

  /**
   * リンクプレビュー（OGPカード）取得エンドポイント。
   *
   * Admin 設定 `link_preview_enabled` が ON のときのみ、サーバー側で対象 URL の
   * OGP メタデータを取得して返す（埋め込み/ブックマークのリッチ表示に使用）。
   * OFF（既定）のときは空オブジェクトを返す no-op（外部送信ゼロを維持）。
   * 上流 AFFiNE の外部 Worker ではなく自サーバーで完結させる。
   */
  @Post('link-preview')
  @Public()
  @HttpCode(200)
  async linkPreview(@Body() body: LinkPreviewBody) {
    return this.workerService.getLinkPreview(body?.url ?? '');
  }

  /**
   * 画像プロキシ。外部画像の CORS/Mixed-Content 回避のためサーバー経由で配信。
   * Admin 設定が ON のときのみ動作。OFF/失敗時は 404。
   */
  @Get('image-proxy')
  @Public()
  async imageProxy(@Query('url') url: string, @Res() res: Response) {
    const result = await this.workerService.fetchImage(url ?? '');
    if (!result) {
      res.status(404).send();
      return;
    }
    res.set('Content-Type', result.contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    // XSS 多層防御: MIME スニッフ抑止 ＋ サンドボックス CSP ＋ inline 配信。
    // （ラスタ画像のみ許可済みだが、万一の型偽装に備えて実行面を封じる。）
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "sandbox; default-src 'none'");
    res.set('Content-Disposition', 'inline; filename="proxied"');
    res.send(result.body);
  }
}

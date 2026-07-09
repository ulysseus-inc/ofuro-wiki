import { Injectable, Logger } from '@nestjs/common';
import { URL } from 'url';
import { PrismaService } from '../../prisma.service';
import { safeFetch } from './ssrf-guard.util';

export interface LinkPreviewResult {
  url: string;
  title?: string | null;
  siteName?: string | null;
  description?: string | null;
  images?: string[];
  favicons?: string[];
  mediaType?: string | null;
}

export interface ImageResult {
  contentType: string;
  body: Buffer;
}

const HTML_MAX_BYTES = 2 * 1024 * 1024; // 2MB
const IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10MB
const SETTING_KEY = 'link_preview_enabled';

// XSS 対策: プロキシした画像はアプリと同一オリジンで配信されるため、
// スクリプトを実行し得る image/svg+xml を弾き、ラスタ画像のみ許可する。
const ALLOWED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

@Injectable()
export class WorkerService {
  private readonly logger = new Logger(WorkerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * link-preview / image-proxy が有効か（Admin 設定 `link_preview_enabled`）。
   * 既定は OFF（外部送信ゼロを維持）。Admin が明示的に ON にしたときのみ
   * サーバーが外部 URL のメタデータ/画像を取得する。
   */
  async isEnabled(): Promise<boolean> {
    const setting = await this.prisma.serverSetting.findUnique({
      where: { key: SETTING_KEY },
    });
    return setting?.value === 'true';
  }

  /**
   * リンクプレビュー（OGP）を取得。無効時は空オブジェクトを返す no-op。
   */
  async getLinkPreview(rawUrl: string): Promise<LinkPreviewResult | object> {
    if (!(await this.isEnabled())) {
      return {};
    }
    if (typeof rawUrl !== 'string' || !rawUrl) {
      return {};
    }
    try {
      const res = await safeFetch(rawUrl, {
        maxBytes: HTML_MAX_BYTES,
        accept: 'text/html,application/xhtml+xml',
      });
      // 非 2xx（403 CloudFront 等のボット遮断エラーページ）から OGP/title を
      // 拾うと「ERROR: The request could not be satisfied」等がカード名になるため、
      // 成功応答のみ解析する。失敗時は URL だけ返し、フロントは素の URL 表示に倒す。
      if (res.status < 200 || res.status >= 300) {
        return { url: rawUrl };
      }
      // HTML 以外（画像バイナリ等）は解析しない。
      const ct = (res.contentType || '').toLowerCase();
      if (ct && !ct.includes('html') && !ct.includes('xml')) {
        return { url: rawUrl };
      }
      const html = res.body.toString('utf8');
      return this.parseOpenGraph(html, res.finalUrl);
    } catch (e) {
      // 取得失敗は 404/内部URL 等。フロントは空扱いで問題ない。
      this.logger.warn(
        `link-preview fetch failed: ${(e as Error).message}`,
      );
      return { url: rawUrl };
    }
  }

  /**
   * 画像プロキシ。無効時 or 非画像 or 失敗時は null。
   */
  async fetchImage(rawUrl: string): Promise<ImageResult | null> {
    if (!(await this.isEnabled())) return null;
    if (typeof rawUrl !== 'string' || !rawUrl) return null;
    try {
      const res = await safeFetch(rawUrl, {
        maxBytes: IMAGE_MAX_BYTES,
        accept: 'image/*',
      });
      if (res.status < 200 || res.status >= 300) {
        return null; // エラー応答はプロキシしない
      }
      const contentType = (res.contentType || '').split(';')[0].trim().toLowerCase();
      // ラスタ画像のみ許可（SVG 等のスクリプト実行可能形式は拒否＝XSS対策）。
      if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
        return null;
      }
      return { contentType, body: res.body };
    } catch (e) {
      this.logger.warn(`image-proxy fetch failed: ${(e as Error).message}`);
      return null;
    }
  }

  /** HTML から OGP/meta を抽出してプレビューデータを組み立てる。 */
  private parseOpenGraph(html: string, baseUrl: string): LinkPreviewResult {
    // og:* メタは巨大なインラインスクリプトの後ろに置くサイト（YouTube 等）が
    // あるため、取得済み HTML（既に最大 2MB に制限済み）全体を走査する。
    const head = html;
    const metas = this.extractMetas(head);

    const pick = (...keys: string[]): string | null => {
      for (const k of keys) {
        const v = metas.get(k);
        if (v) return this.decodeEntities(v);
      }
      return null;
    };

    const title =
      pick('og:title', 'twitter:title') ?? this.extractTitle(head);
    const description = pick(
      'og:description',
      'twitter:description',
      'description',
    );
    const image = pick('og:image', 'og:image:url', 'twitter:image');
    const siteName = pick('og:site_name');
    const mediaType = pick('og:type');
    const favicon = this.extractFavicon(head, baseUrl);

    return {
      url: baseUrl,
      title: title ?? null,
      siteName: siteName ?? null,
      description: description ?? null,
      mediaType: mediaType ?? null,
      images: image ? [this.absoluteUrl(image, baseUrl)] : [],
      favicons: favicon ? [favicon] : [],
    };
  }

  /** <meta> の property/name → content を Map に。 */
  private extractMetas(head: string): Map<string, string> {
    const map = new Map<string, string>();
    const metaRe = /<meta\b[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = metaRe.exec(head)) !== null) {
      const tag = m[0];
      const key =
        this.attr(tag, 'property') ?? this.attr(tag, 'name');
      const content = this.attr(tag, 'content');
      if (key && content != null && !map.has(key.toLowerCase())) {
        map.set(key.toLowerCase(), content);
      }
    }
    return map;
  }

  private attr(tag: string, name: string): string | null {
    // \b で単語境界を強制し、例えば `filename="foo"` の name が
    // `name` 属性として誤って部分一致するのを防ぐ。クォート無し属性値
    // （HTML仕様上有効: <meta property=og:title>）にも対応する。
    const re = new RegExp(
      `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
      'i'
    );
    const m = re.exec(tag);
    if (!m) return null;
    return m[1] ?? m[2] ?? m[3] ?? null;
  }

  private extractTitle(head: string): string | null {
    const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
    return m ? this.decodeEntities(m[1].trim()) : null;
  }

  private extractFavicon(head: string, baseUrl: string): string | null {
    const linkRe = /<link\b[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(head)) !== null) {
      const rel = (this.attr(m[0], 'rel') || '').toLowerCase();
      if (rel.includes('icon')) {
        const href = this.attr(m[0], 'href');
        if (href) return this.absoluteUrl(href, baseUrl);
      }
    }
    // フォールバック: オリジン直下の /favicon.ico
    try {
      return new URL('/favicon.ico', baseUrl).toString();
    } catch {
      return null;
    }
  }

  private absoluteUrl(href: string, baseUrl: string): string {
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      return href;
    }
  }

  private decodeEntities(s: string): string {
    return s
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&#x27;/gi, "'")
      .replace(/&nbsp;/g, ' ');
  }
}

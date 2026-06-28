import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const MOBILE_UA_REGEX = /Mobile|Android|iPhone|iPad/i;

// Paths that should never be intercepted
const PASSTHROUGH_PREFIXES = [
  '/graphql',
  '/socket.io',
  '/api/',
  '/assets/',
  '/static/',
];

// File extensions that indicate static asset requests
const STATIC_EXTENSIONS =
  /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map|json|webp|avif)$/i;

@Injectable()
export class MobileRedirectMiddleware implements NestMiddleware {
  private readonly logger = new Logger(MobileRedirectMiddleware.name);
  private readonly mobileDist: string;
  private readonly mobileHtmlPath: string;
  private mobileHtmlContent: string | null = null;

  constructor() {
    this.mobileDist = join(__dirname, '..', '..', '..', '..', 'public-mobile');
    this.mobileHtmlPath = join(this.mobileDist, 'selfhost.html');

    if (existsSync(this.mobileHtmlPath)) {
      this.mobileHtmlContent = readFileSync(this.mobileHtmlPath, 'utf-8');
      this.logger.log('Mobile HTML loaded from public-mobile/selfhost.html');
    } else {
      this.logger.warn(
        `Mobile dist not found at ${this.mobileDist}, mobile UA will fall back to desktop`,
      );
    }
  }

  use(req: Request, res: Response, next: NextFunction) {
    // Skip if mobile dist is not available
    if (!this.mobileHtmlContent) {
      return next();
    }

    // Skip API, GraphQL, Socket.IO, and static asset paths
    const path = req.path;
    if (PASSTHROUGH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      return next();
    }

    // Skip static file requests (by extension)
    if (STATIC_EXTENSIONS.test(path)) {
      return next();
    }

    // Only intercept HTML page requests (SPA routes)
    const accept = req.headers.accept || '';
    if (!accept.includes('text/html')) {
      return next();
    }

    // Check User-Agent for mobile
    const ua = req.headers['user-agent'] || '';
    if (!MOBILE_UA_REGEX.test(ua)) {
      return next();
    }

    // Serve mobile HTML
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(this.mobileHtmlContent);
  }
}

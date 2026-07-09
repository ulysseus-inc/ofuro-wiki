import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import graphqlUploadExpress from 'graphql-upload/graphqlUploadExpress.mjs';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AdminService } from './modules/admin/admin.service';
import { ManualSeedService } from './modules/manual-workspace/manual-seed.service';
import { parseAllowedOrigins, isWildcardOriginInProduction } from './common/cors';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // #1: JWT_SECRET validation — fail fast in production
  if (process.env.NODE_ENV === 'production') {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret === 'dev-secret' || secret === 'change-me-in-production') {
      throw new Error(
        '[ofuro-wiki] JWT_SECRET must be set to a strong random value in production.\n' +
        'Generate one with: openssl rand -base64 48',
      );
    }
    if (secret.length < 32) {
      throw new Error('[ofuro-wiki] JWT_SECRET must be at least 32 characters long.');
    }
  }

  const app = await NestFactory.create(AppModule);

  // #5: Helmet — security headers
  // M-5: CSP を有効化。BlockSuite はインラインスタイル/スクリプト・eval・blob worker を
  // 使うため script/style は unsafe-inline/eval を許可しつつ、object-src 'none' /
  // base-uri 'self' 等の高価値な制限を付与。ユーザー操作起因の埋め込み(YouTube等)は
  // frame-src/img-src の https: で許可する。useDefaults:false で upgrade-insecure-requests
  // を付けず、HTTP セルフホスト構成でも動作させる。
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'ws:', 'wss:', 'https:'],
          mediaSrc: ["'self'", 'data:', 'blob:', 'https:'],
          workerSrc: ["'self'", 'blob:'],
          childSrc: ["'self'", 'blob:', 'https:'],
          frameSrc: ["'self'", 'blob:', 'https:'],
        },
      },
      crossOriginEmbedderPolicy: false,
      // #69: 未指定だと helmet の既定値 `no-referrer` になり、ユーザー操作起因の
      // 埋め込み（YouTube 等）へリファラーが一切送られず、埋め込みプレイヤーが
      // 埋め込み元を検証できずエラーになる（例: YouTube エラー153）。ブラウザの
      // 一般的な既定動作と同じ `strict-origin-when-cross-origin`（送信先には
      // 自サイトのオリジンのみ伝える。ページの詳細パスは伝えない）を明示する。
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  // #2: CORS — configurable via ALLOWED_ORIGINS env var（common/cors.ts に集約）
  if (isWildcardOriginInProduction()) {
    logger.warn(
      '[ofuro-wiki] ALLOWED_ORIGINS が未設定(=*)です。本番では反射+credentials を避けるため、' +
        '公開ドメインを明示指定することを推奨します（例: ALLOWED_ORIGINS=https://wiki.example.com）。',
    );
  }
  app.enableCors({
    origin: parseAllowedOrigins(),
    credentials: true,
  });

  // Cookie parser
  app.use(cookieParser());

  // GraphQL multipart upload support (for setBlob mutations etc.)
  app.use('/graphql', graphqlUploadExpress({ maxFileSize: 1024 * 1024 * 100, maxFiles: 10 }));

  // Socket.IO adapter
  app.useWebSocketAdapter(new IoAdapter(app));

  // Global pipes & filters
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  // Seed admin user from ADMIN_EMAIL env var
  const adminService = app.get(AdminService);
  await adminService.seedAdmin();

  // #72: マニュアル専用ワークスペースをシード（seed zip があれば・冪等）
  const manualSeedService = app.get(ManualSeedService);
  await manualSeedService.seedManualWorkspace().catch(err => {
    logger.error(`Failed to seed manual workspace: ${err?.message ?? err}`);
  });

  const port = process.env.PORT ?? 3010;
  await app.listen(port);
  logger.log(`ofuro-wiki backend running on port ${port}`);
  logger.log(`GraphQL Playground: http://localhost:${port}/graphql`);
}
bootstrap();

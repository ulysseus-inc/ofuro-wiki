// ⚠️ **必ず最初に置くこと。** Node のスレッドプールは「最初に使われた時点」で
// 確定するため、bcrypt 等が読み込まれた後では設定が静かに無視される。
// 順序は test/common/threadpool.spec.ts が守っている。
import { THREAD_POOL_SIZE } from './bootstrap/threadpool';

import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import graphqlUploadExpress from 'graphql-upload/graphqlUploadExpress.mjs';
import { AppModule } from './app.module';
import {
  FileLogger,
  resolveLogLevels,
} from './modules/logging/file-logger';
import { LogFileService } from './modules/logging/log-file.service';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AdminService } from './modules/admin/admin.service';
import { ManualSeedService } from './modules/manual-workspace/manual-seed.service';
import { parseAllowedOrigins, isWildcardOriginInProduction } from './common/cors';
import { parseTrustProxy } from './common/trust-proxy';

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

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // #90: 起動直後のログもファイルへ残すためバッファする
    bufferLogs: true,
  });

  // #90: 停止時に onModuleDestroy を呼ばせる。
  // これが無いと、集約中のドキュメント編集（最大15分ぶん）が
  // 再起動のたびに黙って失われる。
  app.enableShutdownHooks();

  // #90: アプリケーションログを標準出力に加えてファイルへも書く。
  // 標準出力だけだと Docker のローテート（容量基準）でしか制御できず、
  // 「90日保持」を保証できない（docs/logging.md 5章）。
  FileLogger.attach(app.get(LogFileService));
  // #90: 既定では debug / verbose を出さない。1メッセージごとの記録が
  // アプリケーションログの大半を占めるため（docs/logging.md 3章）。
  // 調査時は LOG_LEVEL=debug で有効化する。
  app.useLogger(new FileLogger({ logLevels: resolveLogLevels() }));

  // #93: リバースプロキシ配下では X-Forwarded-For からクライアントIPを解決する。
  //
  // 未設定のままプロキシ(Nginx/Caddy 等)の背後で動かすと、req.ip が常にプロキシの
  // アドレスになり、レート制限が「利用者ごと」ではなく全体の合計として効いてしまう。
  //
  // ⚠️ 既定は無効。直接公開しているサーバーで有効にすると X-Forwarded-For を
  //    偽装され、レート制限を無制限に回避されるため、プロキシ配下でのみ有効化する。
  //    値はプロキシの段数（通常 1）、または 'loopback' 等の express の指定子。
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) {
    const value = parseTrustProxy(trustProxy);
    try {
      app.set('trust proxy', value);
      logger.log(`Trust proxy enabled: ${JSON.stringify(value)}`);
    } catch (err) {
      // express は文字列を IP / サブネットのリストとして解釈するため、
      // 解釈できない値を渡すと起動時に例外になる。原因が分かる形で落とす。
      throw new Error(
        `[ofuro-wiki] TRUST_PROXY の値が不正です: "${trustProxy}"\n` +
          `  プロキシの段数（例: 1）、'loopback'、または IP/CIDR のカンマ区切りを指定してください。\n` +
          `  元のエラー: ${(err as Error).message}`,
      );
    }
  }

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
  // 効いていないと「始業時にログインが遅い」という形でしか現れないため、
  // 起動時に値を出しておく（docs/maintainer-guide.md「同時ログインが遅い」）
  logger.log(`スレッドプール: ${THREAD_POOL_SIZE}（同時に処理できる照合数）`);
  logger.log(`GraphQL Playground: http://localhost:${port}/graphql`);
}
bootstrap();

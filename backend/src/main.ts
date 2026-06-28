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
  app.use(
    helmet({
      contentSecurityPolicy: false, // BlockSuite uses inline styles/scripts; disable CSP
      crossOriginEmbedderPolicy: false,
    }),
  );

  // #2: CORS — configurable via ALLOWED_ORIGINS env var
  // ALLOWED_ORIGINS=*                              → allow all origins (default)
  // ALLOWED_ORIGINS=https://wiki.example.com       → restrict to specific domain(s)
  // ALLOWED_ORIGINS=https://a.com,https://b.com   → comma-separated multiple domains
  const allowedOrigins = process.env.ALLOWED_ORIGINS ?? '*';
  app.enableCors({
    origin:
      allowedOrigins === '*'
        ? true
        : allowedOrigins.split(',').map((o) => o.trim()),
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

  const port = process.env.PORT ?? 3010;
  await app.listen(port);
  logger.log(`ofuro-wiki backend running on port ${port}`);
  logger.log(`GraphQL Playground: http://localhost:${port}/graphql`);
}
bootstrap();

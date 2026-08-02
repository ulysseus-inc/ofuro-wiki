import { Module, Logger, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { GqlThrottlerGuard } from './common/guards/throttler.guard';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ScheduleModule } from '@nestjs/schedule';
import { existsSync } from 'fs';
import { join } from 'path';
import { LoggingModule } from './modules/logging/logging.module';
import { AuditModule } from './modules/audit/audit.module';
import { AccessLogMiddleware } from './modules/logging/access-log.middleware';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { ServerConfigModule } from './modules/config/config.module';
import { OidcModule } from './modules/oidc/oidc.module';
import { WorkspaceModule } from './modules/workspace/workspace.module';
import { SyncModule } from './modules/sync/sync.module';
import { DocModule } from './modules/doc/doc.module';
import { BlobModule } from './modules/blob/blob.module';
import { SearchModule } from './modules/search/search.module';
import { PermissionModule } from './modules/permission/permission.module';
import { TelemetryModule } from './modules/telemetry/telemetry.module';
import { WorkerModule } from './modules/worker/worker.module';
import { HealthModule } from './modules/health/health.module';
import { AdminModule } from './modules/admin/admin.module';
import { BackupModule } from './modules/backup/backup.module';
import { ManualSeedModule } from './modules/manual-workspace/manual-seed.module';
import { CommentModule } from './modules/comment/comment.module';
import { NotificationModule } from './modules/notification/notification.module';
import { MailModule } from './modules/mail/mail.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { AuthzModule } from './common/authz.module';
import { PrismaService } from './prisma.service';
import { MobileRedirectMiddleware } from './common/middleware/mobile-redirect.middleware';

const gqlLogger = new Logger('GraphQL');

// Serve frontend static files in production when dist exists
const FRONTEND_DIST = join(__dirname, '..', '..', 'public');
const MOBILE_DIST = join(__dirname, '..', '..', 'public-mobile');
const API_EXCLUDES = ['/graphql{*path}', '/socket.io{*path}', '/api{*path}'];

const staticImports = [
  // Mobile static assets (js/css with unique hashed names) — registered first
  // so mobile-specific assets are found. renderPath is set to a non-matching
  // path to prevent SPA fallback from this module. The MobileRedirectMiddleware
  // handles HTML (SPA route) requests for mobile UA instead.
  ...(existsSync(MOBILE_DIST)
    ? [
        ServeStaticModule.forRoot({
          rootPath: MOBILE_DIST,
          exclude: API_EXCLUDES,
          renderPath: '/__mobile_no_fallback__',
          serveStaticOptions: {
            index: false,
          },
        }),
      ]
    : []),
  // Desktop (web) static files — serves assets and SPA fallback (index.html)
  ...(existsSync(FRONTEND_DIST)
    ? [
        ServeStaticModule.forRoot({
          rootPath: FRONTEND_DIST,
          exclude: API_EXCLUDES,
        }),
      ]
    : []),
];

@Module({
  imports: [
    ...staticImports,
    AuthzModule,
    ScheduleModule.forRoot(),
    LoggingModule,
    AuditModule,
    // Rate limiting — 300 requests per minute per IP (self-hosted: generous limit)
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      sortSchema: true,
      playground: process.env.NODE_ENV !== 'production',
      csrfPrevention: false,
      context: ({ req, res }: { req: any; res: any }) => ({ req, res }),
      // L-2: 本番では内部エラーの詳細/スタックトレースをクライアントに返さない。
      // 意図した HttpException（4xx: NotFound/Forbidden/BadRequest 等）は
      // メッセージを保持し、想定外/5xx は汎用メッセージに丸める。開発時は従来どおり。
      formatError: (formattedError) => {
        gqlLogger.warn(
          `Error: ${formattedError.message} (path: ${formattedError.path?.join('.')}, code: ${formattedError.extensions?.code})`,
        );

        // エラー文言の多言語化。
        // メッセージが大文字スネークケース（例: INVALID_EMAIL_TOKEN）なら、
        // それを「エラー名」として extensions.name に載せる。
        // フロントエンドは t[`error.<name>`]() で利用者の言語の文言に差し替える
        // （@ofuro/error の UserFriendlyError が extensions から name を読む）。
        // サーバーが日本語/英語の文章を組み立てると、必ずどちらかの利用者に
        // 読めない文言が出るため、サーバーは言語に依存しないコードだけを返す。
        const errorName = /^[A-Z][A-Z0-9_]*$/.test(formattedError.message)
          ? formattedError.message
          : undefined;
        const withName = <T extends { extensions?: Record<string, any> }>(
          error: T,
        ): T =>
          errorName
            ? { ...error, extensions: { ...error.extensions, name: errorName } }
            : error;

        if (process.env.NODE_ENV !== 'production') {
          return withName(formattedError);
        }

        const ext = (formattedError.extensions ?? {}) as Record<string, any>;
        const statusCode: unknown =
          ext.originalError?.statusCode ?? ext.status;
        // 4xx の HttpException に加え、GraphQL 標準のクエリ検証/パースエラーや
        // 入力エラーも「利用者側原因」として扱い、詳細を保持する（デバッグ可能に）。
        const isClientError =
          (typeof statusCode === 'number' &&
            statusCode >= 400 &&
            statusCode < 500) ||
          ext.code === 'GRAPHQL_VALIDATION_FAILED' ||
          ext.code === 'GRAPHQL_PARSE_FAILED' ||
          ext.code === 'BAD_USER_INPUT';

        if (isClientError) {
          // client error はメッセージ・検証詳細(originalError)を保持する。
          // ※ 本番では Apollo が stacktrace を付与しないため内部漏洩はない。
          return withName({
            message: formattedError.message,
            path: formattedError.path,
            locations: formattedError.locations,
            extensions: {
              code: ext.code,
              ...(typeof statusCode === 'number' ? { status: statusCode } : {}),
              ...(ext.originalError ? { originalError: ext.originalError } : {}),
            },
          });
        }

        // 想定外/サーバエラー: 詳細（スタック・Prisma/DBメッセージ等）を隠す。
        return {
          message: 'Internal server error',
          path: formattedError.path,
          locations: formattedError.locations,
          extensions: { code: 'INTERNAL_SERVER_ERROR' },
        };
      },
    }),
    AuthModule,
    UserModule,
    ServerConfigModule,
    OidcModule,
    WorkspaceModule,
    SyncModule,
    DocModule,
    BlobModule,
    SearchModule,
    PermissionModule,
    TelemetryModule,
    WorkerModule,
    HealthModule,
    AdminModule,
    BackupModule,
    ManualSeedModule,
    CommentModule,
    NotificationModule,
    MailModule,
  ],
  providers: [
    PrismaService,
    // Rate limiting guard (global, WebSocket/GraphQL対応)
    { provide: APP_GUARD, useClass: GqlThrottlerGuard },
    // JWT auth guard (global)
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // #90: アクセスログは最初に通す（後続で弾かれた要求も記録するため）
    consumer.apply(AccessLogMiddleware).forRoutes('*');
    consumer.apply(MobileRedirectMiddleware).forRoutes('*');
  }
}

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
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { ServerConfigModule } from './modules/config/config.module';
import { WorkspaceModule } from './modules/workspace/workspace.module';
import { SyncModule } from './modules/sync/sync.module';
import { DocModule } from './modules/doc/doc.module';
import { BlobModule } from './modules/blob/blob.module';
import { SearchModule } from './modules/search/search.module';
import { PermissionModule } from './modules/permission/permission.module';
import { TelemetryModule } from './modules/telemetry/telemetry.module';
import { HealthModule } from './modules/health/health.module';
import { AdminModule } from './modules/admin/admin.module';
import { BackupModule } from './modules/backup/backup.module';
import { CommentModule } from './modules/comment/comment.module';
import { NotificationModule } from './modules/notification/notification.module';
import { MailModule } from './modules/mail/mail.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
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
    ScheduleModule.forRoot(),
    // Rate limiting — 300 requests per minute per IP (self-hosted: generous limit)
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      sortSchema: true,
      playground: process.env.NODE_ENV !== 'production',
      csrfPrevention: false,
      context: ({ req, res }: { req: any; res: any }) => ({ req, res }),
      formatError: (error) => {
        gqlLogger.warn(
          `Error: ${error.message} (path: ${error.path?.join('.')}, code: ${error.extensions?.code})`,
        );
        return error;
      },
    }),
    AuthModule,
    UserModule,
    ServerConfigModule,
    WorkspaceModule,
    SyncModule,
    DocModule,
    BlobModule,
    SearchModule,
    PermissionModule,
    TelemetryModule,
    HealthModule,
    AdminModule,
    BackupModule,
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
    consumer.apply(MobileRedirectMiddleware).forRoutes('*');
  }
}

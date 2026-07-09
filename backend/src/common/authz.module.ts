import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { WorkspaceMemberGuard } from './guards/workspace-member.guard';

/**
 * H-1 対策の共通認可基盤。
 * `WorkspaceMemberGuard` をどのモジュールからでも `@UseGuards()` できるよう
 * グローバルに提供・エクスポートする。ガードが依存する PrismaService も
 * 本モジュール内で解決させるため合わせて提供する。
 */
@Global()
@Module({
  providers: [WorkspaceMemberGuard, PrismaService],
  exports: [WorkspaceMemberGuard],
})
export class AuthzModule {}

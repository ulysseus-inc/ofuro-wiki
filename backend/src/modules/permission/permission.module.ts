import { forwardRef, Global, Module } from '@nestjs/common';
import { PermissionResolver } from './permission.resolver';
import { PermissionService } from './permission.service';
import { DocTypeResolver } from './doc-type.resolver';
import { PrismaService } from '../../prisma.service';
import { DocModule } from '../doc/doc.module';

/**
 * #97: 認可の唯一の入口（docs/doc-permission.md 6.0）。
 *
 * ⚠️ **@Global で1つだけ持つこと。** 各モジュールが `providers` に
 * `PermissionService` を並べると**インスタンスが別々**になり、
 * `invalidate()`（権限変更時のキャッシュ破棄, 7章）が
 * **他のモジュールのキャッシュに届かない**。
 * 判定は正しいのに「権限を外したのに編集が続けられる」状態が残る。
 */
@Global()
@Module({
  imports: [forwardRef(() => DocModule)],
  providers: [
    PermissionResolver,
    PermissionService,
    DocTypeResolver,
    PrismaService,
  ],
  exports: [PermissionService],
})
export class PermissionModule {}

import { forwardRef, Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { PermissionModule } from '../permission/permission.module';
import { DiscoveryRevisionService } from './discovery-revision.service';
import { DiscoveryResolver } from './discovery.resolver';
import { DiscoveryService } from './discovery.service';
import { DocMetaAuditService } from './doc-meta-audit.service';
import { IndexReaderService } from './index-reader.service';
import { DocMetaWriteService } from './doc-meta-write.service';
import { DocGcService } from './doc-gc.service';

/**
 * #151: Discovery Index（存在を知ってよいドキュメント）。
 *
 * ⚠️ `DiscoveryRevisionService` は**版数を上げる側**（doc の保存・権限変更）
 * からも使うため export する。上げ忘れると「権限は正しいのに一覧が古い」
 * 状態になる。
 */
@Module({
  // #151 段階3: 書き込みの認可を PermissionService に委ねるため
  // （判定を散らさない。docs/doc-permission.md）
  //
  // ⚠️ **forwardRef が要る。** 次の循環があるため:
  //   DiscoveryModule → PermissionModule → DocModule → DiscoveryModule
  // 外すと起動時に UndefinedModuleException で落ちる
  imports: [forwardRef(() => PermissionModule)],
  providers: [
    DiscoveryResolver,
    DiscoveryService,
    DiscoveryRevisionService,
    IndexReaderService,
    DocMetaAuditService,
    DocMetaWriteService,
    // #45: 完全削除。sync（space:delete-doc）からも使う
    DocGcService,
    PrismaService,
  ],
  exports: [
    DiscoveryRevisionService,
    DiscoveryService,
    IndexReaderService,
    DocGcService,
  ],
})
export class DiscoveryModule {}

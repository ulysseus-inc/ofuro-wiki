export { DiscoveryService, type DiscoverySource } from './services/discovery';
export {
  DocMetaWriteStore,
  type DocMetaWriteResult,
} from './stores/doc-meta-write';
export { DocMetaWriteService } from './services/doc-meta-write';
export {
  PendingWriteStore,
  type PendingWrite,
  type PendingField,
} from './stores/pending-write';
export { diffTags, planMetaWrite } from './plan-meta-write';
export {
  type DiscoveryCacheDocument,
  type DiscoveryCacheEntry,
} from './stores/discovery-cache';

import { type Framework } from '@toeverything/infra';

import { WorkspaceServerService } from '../cloud';
import { CacheStorage } from '../storage';
import { WorkspaceScope } from '../workspace';
import { DiscoveryService } from './services/discovery';
import { DiscoveryStore } from './stores/discovery';
import { DiscoveryCacheStore } from './stores/discovery-cache';
import { DocMetaWriteStore } from './stores/doc-meta-write';
import { PendingWriteStore } from './stores/pending-write';
import { DocMetaWriteService } from './services/doc-meta-write';

/**
 * #151: Discovery Index（存在を知ってよいドキュメント）。
 *
 * ⚠️ キャッシュは **IndexedDB** に置く（`CacheStorage`）。
 * 起動時・オフライン時に一覧を出すためで、
 * **権限情報の正本ではない**（docs/doc-permission.md）。
 */
export function configureDiscoveryModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(DiscoveryService, [DiscoveryStore, DiscoveryCacheStore])
    .store(DiscoveryStore, [WorkspaceServerService])
    .store(DiscoveryCacheStore, [CacheStorage])
    // #151 段階3: Discovery Metadata の書き込み
    .store(DocMetaWriteStore, [WorkspaceServerService])
    .service(DocMetaWriteService, [DocMetaWriteStore, PendingWriteStore])
    // #151 段階3: 送れなかった変更を控える（7.5.8）。
    // ⚠️ スナップショットとは**別の鍵**に置く。同居させると、
    // スナップショットの入れ替えのたびに未送信分が消える
    .store(PendingWriteStore, [CacheStorage]);
}

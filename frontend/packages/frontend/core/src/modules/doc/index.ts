export { Doc } from './entities/doc';
export { DocRecord } from './entities/record';
export { DocRecordList } from './entities/record-list';
export { DocCreated } from './events';
export { DocScope } from './scopes/doc';
export { DocService } from './services/doc';
export { DocsService } from './services/docs';

import type { Framework } from '@toeverything/infra';

// ⚠️ **バレル（modules/cloud, modules/discovery の index）から読まないこと。**
// cloud → … → doc の循環参照ができ、初期化時に
// 「Cannot read properties of undefined」で**画面が真っ白になる**。
// 実装ファイルを直接指す
import { WorkspaceServerService } from '../cloud/services/workspace-server';
import { WorkspaceDBService } from '../db/services/db';
import { DiscoveryService } from '../discovery/services/discovery';
import { DocMetaWriteService } from '../discovery/services/doc-meta-write';
import { WorkspaceScope, WorkspaceService } from '../workspace';
import { Doc } from './entities/doc';
import { DocRecord } from './entities/record';
import { DocRecordList } from './entities/record-list';
import { DocCreateMiddleware } from './providers/doc-create-middleware';
import { DocScope } from './scopes/doc';
import { DocService } from './services/doc';
import { DocsService } from './services/docs';
import { DocPropertiesStore } from './stores/doc-properties';
import { DocsStore } from './stores/docs';

export { DocCreateMiddleware } from './providers/doc-create-middleware';

export function configureDocModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(DocsService, [
      DocsStore,
      DocPropertiesStore,
      [DocCreateMiddleware],
    ])
    .store(DocPropertiesStore, [WorkspaceService, WorkspaceDBService])
    // #151: 一覧は DiscoveryService（サーバーの台帳）から作る。
    // 誰にとっての一覧かが要るため AuthService も要る
    .store(DocsStore, [
      WorkspaceService,
      DocPropertiesStore,
      DiscoveryService,
      // #151 段階3: 台帳の版数を書き込み側へ渡す
      DocMetaWriteService,
      // ⚠️ AuthService は ServerScope にあり WorkspaceScope からは辿れない。
      // ここで直接指定すると DI が解決できず**画面が 500 で落ちる**
      WorkspaceServerService,
    ])
    .entity(DocRecord, [DocsStore, DocPropertiesStore])
    .entity(DocRecordList, [DocsStore])
    .scope(DocScope)
    .entity(Doc, [DocScope, DocsStore, WorkspaceService])
    .service(DocService);
}

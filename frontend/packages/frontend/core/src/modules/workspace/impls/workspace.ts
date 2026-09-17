import {
  BlockSuiteError,
  ErrorCode,
} from '@blocksuite/affine/global/exceptions';
import { NoopLogger } from '@blocksuite/affine/global/utils';
import {
  type Doc,
  type DocMeta,
  type IdGenerator,
  nanoid,
  type Workspace,
} from '@blocksuite/affine/store';
import {
  BlobEngine,
  type BlobSource,
  MemoryBlobSource,
} from '@blocksuite/affine/sync';
import { Subject } from 'rxjs';
import type { Awareness } from 'y-protocols/awareness.js';
import type { Doc as YDoc } from 'yjs';

import type { FeatureFlagService } from '../../feature-flag';
import { DocImpl } from './doc';
import { WorkspaceMetaImpl, type DocMetaWriteSender } from './meta';

type WorkspaceOptions = {
  id?: string;
  rootDoc: YDoc;
  blobSource?: BlobSource;
  onLoadDoc?: (doc: YDoc) => void;
  onLoadAwareness?: (awareness: Awareness) => void;
  onCreateDoc?: (docId?: string) => string;
  featureFlagService?: FeatureFlagService;
  /** #151 段階3: メタデータの変更をサーバーへ送る（7.5.2） */
  onMetaWrite?: DocMetaWriteSender;
  /** #151 段階3: ページを作った／消したことを台帳へ知らせる */
  onMetaCreate?: (id: string, meta: DocMeta) => void;
  onMetaDelete?: (id: string) => void;
  /**
   * #151 段階3: 台帳が Discovery Metadata の供給元か。
   *
   * ⚠️ **サーバーを持つワークスペースだけ true。** ローカルには台帳が
   * 無いので、目次を使い続ける
   */
  ledgerDriven?: boolean;
};

export class WorkspaceImpl implements Workspace {
  readonly blobSync: BlobEngine;

  readonly blockCollections = new Map<string, Doc>();

  readonly doc: YDoc;

  readonly id: string;

  readonly idGenerator: IdGenerator;

  // ⚠️ 実装クラスの型にする。上流の WorkspaceMeta には
  // applyRemoteDocMeta（#151 段階3）が無い
  meta: WorkspaceMetaImpl;

  slots = {
    /* eslint-disable rxjs/finnish */
    docListUpdated: new Subject<void>(),
    /* eslint-enable rxjs/finnish */
  };

  get docs() {
    return this.blockCollections;
  }

  readonly onLoadDoc?: (doc: YDoc) => void;
  readonly onLoadAwareness?: (awareness: Awareness) => void;
  readonly onCreateDoc?: (docId?: string) => string;
  readonly featureFlagService?: FeatureFlagService;
  /** #151 段階3: メタデータの変更をサーバーへ送る（7.5.2） */
  readonly onMetaWrite?: DocMetaWriteSender;

  constructor({
    id,
    rootDoc,
    blobSource,
    onLoadDoc,
    onLoadAwareness,
    onCreateDoc,
    featureFlagService,
    onMetaWrite,
    onMetaCreate,
    onMetaDelete,
    ledgerDriven,
  }: WorkspaceOptions) {
    this.id = id || '';
    this.featureFlagService = featureFlagService;
    this.doc = rootDoc;
    this.onLoadDoc = onLoadDoc;
    this.onLoadDoc?.(this.doc);
    this.onLoadAwareness = onLoadAwareness;
    this.onCreateDoc = onCreateDoc;

    blobSource = blobSource ?? new MemoryBlobSource();
    const logger = new NoopLogger();

    this.blobSync = new BlobEngine(blobSource, [], logger);

    this.idGenerator = nanoid;

    this.meta = new WorkspaceMetaImpl(
      this.doc,
      undefined,
      onMetaWrite,
      onMetaCreate,
      onMetaDelete,
      ledgerDriven
    );
    this._bindDocMetaEvents();
  }

  private _bindDocMetaEvents() {
    this.meta.docMetaAdded.subscribe(docId => {
      const doc = new DocImpl({
        id: docId,
        collection: this,
        doc: this.doc,
      });
      this.blockCollections.set(doc.id, doc);
    });

    this.meta.docMetaUpdated.subscribe(() => this.slots.docListUpdated.next());

    this.meta.docMetaRemoved.subscribe(id => {
      const doc = this._getDoc(id);
      if (!doc) return;
      this.blockCollections.delete(id);
      doc.remove();
    });
  }

  private _hasDoc(docId: string) {
    return this.docs.has(docId);
  }

  /**
   * By default, only an empty doc will be created.
   * If the `init` parameter is passed, a `surface`, `note`, and `paragraph` block
   * will be created in the doc simultaneously.
   */
  createDoc(docId?: string): Doc {
    if (this.onCreateDoc) {
      const id = this.onCreateDoc(docId);
      const doc = this.getDoc(id);
      if (!doc) {
        throw new BlockSuiteError(
          ErrorCode.DocCollectionError,
          'create doc failed'
        );
      }
      return doc;
    }
    const id = docId ?? this.idGenerator();
    if (this._hasDoc(id)) {
      throw new BlockSuiteError(
        ErrorCode.DocCollectionError,
        'doc already exists'
      );
    }

    this.meta.addDocMeta({
      id,
      title: '',
      createDate: Date.now(),
      tags: [],
    });
    return this.getDoc(id) as Doc;
  }

  private _getDoc(docId: string): Doc | null {
    const space = this.docs.get(docId) as Doc | undefined;
    return space ?? null;
  }

  getDoc(docId: string): Doc | null {
    const doc = this._getDoc(docId);
    return doc;
  }

  removeDoc(docId: string) {
    const docMeta = this.meta.getDocMeta(docId);
    if (!docMeta) {
      throw new BlockSuiteError(
        ErrorCode.DocCollectionError,
        `doc meta not found: ${docId}`
      );
    }

    const blockCollection = this._getDoc(docId);
    if (!blockCollection) return;

    blockCollection.dispose();
    this.meta.removeDocMeta(docId);
    this.blockCollections.delete(docId);
  }

  dispose() {
    this.blockCollections.forEach(doc => doc.dispose());
  }
}

import { getStoreManager } from '@ofuro/core/blocksuite/manager/store';
import {
  AwarenessStore,
  type Doc,
  type ExtensionType,
  type GetStoreOptions,
  StoreContainer,
  type YBlock,
} from '@blocksuite/affine/store';
import { Awareness } from 'y-protocols/awareness.js';
import * as Y from 'yjs';

import type { WorkspaceImpl } from './workspace';

type DocOptions = {
  id: string;
  collection: WorkspaceImpl;
  doc: Y.Doc;
};

export class DocImpl implements Doc {
  private readonly _collection: WorkspaceImpl;

  private readonly _storeContainer: StoreContainer;

  private readonly _initSpaceDoc = () => {
    // #151 stage 3 (PR5-c): do NOT register this doc under the root doc's
    // `spaces` map.
    //
    // The root doc is shared with every workspace member, so anything written
    // here is delivered to people who are not allowed to read the document.
    // The value carries no title, but it does reveal that the document exists
    // and what its id is - which stage 3 exists to hide.
    //
    // Upstream wrote this entry only for compatibility with older clients
    // ("new version no longer needs subdoc on `spaces`"), and the subdoc it
    // read back was discarded unmodified: the real space doc is created below.
    // ofuro-wiki is self-hosted and every client runs the same version, so
    // that compatibility is deliberately dropped. See docs 7.9.
    //
    // WARNING: removing existing entries is not enough on its own. As long as
    // this method writes, opening a document puts the id straight back.
    const spaceDoc = new Y.Doc({ guid: this.id });
    spaceDoc.clientID = this.rootDoc.clientID;
    this._loaded = false;

    return spaceDoc;
  };

  private _loaded!: boolean;

  /** Indicate whether the block tree is ready */
  private _ready = false;

  protected readonly _yBlocks: Y.Map<YBlock>;

  /**
   * @internal Used for convenient access to the underlying Yjs map,
   * can be used interchangeably with ySpace
   */
  protected readonly _ySpaceDoc: Y.Doc;

  readonly storeExtensions: ExtensionType[] = [];

  readonly awarenessStore: AwarenessStore;

  readonly id: string;

  readonly rootDoc: Y.Doc;

  get blobSync() {
    return this.workspace.blobSync;
  }

  get workspace() {
    return this._collection;
  }

  get isEmpty() {
    return this._yBlocks.size === 0;
  }

  get loaded() {
    return this._loaded;
  }

  get meta() {
    return this.workspace.meta.getDocMeta(this.id);
  }

  get ready() {
    return this._ready;
  }

  get spaceDoc() {
    return this._ySpaceDoc;
  }

  get yBlocks() {
    return this._yBlocks;
  }

  constructor({ id, collection, doc }: DocOptions) {
    this.id = id;
    this.rootDoc = doc;
    this._ySpaceDoc = this._initSpaceDoc() as Y.Doc;
    this.awarenessStore = new AwarenessStore(new Awareness(this._ySpaceDoc));

    this._yBlocks = this._ySpaceDoc.getMap('blocks');
    this._collection = collection;
    this._storeContainer = new StoreContainer(this);
  }

  clear() {
    this._yBlocks.clear();
  }

  get removeStore() {
    return this._storeContainer.removeStore;
  }

  private _destroy() {
    this.awarenessStore.destroy();
    this._ySpaceDoc.destroy();
    this._loaded = false;
  }

  dispose() {
    this._destroy();

    if (this.ready) {
      this._yBlocks.clear();
    }
  }

  getStore({
    readonly,
    query,
    provider,
    extensions,
    id,
  }: GetStoreOptions = {}) {
    const storeExtensions = getStoreManager()
      .config.init()
      .featureFlag(this.workspace.featureFlagService)
      .value.get('store');
    const exts = storeExtensions
      .concat(extensions ?? [])
      .concat(this.storeExtensions);
    const extensionSet = new Set(exts);

    return this._storeContainer.getStore({
      id,
      readonly,
      query,
      provider,
      extensions: Array.from(extensionSet),
    });
  }

  load(initFn?: () => void): this {
    if (this.ready) {
      return this;
    }

    this.spaceDoc.load();
    this.workspace.onLoadDoc?.(this.spaceDoc);
    this.workspace.onLoadAwareness?.(this.awarenessStore.awareness);

    initFn?.();

    this._loaded = true;
    this._ready = true;

    return this;
  }

  remove() {
    this._destroy();
    // #151 stage 3 (PR5-c): we no longer write to `spaces`, but keep deleting
    // so that entries left over from before the change are cleared as their
    // documents are removed. Deleting an absent key is a no-op.
    this.rootDoc.getMap('spaces').delete(this.id);
  }
}

import { signal } from '@preact/signals-core';
import { Subject } from 'rxjs';
import * as Y from 'yjs';

import type { Store } from '../../model';
import { StoreExtension } from '../store-extension';

/** ページの骨組みのブロック。 */
const PAGE_FLAVOUR = 'affine:page';

/**
 * 骨組みのブロックそのもの、またはその属性か。
 *
 * 例: `blocks` の中の骨組みの Y.Map、その `sys:flavour`・`sys:children`・`prop:title`。
 * 属性も守るのは、ブロックだけ残っても `sys:flavour` が消えると骨組みとして読まれないため。
 * 属性の中身（題の文字・子の並び）は守らない。これまでどおり Undo で戻る。
 */
function isPageBlockItem(item: Y.Item): boolean {
  const { content } = item;
  if (content instanceof Y.ContentType && isPageBlockMap(content.type)) {
    return true;
  }
  return isPageBlockMap(item.parent);
}

function isPageBlockMap(type: unknown): boolean {
  return type instanceof Y.Map && type.get('sys:flavour') === PAGE_FLAVOUR;
}

export class HistoryExtension extends StoreExtension {
  static override readonly key = 'history';

  private readonly _history!: Y.UndoManager;

  private readonly _canRedo = signal(false);

  private readonly _canUndo = signal(false);

  readonly onUpdated = new Subject<void>();

  constructor(store: Store) {
    super(store);

    this._history = new Y.UndoManager([this.store.doc.yBlocks], {
      trackedOrigins: new Set([this.store.doc.spaceDoc.clientID]),
      // #256: Undo でページの骨組み（affine:page）を消させない。
      // 骨組みが消えるとページが開けなくなる（2026-06-21 本番、インポート直後の Ctrl-Z）。
      // 骨組みの作成が Undo の対象に残る経路は、インポート以外にも増え得る
      deleteFilter: item => !isPageBlockItem(item),
    });
  }

  private readonly _updateCanUndoRedoSignals = () => {
    const canRedo = this._history.canRedo();
    const canUndo = this._history.canUndo();
    if (this._canRedo.peek() !== canRedo) {
      this._canRedo.value = canRedo;
    }
    if (this._canUndo.peek() !== canUndo) {
      this._canUndo.value = canUndo;
    }
  };

  get canRedo() {
    return this._canRedo.peek();
  }

  get canUndo() {
    return this._canUndo.peek();
  }

  get canRedo$() {
    return this._canRedo;
  }

  get canUndo$() {
    return this._canUndo;
  }

  get undoManager() {
    return this._history;
  }

  override loaded() {
    this._updateCanUndoRedoSignals();
    this._history.on('stack-cleared', this._historyObserver);
    this._history.on('stack-item-added', this._historyObserver);
    this._history.on('stack-item-popped', this._historyObserver);
    this._history.on('stack-item-updated', this._historyObserver);
  }

  private readonly _historyObserver = () => {
    this._updateCanUndoRedoSignals();
    this.onUpdated.next();
  };

  override disposed() {
    super.disposed();
    this._history.off('stack-cleared', this._historyObserver);
    this._history.off('stack-item-added', this._historyObserver);
    this._history.off('stack-item-popped', this._historyObserver);
    this._history.off('stack-item-updated', this._historyObserver);
    this.onUpdated.complete();
  }
}

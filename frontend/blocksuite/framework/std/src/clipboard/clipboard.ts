import { BlockSuiteError, ErrorCode } from '@blocksuite/global/exceptions';

// In-memory clipboard fallback for HTTP environments (navigator.clipboard unavailable)
const _inMemoryClipboard: Map<string, string> = new Map();
// Freshness flag: true immediately after an in-editor copy in HTTP mode.
// Reset to false when the window loses focus, which is the only reliable
// signal that the user may have copied from an external app.
let _inMemoryClipboardFresh = false;
if (typeof window !== 'undefined') {
  window.addEventListener('blur', () => {
    _inMemoryClipboardFresh = false;
  });
}
import type {
  BlockSnapshot,
  Slice,
  Store,
  TransformerMiddleware,
} from '@blocksuite/store';
import DOMPurify from 'dompurify';
import * as lz from 'lz-string';
import rehypeParse from 'rehype-parse';
import { unified } from 'unified';

import { LifeCycleWatcher } from '../extension/index.js';
import { ClipboardAdapterConfigIdentifier } from './clipboard-adapter.js';
import { onlyContainImgElement } from './utils.js';

export class Clipboard extends LifeCycleWatcher {
  static override key = 'clipboard';

  protected get _adapters() {
    const adapterConfigs = this.std.provider.getAll(
      ClipboardAdapterConfigIdentifier
    );
    return Array.from(adapterConfigs.values());
  }

  // Need to be cloned to a map for later use
  private readonly _getDataByType = (clipboardData: DataTransfer) => {
    const data = new Map<string, string | File[]>();
    for (const type of clipboardData.types) {
      if (type === 'Files') {
        data.set(type, Array.from(clipboardData.files));
      } else {
        data.set(type, clipboardData.getData(type));
      }
    }
    if (data.get('Files') && data.get('text/html')) {
      const htmlAst = unified()
        .use(rehypeParse)
        .parse(data.get('text/html') as string);

      const isImgOnly =
        htmlAst.children.map(onlyContainImgElement).reduce((a, b) => {
          if (a === 'no' || b === 'no') {
            return 'no';
          }
          if (a === 'maybe' && b === 'maybe') {
            return 'maybe';
          }
          return 'yes';
        }, 'maybe') === 'yes';

      if (isImgOnly) {
        data.delete('text/html');
      }
    }
    return (type: string) => {
      const item = data.get(type);
      if (item) {
        return item;
      }
      const files = (data.get('Files') ?? []) as File[];
      if (files.length > 0) {
        return files;
      }
      return '';
    };
  };

  private readonly _getSnapshotByPriority = async (
    getItem: (type: string) => string | File[],
    doc: Store,
    parent?: string,
    index?: number
  ) => {
    const byPriority = Array.from(this._adapters).sort(
      (a, b) => b.priority - a.priority
    );

    for (const { adapter, mimeType } of byPriority) {
      const item = getItem(mimeType);
      if (Array.isArray(item)) {
        if (item.length === 0) {
          continue;
        }
        if (
          // if all files are not the same target type, fallback to */*
          !item
            .map(f => f.type === mimeType || mimeType === '*/*')
            .reduce((a, b) => a && b, true)
        ) {
          continue;
        }
      }
      if (item) {
        const job = this._getJob();
        const adapterInstance = new adapter(job, this.std.store.provider);
        const payload = {
          file: item,
          assets: job.assetsManager,
          workspaceId: doc.workspace.id,
          pageId: doc.id,
        };
        const result = await adapterInstance.toSlice(
          payload,
          doc,
          parent,
          index
        );
        if (result) {
          return result;
        }
      }
    }
    return null;
  };

  private _jobMiddlewares: TransformerMiddleware[] = [];

  copy = async (slice: Slice) => {
    return this.copySlice(slice);
  };

  // Gated by https://developer.mozilla.org/en-US/docs/Glossary/Transient_activation
  copySlice = async (slice: Slice) => {
    const adapterKeys = this._adapters.map(adapter => adapter.mimeType);

    await this.writeToClipboard(async items => {
      const filtered = (
        await Promise.all(
          adapterKeys.map(async type => {
            const item = await this._getClipboardItem(slice, type);
            if (typeof item === 'string') {
              return [type, item];
            }
            return null;
          })
        )
      ).filter((adapter): adapter is string[] => Boolean(adapter));

      return {
        ...items,
        ...Object.fromEntries(filtered),
      };
    });
  };

  duplicateSlice = async (
    slice: Slice,
    doc: Store,
    parent?: string,
    index?: number,
    type = 'BLOCKSUITE/SNAPSHOT'
  ) => {
    const items = {
      [type]: await this._getClipboardItem(slice, type),
    };

    await this._getSnapshotByPriority(
      type => (items[type] as string | File[]) ?? '',
      doc,
      parent,
      index
    );
  };

  paste = async (
    event: ClipboardEvent,
    doc: Store,
    parent?: string,
    index?: number
  ) => {
    const data = event.clipboardData;

    if (data) {
      // 1. Try BlockSuite snapshot from OS clipboard
      try {
        const json = this.readFromClipboard(data);
        const slice = await this._getSnapshotByPriority(
          type => json[type],
          doc,
          parent,
          index
        );
        if (slice) return slice;
      } catch (_e) {
        // No BlockSuite snapshot in OS clipboard
      }

      // 2a. In non-secure contexts (HTTP), navigator.clipboard.write() is
      // unavailable and e.preventDefault() suppresses the browser's default
      // copy, so the OS clipboard is never updated by the editor.
      // Use the in-memory clipboard when it holds a fresh in-editor copy
      // (_inMemoryClipboardFresh=true). The flag is cleared on window blur so
      // that an external copy (from another app) invalidates the cache.
      if (!window.isSecureContext && _inMemoryClipboard.size > 0 && _inMemoryClipboardFresh) {
        const slice = await this._tryInMemoryClipboard(doc, parent, index);
        if (slice) return slice;
      }

      // 2b. Try other formats from OS clipboard
      const getDataByType = this._getDataByType(data);
      const slice = await this._getSnapshotByPriority(
        type => getDataByType(type),
        doc,
        parent,
        index
      );
      if (slice) return slice;
    }

    // 3. Fallback to in-memory clipboard (secure context where clipboard write
    // failed for some other reason, e.g. permission denied)
    if (_inMemoryClipboard.size > 0) {
      const slice = await this._tryInMemoryClipboard(doc, parent, index);
      if (slice) return slice;
    }

    return null;
  };

  private async _tryInMemoryClipboard(
    doc: Store,
    parent?: string,
    index?: number
  ) {
    // The snapshot is embedded inside text/html as data-blocksuite-snapshot.
    // Extract and parse it the same way readFromClipboard() does.
    const htmlContent = _inMemoryClipboard.get('text/html');
    if (htmlContent) {
      try {
        const sanitized = DOMPurify.sanitize(htmlContent);
        const htmlDoc = new DOMParser().parseFromString(sanitized, 'text/html');
        const dom = htmlDoc.querySelector<HTMLDivElement>(
          '[data-blocksuite-snapshot]'
        );
        if (dom) {
          const json = JSON.parse(
            lz.decompressFromEncodedURIComponent(
              dom.dataset.blocksuiteSnapshot as string
            )
          );
          const slice = await this._getSnapshotByPriority(
            type => json[type] ?? '',
            doc,
            parent,
            index
          );
          if (slice) return slice;
        }
      } catch (_e) {
        // No snapshot found in in-memory HTML, fall through
      }
    }
    // Fallback: try other in-memory content as-is
    const getItem = (type: string): string | File[] =>
      _inMemoryClipboard.get(type) ?? '';
    return this._getSnapshotByPriority(getItem, doc, parent, index);
  }

  pasteBlockSnapshot = async (
    snapshot: BlockSnapshot,
    doc: Store,
    parent?: string,
    index?: number
  ) => {
    return this._getJob().snapshotToBlock(snapshot, doc, parent, index);
  };

  unuse = (middleware: TransformerMiddleware) => {
    this._jobMiddlewares = this._jobMiddlewares.filter(m => m !== middleware);
  };

  use = (middleware: TransformerMiddleware) => {
    this._jobMiddlewares.push(middleware);
  };

  get configs() {
    return this._getJob().adapterConfigs;
  }

  private async _getClipboardItem(slice: Slice, type: string) {
    const job = this._getJob();
    const adapterItem = this.std.getOptional(
      ClipboardAdapterConfigIdentifier(type)
    );
    if (!adapterItem) {
      return;
    }
    const { adapter } = adapterItem;
    const adapterInstance = new adapter(job, this.std.store.provider);
    const result = await adapterInstance.fromSlice(slice);
    if (!result) {
      return;
    }
    return result.file;
  }

  private _getJob() {
    return this.std.store.getTransformer(this._jobMiddlewares);
  }

  readFromClipboard(clipboardData: DataTransfer) {
    const items = clipboardData.getData('text/html');
    const sanitizedItems = DOMPurify.sanitize(items);
    const domParser = new DOMParser();
    const doc = domParser.parseFromString(sanitizedItems, 'text/html');
    const dom = doc.querySelector<HTMLDivElement>('[data-blocksuite-snapshot]');
    if (!dom) {
      throw new BlockSuiteError(
        ErrorCode.TransformerError,
        'No snapshot found'
      );
    }
    const json = JSON.parse(
      lz.decompressFromEncodedURIComponent(
        dom.dataset.blocksuiteSnapshot as string
      )
    );
    return json;
  }

  sliceToSnapshot(slice: Slice) {
    const job = this._getJob();
    return job.sliceToSnapshot(slice);
  }

  async writeToClipboard(
    updateItems: <T extends Record<string, unknown>>(items: T) => Promise<T> | T
  ) {
    const items = await updateItems<
      Partial<{
        'text/plain': string;
        'text/html': string;
        'image/png': string | Blob;
      }>
    >({
      'text/plain': '',
      'text/html': '',
      'image/png': '',
    });
    const text = items['text/plain'] ?? '';
    const innerHTML = items['text/html'] ?? '';
    const image = items['image/png'];

    delete items['text/plain'];
    delete items['text/html'];

    const clipboardItems: Record<string, Blob> = {};

    if (image) {
      const type = 'image/png';
      delete items[type];
      if (typeof image === 'string') {
        clipboardItems[type] = new Blob([image], { type });
      } else if (image instanceof Blob) {
        clipboardItems[type] = image;
      }
    }

    if (text.length > 0) {
      const type = 'text/plain';
      clipboardItems[type] = new Blob([text], { type });
    }

    const hasInnerHTML = Boolean(innerHTML.length);
    const isEmpty = Object.keys(clipboardItems).length === 0;

    // If there are no items, fall back to snapshot.
    if (hasInnerHTML || isEmpty) {
      const type = 'text/html';
      const snapshot = lz.compressToEncodedURIComponent(JSON.stringify(items));
      const html = `<div data-blocksuite-snapshot="${snapshot}">${innerHTML}</div>`;
      clipboardItems[type] = new Blob([html], { type });
    }

    try {
      await navigator.clipboard.write([new ClipboardItem(clipboardItems)]);
    } catch (_e) {
      // Fallback for HTTP environments: store serialized content in memory
      _inMemoryClipboard.clear();
      for (const [type, blob] of Object.entries(clipboardItems)) {
        if (blob instanceof Blob) {
          _inMemoryClipboard.set(type, await blob.text());
        }
      }
      _inMemoryClipboardFresh = true;
    }
  }
}

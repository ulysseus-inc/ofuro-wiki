import { StoreExtensionManager } from '@blocksuite/affine/ext-loader';
import { getInternalStoreExtensions } from '@blocksuite/affine/extensions/store';
import { Container } from '@blocksuite/affine/global/di';
import { AffineSchemas } from '@blocksuite/affine/schemas';
import { MarkdownAdapter } from '@blocksuite/affine/shared/adapters';
import {
  type Store,
  Schema,
  Transformer,
  type TransformerMiddleware,
} from '@blocksuite/affine/store';
import { TestWorkspace } from '@blocksuite/affine/store/test';
import * as Y from 'yjs';

import { CliError } from '../errors';

/**
 * blocksuite を Node で動かすための土台（設計書 §3.0）。
 *
 * ⚠️ Workspace は `TestWorkspace`（`@internal`）を使う（設計書 I1）。
 * CLI は1プロセスで1〜2ページしか扱わず、同期・Blob・Awareness は
 * 自前の SyncClient が担うため、ここでは「Y.Doc に Store を被せる」役だけ要る。
 * フロントエンドの WorkspaceImpl は DI・機能フラグ等を引き連れて重い。
 */
const schema = new Schema();
schema.register(AffineSchemas);

const extensions = new StoreExtensionManager(getInternalStoreExtensions()).get(
  'store'
);

const provider = (() => {
  const container = new Container();
  extensions.forEach(ext => ext.setup(container));
  return container.provider();
})();

const workspace = (() => {
  const ws = new TestWorkspace({ id: 'ofuro-agent-cli' });
  ws.storeExtensions = extensions;
  ws.meta.initialize();
  return ws;
})();

/** Store と、サーバーに無い変更を1つの更新にまとめる仕組み */
export interface LoadedDoc {
  store: Store;
  /** サーバーにまだ無い変更。無ければ null */
  takeUpdate(): Uint8Array | null;
}

/** 何も持っていない状態の state vector */
const EMPTY_STATE_VECTOR = new Uint8Array([0]);

/**
 * サーバーから取った全状態を載せて Store を作る。
 *
 * `state` が無ければ空の新規ページになる（作成用）。
 *
 * ⚠️ 送る差分は「サーバーの状態に無いもの全部」。`update` イベントを
 * 聞くだけでは、読み込み時に blocksuite が手元で補う値（古いデータに
 * 無い props 等）が漏れ、後続の編集がサーバーで取り込めなくなる
 * （設計書 §6.2）。
 */
export function loadDoc(docId: string, state?: Uint8Array): LoadedDoc {
  const doc = workspace.getDoc(docId) ?? workspace.createDoc(docId);
  const hasState = !!state && state.length > 0;
  if (hasState) {
    Y.applyUpdate(doc.spaceDoc, state);
  }
  doc.load();
  const store = doc.getStore({ id: docId });

  // ⚠️ 削除は state vector を進めないため、変更の有無は別に見る
  let base = hasState
    ? Y.encodeStateVectorFromUpdate(state)
    : EMPTY_STATE_VECTOR;
  let dirty = false;
  doc.spaceDoc.on('update', () => {
    dirty = true;
  });

  return {
    store,
    takeUpdate() {
      const current = Y.encodeStateVector(doc.spaceDoc);
      if (!dirty && sameBytes(current, base)) {
        return null;
      }
      const update = Y.encodeStateAsUpdate(doc.spaceDoc, base);
      base = current;
      dirty = false;
      return update;
    },
  };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function createTransformer(
  middlewares: TransformerMiddleware[]
): Transformer {
  return new Transformer({
    schema,
    blobCRUD: workspace.blobSync,
    docCRUD: {
      create: (id: string) => workspace.createDoc(id).getStore({ id }),
      get: (id: string) => workspace.getDoc(id)?.getStore({ id }) ?? null,
      delete: (id: string) => workspace.removeDoc(id),
    },
    middlewares,
  });
}

export function getMarkdownAdapter(transformer: Transformer): MarkdownAdapter {
  return new MarkdownAdapter(transformer, provider);
}

export function newId(): string {
  return workspace.idGenerator();
}

const TRANSACT_ERROR = 'An error occurred while Y.doc';

/**
 * blocksuite の変更で起きた例外を、握りつぶさずに投げ直す。
 *
 * ⚠️ `Store.transact` は中で起きた例外を console.error に書いて**続行する**。
 * そのままだと、途中で失敗した編集が「成功」として送られてしまう
 * （設計書 §6.2「全部当たるか、何も当たらないか」が崩れる）。
 */
export async function strict<T>(run: () => Promise<T> | T): Promise<T> {
  const original = console.error;
  let failed = false;
  let awaitingCause = false;
  let cause = '';

  // blocksuite は「見出し」と「例外そのもの」を2回に分けて書く
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith(TRANSACT_ERROR)) {
      failed = true;
      awaitingCause = true;
      return;
    }
    if (awaitingCause) {
      awaitingCause = false;
      cause ||= args[0] instanceof Error ? args[0].message : String(args[0]);
      return;
    }
    original(...args);
  };

  try {
    const result = await run();
    if (failed) {
      throw new CliError(`ページの変更に失敗した: ${cause}`);
    }
    return result;
  } finally {
    console.error = original;
  }
}

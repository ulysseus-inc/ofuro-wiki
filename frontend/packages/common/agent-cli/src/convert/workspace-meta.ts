import * as Y from 'yjs';

/**
 * ワークスペースの表示名。ブラウザと同じく、ルート文書の `meta.name` から読む。
 *
 * ⚠️ DB の `workspaces.name` は作成時の既定値（`ofuro-wiki`）のままのことが多く、
 * 画面に出ている名前と一致しない。
 */
export function workspaceName(rootState: Uint8Array): string | undefined {
  if (rootState.length === 0) {
    return undefined;
  }
  const doc = new Y.Doc();
  Y.applyUpdate(doc, rootState);
  const name = doc.getMap('meta').get('name');
  doc.destroy();
  return typeof name === 'string' && name.trim() ? name.trim() : undefined;
}

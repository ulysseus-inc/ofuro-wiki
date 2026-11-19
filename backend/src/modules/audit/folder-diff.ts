import * as Y from 'yjs';

/**
 * #283: フォルダの差分を操作に直す（docs/logging.md 2.12）。
 *
 * フォルダはワークスペースに 1 つの Yjs 文書（`db$<ws>$folders`）で、
 * サーバーには「何をしたか」が来ない。差分を当てる前後を項目ごとに比べる。
 *
 * ```
 * db$<ws>$folders (Y.Doc)
 * ├ <id> (Y.Map) { id, type: 'folder', data: '設計', parentId: null, index }
 * └ <id> (Y.Map) { id, type: 'doc',    data: <docId>, parentId: <フォルダ>, index }
 * ```
 * 消した項目は、id 以外が消えて `$$DELETED: true` だけが残る（frontend の YjsTableAdapter）。
 */

/** 削除の印（frontend の YjsTableAdapter と同じ） */
const DELETED = '$$DELETED';
const FOLDER_TYPE = 'folder';

export enum FolderChangeKind {
  Create = 'folder.create',
  Rename = 'folder.rename',
  Delete = 'folder.delete',
  Move = 'folder.move',
  ItemAdd = 'folder.item.add',
  ItemRemove = 'folder.item.remove',
  ItemMove = 'folder.item.move',
}

export interface FolderNode {
  id: string;
  /** `folder` / `doc` / `tag` / `collection` */
  type: string;
  /** フォルダなら名前、中身なら入れたものの ID */
  data: string;
  parentId: string | null;
  index: string;
}

export interface FolderChange {
  kind: FolderChangeKind;
  /** 変えたあとの項目。消したときは消える前の項目 */
  node: FolderNode;
  /** 変える前の項目（名前の変更・移動） */
  before?: FolderNode;
  /** フォルダと一緒に消えた中身の数（削除のみ） */
  items?: number;
}

/** 消えていない項目を id ごとに読む */
export function readFolders(state: Uint8Array): Map<string, FolderNode> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return nodesOf(doc);
}

/** 保存済みの状態（before）に、届いた差分（update）を当てたときの操作 */
export function diffFolders(
  before: Uint8Array,
  update: Uint8Array,
): FolderChange[] {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, before);
  const prev = nodesOf(doc);
  Y.applyUpdate(doc, update);
  const next = nodesOf(doc);

  const changes: FolderChange[] = [];

  // 増えた・変わった
  for (const node of next.values()) {
    const old = prev.get(node.id);
    changes.push(...(old ? changed(old, node) : [added(node)]));
  }

  // 消えた。親ごと消えたものは親の 1 件にまとめる。
  // 画面は親を消してから子を消すため、子だけが後の差分で届くことがある。
  // 親がもう無い（前の差分で消えた）項目も記録しない
  const removed = [...prev.values()].filter((node) => !next.has(node.id));
  for (const node of removed) {
    if (node.parentId && !next.has(node.parentId)) {
      continue;
    }
    changes.push(deleted(node, removed));
  }

  return changes;
}

function nodesOf(doc: Y.Doc): Map<string, FolderNode> {
  const nodes = new Map<string, FolderNode>();
  for (const key of doc.share.keys()) {
    const node = toNode(key, doc.getMap(key));
    if (node) {
      nodes.set(key, node);
    }
  }
  return nodes;
}

function toNode(id: string, map: Y.Map<unknown>): FolderNode | null {
  if (map.get(DELETED) === true) {
    return null;
  }

  const type = map.get('type');
  const data = map.get('data');
  if (typeof type !== 'string' || typeof data !== 'string') {
    return null;
  }

  const parentId = map.get('parentId');
  const index = map.get('index');
  return {
    id,
    type,
    data,
    parentId: typeof parentId === 'string' ? parentId : null,
    index: typeof index === 'string' ? index : '',
  };
}

function added(node: FolderNode): FolderChange {
  const kind =
    node.type === FOLDER_TYPE ? FolderChangeKind.Create : FolderChangeKind.ItemAdd;
  return { kind, node };
}

/**
 * 名前・親の違いだけを見る。index だけの違い（並べ替え）は空。
 * 同じ差分で名前も親も変わったら、両方返す
 */
function changed(old: FolderNode, node: FolderNode): FolderChange[] {
  const isFolder = node.type === FOLDER_TYPE;
  const changes: FolderChange[] = [];

  if (isFolder && old.data !== node.data) {
    changes.push({ kind: FolderChangeKind.Rename, node, before: old });
  }

  if (old.parentId !== node.parentId) {
    const kind = isFolder ? FolderChangeKind.Move : FolderChangeKind.ItemMove;
    changes.push({ kind, node, before: old });
  }

  return changes;
}

function deleted(node: FolderNode, removed: FolderNode[]): FolderChange {
  if (node.type !== FOLDER_TYPE) {
    return { kind: FolderChangeKind.ItemRemove, node };
  }
  return {
    kind: FolderChangeKind.Delete,
    node,
    items: countDescendants(node.id, removed),
  };
}

/** 一緒に消えた子孫の数（例: 設計 > 下書き > ページ なら 2） */
function countDescendants(id: string, removed: FolderNode[]): number {
  const children = removed.filter((node) => node.parentId === id);
  return children.reduce(
    (sum, child) => sum + 1 + countDescendants(child.id, removed),
    0,
  );
}

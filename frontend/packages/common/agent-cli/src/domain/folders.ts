import { generateFractionalIndexingKeyBetween } from '@blocksuite/affine/shared/utils';
import { nanoid } from '@blocksuite/affine/store';
import * as Y from 'yjs';

import { CliError } from '../errors';
import type { Session } from './session';
import type { Space } from './space';

/** 削除の印（frontend の YjsTableAdapter と同じ） */
const DELETED = '$$DELETED';
/** レコードの項目。消すときは id 以外を消す */
const FIELDS = ['type', 'data', 'parentId', 'index'];

export enum NodeType {
  Folder = 'folder',
  Doc = 'doc',
}

/** `folders` の表示用。ページは見えるものだけ */
export interface FolderOutline {
  id: string;
  name: string;
  folders: FolderOutline[];
  pages: Array<{ docId: string; title: string }>;
}

export interface FolderNode {
  id: string;
  /** `folder` / `doc`。`tag` / `collection` もありうる（CLI は読み飛ばす） */
  type: string;
  /** フォルダなら名前、ページなら docId */
  data: string;
  parentId: string | null;
  index: string;
}

/**
 * サイドバーのフォルダ（設計書 §6.7）。ワークスペースに1つの Yjs 文書。
 *
 * ```
 * db$<ws>$folders (Y.Doc)
 * ├ <id> (Y.Map) { id, type: 'folder', data: '設計', parentId: null, index }
 * └ <id> (Y.Map) { id, type: 'doc', data: <docId>, parentId: <フォルダ>, index }
 * ```
 * 消したレコードは `$$DELETED: true` だけが残る。
 */
export class FolderTree {
  private readonly loaded: Uint8Array;

  private constructor(private readonly doc: Y.Doc) {
    this.loaded = Y.encodeStateVector(doc);
  }

  static docId(space: Space): string {
    return `db$${space.id}$folders`;
  }

  /** サーバーから最新を取って開く */
  static async open(session: Session, space: Space): Promise<FolderTree> {
    const sync = await session.syncFor(space.id);
    const state = await sync.loadDoc(space.id, FolderTree.docId(space));
    if (!state) {
      throw new CliError(`フォルダを読めない: ${space.label}`);
    }
    return FolderTree.fromState(state);
  }

  static fromState(state: Uint8Array): FolderTree {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    return new FolderTree(doc);
  }

  /** 消していないレコード全部 */
  nodes(): FolderNode[] {
    const out: FolderNode[] = [];
    for (const key of this.doc.share.keys()) {
      const node = toNode(this.doc.getMap(key));
      if (node) {
        out.push(node);
      }
    }
    return out;
  }

  /** 子を上から順に（index の昇順。ブラウザと同じ比べ方） */
  children(parentId: string | null): FolderNode[] {
    return this.nodes()
      .filter(n => n.parentId === parentId)
      .sort((a, b) => (a.index > b.index ? 1 : -1));
  }

  /** フォルダの直下のページ（docId）を上から順に */
  docsIn(folderId: string): string[] {
    return this.children(folderId)
      .filter(n => n.type === NodeType.Doc)
      .map(n => n.data);
  }

  /** そのページが入っているフォルダ */
  foldersOf(docId: string): FolderNode[] {
    const folders = this.folders();
    return this.nodes()
      .filter(n => n.type === NodeType.Doc && n.data === docId)
      .flatMap(n => folders.filter(f => f.id === n.parentId));
  }

  folders(): FolderNode[] {
    return this.nodes().filter(n => n.type === NodeType.Folder);
  }

  /** 例: `設計 / 下書き` */
  path(folderId: string): string {
    const byId = new Map(this.folders().map(f => [f.id, f]));
    const names: string[] = [];
    const seen = new Set<string>();
    let current = byId.get(folderId);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      names.unshift(current.data);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return names.join(' / ');
  }

  /**
   * フォルダのツリー。`visible` は読めるページ（docId → 題）。
   *
   * ⚠️ `visible` に無いページ（権限が無い・ゴミ箱）は出さない。ブラウザも出さない
   */
  outline(
    visible: Map<string, string>,
    parentId: string | null = null
  ): FolderOutline[] {
    return this.children(parentId)
      .filter(n => n.type === NodeType.Folder)
      .map(f => ({
        id: f.id,
        name: f.data,
        folders: this.outline(visible, f.id),
        pages: this.docsIn(f.id)
          .filter(docId => visible.has(docId))
          .map(docId => ({ docId, title: visible.get(docId) || '（無題）' })),
      }));
  }

  /** 名前か ID でフォルダを引く。無ければ例外 */
  resolve(ref: string): FolderNode {
    const found = this.find(ref);
    if (found) {
      return found;
    }
    throw new CliError(
      `フォルダが無い: ${ref}`,
      'ofuro folders で名前を確かめる'
    );
  }

  /** 名前か ID でフォルダを引く。無ければ undefined。同じ名前が2つ以上なら ID を求める */
  find(ref: string): FolderNode | undefined {
    const key = ref.trim();
    const folders = this.folders();
    const byId = folders.find(f => f.id === key);
    if (byId) {
      return byId;
    }

    const byName = folders.filter(f => f.data === key);
    if (byName.length > 1) {
      throw new CliError(
        `同じ名前のフォルダが複数ある: ${key}`,
        `ID で指定する（${byName.map(f => `${f.id}: ${this.path(f.id)}`).join(' / ')}）`
      );
    }
    return byName[0];
  }

  /** フォルダを親の末尾に作る。`parentId` が null なら最上位 */
  createFolder(name: string, parentId: string | null): string {
    if (!name.trim()) {
      throw new CliError('フォルダの名前が空');
    }
    return this.insert(NodeType.Folder, name.trim(), parentId);
  }

  /** ページをフォルダの末尾に入れる。既にあれば何もせず false */
  addDoc(folderId: string, docId: string): boolean {
    const exists = this.children(folderId).some(
      n => n.type === NodeType.Doc && n.data === docId
    );
    if (exists) {
      return false;
    }
    this.insert(NodeType.Doc, docId, folderId);
    return true;
  }

  /** フォルダからページを外す（ページは消えない）。外したリンクの数を返す */
  removeDoc(folderId: string, docId: string): number {
    const links = this.children(folderId).filter(
      n => n.type === NodeType.Doc && n.data === docId
    );
    this.doc.transact(() => {
      for (const link of links) {
        const map = this.doc.getMap(link.id);
        FIELDS.forEach(field => map.delete(field));
        map.set(DELETED, true);
      }
    });
    return links.length;
  }

  /** 開いてから変えた分の差分。無ければ null */
  takeUpdate(): Uint8Array | null {
    const update = Y.encodeStateAsUpdate(this.doc, this.loaded);
    const empty = Y.encodeStateAsUpdate(new Y.Doc());
    return isSame(update, empty) ? null : update;
  }

  /** 変えた分を送る。変えていなければ何もしない */
  async save(session: Session, space: Space): Promise<void> {
    const update = this.takeUpdate();
    if (!update) {
      return;
    }
    const sync = await session.syncFor(space.id);
    await sync.pushUpdate(
      space.id,
      FolderTree.docId(space),
      update,
      'フォルダ'
    );
  }

  private insert(
    type: NodeType,
    data: string,
    parentId: string | null
  ): string {
    const last = this.children(parentId).at(-1);
    const index = generateFractionalIndexingKeyBetween(
      last?.index ?? null,
      null
    );
    const id = nanoid();
    this.doc.transact(() => {
      const map = this.doc.getMap(id);
      map.set('id', id);
      map.set('type', type);
      map.set('data', data);
      map.set('parentId', parentId);
      map.set('index', index);
    });
    return id;
  }
}

function toNode(map: Y.Map<unknown>): FolderNode | null {
  if (map.size === 0 || map.get(DELETED) === true) {
    return null;
  }
  const id = map.get('id');
  const type = map.get('type');
  const data = map.get('data');
  const index = map.get('index');
  if (
    typeof id !== 'string' ||
    typeof type !== 'string' ||
    typeof data !== 'string'
  ) {
    return null;
  }
  const parentId = map.get('parentId');
  return {
    id,
    type,
    data,
    parentId: typeof parentId === 'string' ? parentId : null,
    index: typeof index === 'string' ? index : '',
  };
}

function isSame(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

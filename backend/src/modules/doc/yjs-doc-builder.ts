/**
 * マークダウン文字列から AFFiNE ブロック構造の Yjs バイナリを生成するユーティリティ
 */
import * as Y from 'yjs';
import { randomUUID } from 'crypto';

type BlockFlavour = 'affine:page' | 'affine:note' | 'affine:paragraph' | 'affine:divider';
type ParagraphType = 'text' | 'h1' | 'h2' | 'h3';

interface BlockSpec {
  id: string;
  flavour: BlockFlavour;
  children: string[];
  props: Record<string, unknown>;
}

function makeId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

function parseMarkdownLine(line: string): { flavour: BlockFlavour; type?: ParagraphType; text: string } {
  if (line.startsWith('### ')) return { flavour: 'affine:paragraph', type: 'h3', text: line.slice(4) };
  if (line.startsWith('## '))  return { flavour: 'affine:paragraph', type: 'h2', text: line.slice(3) };
  if (line.startsWith('# '))   return { flavour: 'affine:paragraph', type: 'h1', text: line.slice(2) };
  if (line === '---')           return { flavour: 'affine:divider', text: '' };
  return { flavour: 'affine:paragraph', type: 'text', text: line };
}

function buildBlock(spec: BlockSpec): Y.Map<unknown> {
  const block = new Y.Map<unknown>();
  block.set('sys:id', spec.id);
  block.set('sys:flavour', spec.flavour);
  const children = new Y.Array<string>();
  if (spec.children.length > 0) children.push(spec.children);
  block.set('sys:children', children);
  for (const [key, value] of Object.entries(spec.props)) {
    block.set(key, value);
  }
  return block;
}

export function markdownToYjsUpdate(title: string, markdown: string): Uint8Array {
  const doc = new Y.Doc();
  const blocksMap = doc.getMap<Y.Map<unknown>>('blocks');

  const pageId = makeId();
  const noteId = makeId();

  // 各行をブロックに変換
  const lines = markdown.split('\n');
  const contentBlocks: BlockSpec[] = [];

  for (const line of lines) {
    const { flavour, type, text } = parseMarkdownLine(line);
    const blockId = makeId();
    const props: Record<string, unknown> = {};
    if (flavour === 'affine:paragraph') {
      props['prop:text'] = new Y.Text(text);
      props['prop:type'] = type ?? 'text';
    }
    contentBlocks.push({ id: blockId, flavour, children: [], props });
  }

  // Note ブロック（コンテンツコンテナ）
  const noteBlock = buildBlock({
    id: noteId,
    flavour: 'affine:note',
    children: contentBlocks.map(b => b.id),
    props: {
      'prop:xywh': '[0,0,800,95]',
      'prop:background': '--affine-background-secondary-color',
      'prop:index': 'a0',
      'prop:hidden': false,
      'prop:displayMode': 'both',
    },
  });
  blocksMap.set(noteId, noteBlock);

  // コンテンツブロックを登録
  for (const spec of contentBlocks) {
    blocksMap.set(spec.id, buildBlock(spec));
  }

  // Page ブロック（ルート）
  const pageBlock = buildBlock({
    id: pageId,
    flavour: 'affine:page',
    children: [noteId],
    props: {
      'prop:title': new Y.Text(title),
    },
  });
  blocksMap.set(pageId, pageBlock);

  return Y.encodeStateAsUpdate(doc);
}

/**
 * Yjs バイナリ（doc_snapshots.blob + 任意の差分アップデート）を Markdown に逆変換する。
 * `markdownToYjsUpdate` の逆方向。外部RAG/検索ツール が本文を取り込むための内部読み取り用（Issue #30）。
 *
 * AFFiNE ブロックツリーを `sys:children` 順に辿ってドキュメント順を保持する
 * （Y.Map.entries() の列挙順には依存しない）。
 *
 * @param updates 適用する Yjs バイナリ群（snapshot を先頭、doc_updates を時系列順に渡す）
 * @returns title と markdown。ブロックが無ければ markdown は空文字。
 */
export function yjsUpdateToMarkdown(updates: Uint8Array[]): { title: string; markdown: string } {
  const doc = new Y.Doc();
  for (const u of updates) {
    if (u && u.length > 0) {
      try { Y.applyUpdate(doc, u); } catch { /* 破損分は無視 */ }
    }
  }

  const blocks = doc.getMap<Y.Map<unknown>>('blocks');

  // page ブロックを探す
  let pageBlock: Y.Map<unknown> | undefined;
  for (const [, value] of blocks.entries()) {
    if (value instanceof Y.Map && value.get('sys:flavour') === 'affine:page') {
      pageBlock = value;
      break;
    }
  }

  if (!pageBlock) {
    // meta からタイトルだけでも拾えれば返す
    const metaTitle = doc.getMap('meta')?.get('title');
    return { title: typeof metaTitle === 'string' ? metaTitle : '', markdown: '' };
  }

  const titleText = pageBlock.get('prop:title');
  const title = titleText instanceof Y.Text ? titleText.toString() : '';

  const lines: string[] = [];
  const childrenOf = (block: Y.Map<unknown>): string[] => {
    const children = block.get('sys:children');
    return children instanceof Y.Array ? (children.toArray() as string[]) : [];
  };

  // page の子（通常は note）を順に辿る
  for (const childId of childrenOf(pageBlock)) {
    const child = blocks.get(childId);
    if (child instanceof Y.Map) {
      renderBlockChildren(blocks, child, lines);
    }
  }

  return { title, markdown: lines.join('\n') };
}

/**
 * コンテナブロック（note 等）の子ブロックを順に Markdown 行へ変換する。
 * affine:list の番号付きリストは兄弟内で連番を振る。
 */
function renderBlockChildren(
  blocks: Y.Map<Y.Map<unknown>>,
  container: Y.Map<unknown>,
  lines: string[],
): void {
  const childIds = (() => {
    const c = container.get('sys:children');
    return c instanceof Y.Array ? (c.toArray() as string[]) : [];
  })();

  let numberedCounter = 0;
  for (const id of childIds) {
    const block = blocks.get(id);
    if (!(block instanceof Y.Map)) continue;
    const flavour = block.get('sys:flavour') as string | undefined;

    if (flavour === 'affine:list' && block.get('prop:type') === 'numbered') {
      numberedCounter += 1;
    } else {
      numberedCounter = 0;
    }

    lines.push(renderBlock(block, numberedCounter));

    // ネストした子（リストのインデント等）は1階層分インデントして再帰
    const nested = block.get('sys:children');
    if (nested instanceof Y.Array && nested.length > 0) {
      const nestedLines: string[] = [];
      renderBlockChildren(blocks, block, nestedLines);
      for (const nl of nestedLines) {
        lines.push(nl ? '  ' + nl : nl);
      }
    }
  }
}

function blockText(block: Y.Map<unknown>): string {
  const t = block.get('prop:text');
  return t instanceof Y.Text ? t.toString() : '';
}

/**
 * 単一ブロックを1行（コードブロックは複数行）の Markdown 文字列へ変換する。
 */
function renderBlock(block: Y.Map<unknown>, numberedCounter: number): string {
  const flavour = block.get('sys:flavour') as string | undefined;
  const type = block.get('prop:type') as string | undefined;
  const text = blockText(block);

  switch (flavour) {
    case 'affine:paragraph':
      if (type === 'h1') return `# ${text}`;
      if (type === 'h2') return `## ${text}`;
      if (type === 'h3') return `### ${text}`;
      if (type === 'quote') return `> ${text}`;
      return text;
    case 'affine:list':
      if (type === 'numbered') return `${numberedCounter || 1}. ${text}`;
      if (type === 'todo') return `- [${block.get('prop:checked') ? 'x' : ' '}] ${text}`;
      return `- ${text}`;
    case 'affine:code': {
      const lang = block.get('prop:language');
      const fenceLang = typeof lang === 'string' && lang && lang !== 'Plain Text' ? lang : '';
      return `\`\`\`${fenceLang}\n${text}\n\`\`\``;
    }
    case 'affine:divider':
      return '---';
    default:
      // 未知のブロックでもテキストがあれば落とさない
      return text;
  }
}

/**
 * ワークスペース root doc の meta.pages に docId を追加（またはタイトルを更新）する。
 * root doc が存在しない場合は新規作成する。
 * @returns 更新後の Yjs バイナリ
 */
export function upsertWorkspaceRootDoc(
  existingBlob: Buffer | null,
  docId: string,
  title: string,
): Uint8Array {
  const rootDoc = new Y.Doc();

  // 既存スナップショットがあれば適用
  if (existingBlob && existingBlob.length > 0) {
    try {
      Y.applyUpdate(rootDoc, new Uint8Array(existingBlob));
    } catch {
      // 破損していれば無視して新規作成
    }
  }

  const metaMap = rootDoc.getMap<unknown>('meta');

  // pages 配列がなければ初期化
  if (!metaMap.has('pages')) {
    metaMap.set('pages', new Y.Array());
  }

  const pages = metaMap.get('pages') as Y.Array<Y.Map<unknown>>;

  // 既存エントリを探す
  let found = false;
  for (let i = 0; i < pages.length; i++) {
    const entry = pages.get(i);
    if (entry instanceof Y.Map && entry.get('id') === docId) {
      rootDoc.transact(() => {
        entry.set('title', title);
        entry.set('updatedDate', Date.now());
      });
      found = true;
      break;
    }
  }

  if (!found) {
    const entry = new Y.Map<unknown>();
    entry.set('id', docId);
    entry.set('title', title);
    entry.set('tags', new Y.Array());
    entry.set('createDate', Date.now());
    entry.set('updatedDate', Date.now());
    rootDoc.transact(() => {
      pages.push([entry]);
    });
  }

  return Y.encodeStateAsUpdate(rootDoc);
}

// docId のプレフィックスからフォルダ名を決定するマッピング
const DOC_PREFIX_TO_FOLDER: Record<string, string> = {
  'summary-':   'summary',
  'decisions-': 'decisions',
  'reasoning-': 'reasoning',
  'sources-':   'sources',
};

function folderNameForDocId(docId: string): string | null {
  for (const [prefix, folder] of Object.entries(DOC_PREFIX_TO_FOLDER)) {
    if (docId.startsWith(prefix)) return folder;
  }
  return null;
}

function makeNodeId(): string {
  // AFFiNE の nanoid 形式（21文字）に近い英数字IDを生成
  return randomUUID().replace(/-/g, '').slice(0, 21);
}

/**
 * db$<workspaceId>$folders Yjs ドキュメントを更新して、
 * docId を適切なフォルダ配下に配置する。
 * フォルダが存在しない場合は自動作成する。
 */
export function upsertFoldersDoc(
  existingBlob: Buffer | null,
  existingUpdates: Buffer[],
  docId: string,
): Uint8Array {
  const folderName = folderNameForDocId(docId);
  if (!folderName) {
    // フォルダ対象外 → 既存状態をそのまま返す
    if (!existingBlob && existingUpdates.length === 0) return new Uint8Array(0);
    const doc = new Y.Doc();
    if (existingBlob) Y.applyUpdate(doc, new Uint8Array(existingBlob));
    for (const u of existingUpdates) Y.applyUpdate(doc, new Uint8Array(u));
    return Y.encodeStateAsUpdate(doc);
  }

  const doc = new Y.Doc();
  if (existingBlob) {
    try { Y.applyUpdate(doc, new Uint8Array(existingBlob)); } catch { /* ignore */ }
  }
  for (const u of existingUpdates) {
    try { Y.applyUpdate(doc, new Uint8Array(u)); } catch { /* ignore */ }
  }

  // 既存フォルダエントリを走査
  let folderId: string | null = null;
  let docLinkExists = false;

  for (const [nodeId] of doc.share.entries()) {
    const node = doc.getMap<unknown>(nodeId);
    const type = node.get('type');
    const data = node.get('data');
    const id   = node.get('id');

    if (type === 'folder' && data === folderName) {
      folderId = id as string;
    }
    if (type === 'doc' && data === docId) {
      docLinkExists = true;
    }
  }

  // フォルダがなければ作成
  if (!folderId) {
    folderId = makeNodeId();
    const folderNode = doc.getMap<unknown>(folderId);
    doc.transact(() => {
      folderNode.set('id', folderId);
      folderNode.set('type', 'folder');
      folderNode.set('data', folderName);
      folderNode.set('parentId', null);
      folderNode.set('index', 'a0');
    });
  }

  // ドキュメントリンクがなければ作成
  if (!docLinkExists) {
    const linkId = makeNodeId();
    const linkNode = doc.getMap<unknown>(linkId);
    doc.transact(() => {
      linkNode.set('id', linkId);
      linkNode.set('type', 'doc');
      linkNode.set('data', docId);
      linkNode.set('parentId', folderId);
      linkNode.set('index', 'a0');
    });
  }

  return Y.encodeStateAsUpdate(doc);
}

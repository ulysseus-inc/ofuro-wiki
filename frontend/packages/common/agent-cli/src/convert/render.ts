import type { BlockModel, Store } from '@blocksuite/affine/store';

import type { MarkdownCodec } from './markdown';

/** AI が作成・更新・削除できるブロック（設計書 §1.2） */
export const EDITABLE_FLAVOURS = new Set([
  'affine:paragraph',
  'affine:list',
  'affine:code',
  'affine:divider',
  'affine:table',
]);

export const IMAGE_FLAVOUR = 'affine:image';

/**
 * 置ける（追加・削除・移動できる）ブロック。編集可能な種類に画像を足したもの（#278）。
 * 画像は本文を持たないため replace はできない（差し替えは delete ＋ image）
 */
export const PLACEABLE_FLAVOURS = new Set([
  ...EDITABLE_FLAVOURS,
  IMAGE_FLAVOUR,
]);

export const COLUMN_CELL_FLAVOUR = 'affine:column-cell';

/**
 * 構造だけが編集不可で、中身は編集できるブロック（#272。マルチカラム）。
 * 自分は消す・動かすことができないが、子は外と同じく編集できる
 */
export const STRUCTURE_FLAVOURS = new Set([
  'affine:columns',
  COLUMN_CELL_FLAVOUR,
]);

/** 子を持てる編集可能ブロック。insert の parent に指定できる */
export const CONTAINER_FLAVOURS = new Set([
  'affine:note',
  'affine:paragraph',
  'affine:list',
]);

export const PAGE_FLAVOUR = 'affine:page';
export const NOTE_FLAVOUR = 'affine:note';
const SURFACE_FLAVOUR = 'affine:surface';
const DATABASE_FLAVOUR = 'affine:database';
const FLAVOUR_PREFIX = 'affine:';

export enum Access {
  Editable = 'editable',
  ReadOnly = 'read-only',
  Locked = 'locked',
}

export interface RenderedBlock {
  id: string;
  flavour: string;
  parentId: string;
  depth: number;
  access: Access;
  /** `{#id}` と字下げを除いた表現。編集時の `expect` はこれと比べる */
  content: string;
}

export interface RenderedPage {
  docId: string;
  title: string;
  /** 付いているタグの名前（#276）。read のときだけ入れる */
  tags?: string[];
  blocks: RenderedBlock[];
}

/**
 * ページ全体をブロック表現にする（設計書 §5.2）。
 *
 * note が複数あるとき（エッジレスで分かれたページ）だけ note の行を出す。
 * 1つなら note は見せず、その子を深さ 0 に置く。
 */
export async function renderPage(
  docId: string,
  store: Store,
  codec: MarkdownCodec
): Promise<RenderedPage> {
  const page = store.root;
  if (!page) {
    throw new Error('ページのルートが無い');
  }

  const notes = page.children.filter(c => c.flavour === NOTE_FLAVOUR);
  const showNotes = notes.length > 1;
  const blocks: RenderedBlock[] = [];

  for (const note of notes) {
    if (showNotes) {
      blocks.push({
        id: note.id,
        flavour: note.flavour,
        parentId: page.id,
        depth: 0,
        access: Access.Editable,
        content: '[note]',
      });
    }
    await renderChildren(note, 0, Access.Editable, codec, blocks);
  }

  return { docId, title: pageTitle(store), blocks };
}

export function pageTitle(store: Store): string {
  const title = (store.root as { props?: { title?: unknown } } | null)?.props
    ?.title;
  return title ? String(title) : '';
}

async function renderChildren(
  parent: BlockModel,
  depth: number,
  inherited: Access,
  codec: MarkdownCodec,
  out: RenderedBlock[]
): Promise<void> {
  for (const child of parent.children) {
    if (child.flavour === SURFACE_FLAVOUR) {
      continue;
    }

    // 編集不可ブロックの中身は、編集可能な種類でも触らせない（設計書 §6.3）。
    // ただしマルチカラムは構造だけが編集不可で、中身には編集可能を引き継ぐ（§6.10）
    const access =
      inherited === Access.Editable ? accessOf(child.flavour) : Access.Locked;
    const forChildren =
      inherited === Access.Editable && STRUCTURE_FLAVOURS.has(child.flavour)
        ? Access.Editable
        : access;
    out.push({
      id: child.id,
      flavour: child.flavour,
      parentId: parent.id,
      depth,
      access,
      content: await contentOf(child, access, codec),
    });
    await renderChildren(child, depth + 1, forChildren, codec, out);
  }
}

/**
 * 編集してよいブロックか。自分も、note までの祖先もすべて編集可能な種類であること。
 *
 * 例: マルチカラムの中の段落は、段落でも編集不可（設計書 §1.2「保持のみ」）
 */
export function isEditable(model: BlockModel): boolean {
  if (model.flavour === NOTE_FLAVOUR) {
    return true;
  }
  if (!PLACEABLE_FLAVOURS.has(model.flavour)) {
    return false;
  }
  return insideEditable(model);
}

/**
 * 子を入れられる場所か（insert の parent・move の行き先）。
 * note・編集可能な段落等に加え、マルチカラムのセル（§6.10）
 */
export function canHoldChildren(model: BlockModel): boolean {
  if (model.flavour === COLUMN_CELL_FLAVOUR) {
    return insideEditable(model);
  }
  return CONTAINER_FLAVOURS.has(model.flavour) && isEditable(model);
}

/** note までの祖先が、編集可能な種類かマルチカラムの構造だけか */
function insideEditable(model: BlockModel): boolean {
  let current = model.parent;
  while (current && current.flavour !== NOTE_FLAVOUR) {
    const ok =
      PLACEABLE_FLAVOURS.has(current.flavour) ||
      STRUCTURE_FLAVOURS.has(current.flavour);
    if (!ok) {
      return false;
    }
    current = current.parent;
  }
  return current !== null;
}

/** 子孫に編集不可ブロックを含むか。含むなら丸ごと消す・動かすのは拒む */
export function hasLockedDescendant(model: BlockModel): boolean {
  return model.children.some(
    child =>
      !PLACEABLE_FLAVOURS.has(child.flavour) || hasLockedDescendant(child)
  );
}

function accessOf(flavour: string): Access {
  if (PLACEABLE_FLAVOURS.has(flavour)) {
    return Access.Editable;
  }
  if (flavour === DATABASE_FLAVOUR) {
    return Access.ReadOnly;
  }
  return Access.Locked;
}

async function contentOf(
  model: BlockModel,
  access: Access,
  codec: MarkdownCodec
): Promise<string> {
  if (model.flavour === IMAGE_FLAVOUR && access === Access.Editable) {
    return imageLabel(model);
  }
  if (EDITABLE_FLAVOURS.has(model.flavour)) {
    return codec.blockToMarkdown(model);
  }
  if (model.flavour === DATABASE_FLAVOUR) {
    return databaseSummary(model);
  }

  const label = `[${shortName(model.flavour)} 編集不可]`;
  const summary = summaryOf(model);
  if (access === Access.Locked && !summary) {
    return label;
  }
  return `${label} ${summary}`.trim();
}

/**
 * 画像ブロックの読取表現。`edit` の `expect` もこれと比べる（#278）。
 * 例: `[image] 構成図`（中身は ofuro image get で取り出す）
 */
export function imageLabel(model: BlockModel): string {
  const caption = (model.props as { caption?: unknown }).caption;
  return `[image] ${typeof caption === 'string' ? caption : ''}`.trim();
}

/** 例: `[database 読み取り専用] 案件一覧（3 列 × 12 行）` */
function databaseSummary(model: BlockModel): string {
  const props = model.props as {
    title?: unknown;
    columns?: unknown[];
  };
  const columns = props.columns?.length ?? 0;
  const rows = model.children.length;
  const title = props.title ? String(props.title) : '';
  return `[database 読み取り専用] ${title}（${columns} 列 × ${rows} 行）`;
}

/** 種類ごとに、人が見て分かる1行（キャプション・名前・URL 等） */
function summaryOf(model: BlockModel): string {
  const props = model.props as Record<string, unknown>;
  const candidates = ['caption', 'name', 'url', 'latex', 'title'];
  for (const key of candidates) {
    const value = props[key];
    if (value === undefined || value === null) {
      continue;
    }
    const text = String(value).trim();
    if (text) {
      return text;
    }
  }
  return '';
}

/** 例: `affine:embed-github` → `embed-github` */
function shortName(flavour: string): string {
  return flavour.startsWith(FLAVOUR_PREFIX)
    ? flavour.slice(FLAVOUR_PREFIX.length)
    : flavour;
}

/**
 * 表示用のテキスト。
 *
 * ```
 * ---
 * docId: abc
 * title: 設計方針
 * ---
 * {#b1} # 設計方針
 * {#b3} - [ ] レビュー
 * {#b4}   - 子項目
 * ```
 * 2行目以降（コード・表）は、ID の幅だけ字下げして続ける。
 */
export function formatPage(page: RenderedPage, url: string): string {
  const header = [
    '---',
    `docId: ${page.docId}`,
    `title: ${page.title}`,
    ...(page.tags ? [`tags: ${page.tags.join(', ')}`] : []),
    `url: ${url}`,
    '---',
  ];
  const lines = page.blocks.flatMap(formatBlock);
  return [...header, ...lines].join('\n');
}

function formatBlock(block: RenderedBlock): string[] {
  const indent = '  '.repeat(block.depth);
  const prefix = `{#${block.id}} `;
  const continuation = ' '.repeat(prefix.length) + indent;
  const [first, ...rest] = block.content.split('\n');
  return [
    `${prefix}${indent}${first}`,
    ...rest.map(line => `${continuation}${line}`),
  ];
}

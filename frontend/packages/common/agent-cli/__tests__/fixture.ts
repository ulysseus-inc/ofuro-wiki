import { type DeltaInsert, Text } from '@blocksuite/affine/store';

import { loadDoc } from '../src/convert/blocksuite';
import { MarkdownCodec } from '../src/convert/markdown';
import type { Page } from '../src/domain/page';

export const WORKSPACE_URL = 'https://wiki.example.com/workspace/ws1';

let seq = 0;

/**
 * 編集可能・不可のブロックを一通り含むページ。
 *
 * ```
 * page
 * ├ surface
 * └ note
 *   ├ p1      段落「Hello world」（world に文字色）
 *   ├ l1      ToDo「todo」
 *   │ └ l2    箇条書き「child」
 *   ├ ref     段落「see [他ページ] now」
 *   ├ t1      表 2×2
 *   ├ db      データベース（行 1）
 *   ├ cols    マルチカラム
 *   │ └ cell
 *   │   └ inCol 段落「inside」
 *   ├ img     画像
 *   └ p2      段落「tail」
 * ```
 */
export function buildFixture(): { page: Page; ids: Record<string, string> } {
  const docId = `fixture-${++seq}`;
  const doc = loadDoc(docId);
  const { store } = doc;
  const ids: Record<string, string> = {};

  const root = store.addBlock('affine:page', { title: new Text('題') });
  store.addBlock('affine:surface', {}, root);
  const note = store.addBlock('affine:note', {}, root);
  ids.note = note;

  ids.p1 = store.addBlock(
    'affine:paragraph',
    {
      text: new Text([
        { insert: 'Hello ' },
        { insert: 'world', attributes: { color: 'red' } },
      ] as DeltaInsert[]),
    },
    note
  );
  ids.l1 = store.addBlock(
    'affine:list',
    { type: 'todo', text: new Text('todo') },
    note
  );
  ids.l2 = store.addBlock(
    'affine:list',
    { type: 'bulleted', text: new Text('child') },
    ids.l1
  );
  ids.ref = store.addBlock(
    'affine:paragraph',
    {
      text: new Text([
        { insert: 'see ' },
        {
          insert: ' ',
          attributes: { reference: { type: 'LinkedPage', pageId: 'other' } },
        },
        { insert: ' now' },
      ] as DeltaInsert[]),
    },
    note
  );
  ids.t1 = store.addBlock(
    'affine:table',
    {
      rows: {
        r0: { rowId: 'r0', order: 'a0' },
        r1: { rowId: 'r1', order: 'a1' },
      },
      columns: {
        c0: { columnId: 'c0', order: 'a0' },
        c1: { columnId: 'c1', order: 'a1' },
      },
      cells: {
        'r0:c0': { text: new Text('h1') },
        'r0:c1': { text: new Text('h2') },
        'r1:c0': { text: new Text('a') },
        'r1:c1': { text: new Text('b') },
      },
    },
    note
  );
  ids.db = store.addBlock('affine:database', { title: new Text('DB') }, note);
  ids.dbRow = store.addBlock(
    'affine:paragraph',
    { text: new Text('row') },
    ids.db
  );
  ids.cols = store.addBlock('affine:columns', {}, note);
  ids.cell = store.addBlock('affine:column-cell', {}, ids.cols);
  ids.inCol = store.addBlock(
    'affine:paragraph',
    { text: new Text('inside') },
    ids.cell
  );
  ids.img = store.addBlock('affine:image', { caption: 'cap' }, note);
  ids.p2 = store.addBlock('affine:paragraph', { text: new Text('tail') }, note);

  // 骨組みを作った変更は「読み込んだ状態」として捨てる
  doc.takeUpdate();

  const titles = new Map([['other', '他ページ']]);
  const page = {
    docId,
    doc,
    store,
    codec: new MarkdownCodec(WORKSPACE_URL, titles),
    ledgerDoc: null,
  } as unknown as Page;
  return { page, ids };
}

/** ブロックの Yjs 上の中身。変わっていないことの確認に使う */
export function blockJson(page: Page, id: string): unknown {
  return page.store.doc.yBlocks.get(id)?.toJSON();
}

/** `except` 以外のブロックがすべて不変か */
export function snapshotOthers(
  page: Page,
  except: string[]
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, block] of page.store.doc.yBlocks.entries()) {
    if (except.includes(id)) {
      continue;
    }
    out.set(id, JSON.stringify(block.toJSON()));
  }
  return out;
}

/** Markdown から作ったページ（編集可能なブロックだけ）。`update` の試験用 */
export async function pageFromMarkdown(markdown: string): Promise<Page> {
  const doc = loadDoc(`md-${++seq}`);
  const { store } = doc;
  const codec = new MarkdownCodec(WORKSPACE_URL, new Map());

  const root = store.addBlock('affine:page', { title: new Text('題') });
  store.addBlock('affine:surface', {}, root);
  const note = store.addBlock('affine:note', {}, root);
  for (const [i, snapshot] of (await codec.parse(markdown)).entries()) {
    await codec.insert(store, snapshot, note, i);
  }
  doc.takeUpdate();

  return {
    docId: doc.store.id,
    doc,
    store,
    codec,
    ledgerDoc: null,
  } as unknown as Page;
}

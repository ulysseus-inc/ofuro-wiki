/**
 * #272: マルチカラムの中の編集（設計書 §6.10）。構造は触らず、中身だけを編集できる。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Text } from '@blocksuite/affine/store';

import { formatPage, renderPage } from '../src/convert/render';
import { Editor } from '../src/domain/editor';
import type { Page } from '../src/domain/page';
import { blockJson, buildFixture, WORKSPACE_URL } from './fixture';

/** フィクスチャのカラムに2つ目のセル（段落「right」）を足す */
function withTwoCells() {
  const { page, ids } = buildFixture();
  ids.cell2 = page.store.addBlock('affine:column-cell', {}, ids.cols);
  ids.right = page.store.addBlock(
    'affine:paragraph',
    { text: new Text('right') },
    ids.cell2
  );
  page.doc.takeUpdate();
  return { page, ids };
}

const children = (page: Page, id: string) =>
  page.store.getBlock(id)!.model.children.map(c => c.id);

const text = (page: Page, id: string) =>
  String(
    (page.store.getBlock(id)!.model.props as { text?: unknown }).text ?? ''
  );

describe('マルチカラムの中の編集（#272）', () => {
  it('⚠️ 中の段落を replace でき、カラム・セルの構造は変えない（G2）', async () => {
    const { page, ids } = withTwoCells();
    const cols = blockJson(page, ids.cols);
    const cell = blockJson(page, ids.cell);

    await new Editor(page).apply([
      {
        op: 'replace',
        block: ids.inCol,
        expect: 'inside',
        content: '**中身**',
      },
    ]);

    assert.equal(text(page, ids.inCol), '中身');
    assert.deepEqual(blockJson(page, ids.cols), cols);
    assert.deepEqual(blockJson(page, ids.cell), cell);
  });

  it('中のブロックの後ろ、またはセルを parent にして追加できる', async () => {
    const { page, ids } = withTwoCells();
    const result = await new Editor(page).apply([
      { op: 'insert', after: ids.inCol, content: '後ろ' },
      { op: 'insert', parent: ids.cell2, content: '* 末尾の項目' },
    ]);
    const [after, tail] = result.created;
    assert.deepEqual(children(page, ids.cell), [ids.inCol, after]);
    assert.deepEqual(children(page, ids.cell2), [ids.right, tail]);
    assert.deepEqual(children(page, ids.cols), [ids.cell, ids.cell2]);
  });

  it('⚠️ 別の列へ動かせる。最後のブロックを動かしたセルには空の段落を残す', async () => {
    const { page, ids } = withTwoCells();
    await new Editor(page).apply([
      { op: 'move', block: ids.inCol, parent: ids.cell2 },
    ]);

    assert.deepEqual(children(page, ids.cell2), [ids.right, ids.inCol]);
    const left = page.store.getBlock(ids.cell)!.model.children;
    assert.equal(left.length, 1, '空のセルにしない');
    assert.equal(left[0].flavour, 'affine:paragraph');
    assert.equal(text(page, left[0].id), '');
  });

  it('⚠️ 最後のブロックを消しても、空の段落を残す', async () => {
    const { page, ids } = withTwoCells();
    await new Editor(page).apply([
      { op: 'delete', block: ids.right, expect: 'right' },
    ]);
    const right = page.store.getBlock(ids.cell2)!.model.children;
    assert.equal(right.length, 1);
    assert.equal(right[0].flavour, 'affine:paragraph');
  });

  it('カラムの外とのあいだでも動かせる', async () => {
    const { page, ids } = withTwoCells();
    await new Editor(page).apply([
      { op: 'move', block: ids.p2, parent: ids.cell },
      { op: 'move', block: ids.right, after: ids.p1 },
    ]);
    assert.deepEqual(children(page, ids.cell), [ids.inCol, ids.p2]);
    assert.equal(
      page.store.getBlock(ids.note)!.model.children[1].id,
      ids.right
    );
  });

  it('read では構造の行だけ編集不可と出し、中身は普通に出す', async () => {
    const { page, ids } = withTwoCells();
    const out = formatPage(
      await renderPage(page.docId, page.store, page.codec),
      `${WORKSPACE_URL}/x`
    );
    assert.match(out, new RegExp(`\\{#${ids.cols}\\} \\[columns 編集不可\\]`));
    assert.match(
      out,
      new RegExp(`\\{#${ids.cell}\\}   \\[column-cell 編集不可\\]`)
    );
    assert.match(out, new RegExp(`\\{#${ids.inCol}\\}     inside$`, 'm'));
  });
});

/**
 * #279: 表の行・列の並びが、read の表示と編集の番号で食い違う。
 *
 * 順序キーは大文字・小文字の混ざった文字列（fractional indexing）。
 * ブラウザの表示（TableDataManager）と CLI の編集は文字コード順で並べるが、
 * 表の Markdown 変換は localeCompare（言語の規則）で並べていた。
 * 例: 'aZ' と 'aa' は、文字コード順では aZ が先、localeCompare では aa が先。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Text } from '@blocksuite/affine/store';

import { Editor } from '../src/domain/editor';
import { buildFixture } from './fixture';

/** 表の Markdown から、見出しと罫線を除いた行の1列目を取り出す */
function firstColumn(markdown: string): string[] {
  return markdown
    .split('\n')
    .slice(2)
    .map(line => line.split('|')[1].trim());
}

describe('表の並び順（#279）', () => {
  it('⚠️ read の行の並びは、ブラウザと同じ文字コード順', async () => {
    const { page, ids } = buildFixture();
    const id = page.store.addBlock(
      'affine:table',
      {
        rows: {
          h: { rowId: 'h', order: 'a0' },
          upper: { rowId: 'upper', order: 'aZ' },
          lower: { rowId: 'lower', order: 'aa' },
        },
        columns: { c: { columnId: 'c', order: 'a0' } },
        cells: {
          'h:c': { text: new Text('見出し') },
          'upper:c': { text: new Text('大文字キーの行') },
          'lower:c': { text: new Text('小文字キーの行') },
        },
      },
      ids.note
    );

    const md = await page.codec.blockToMarkdown(page.store.getBlock(id)!.model);
    assert.deepEqual(firstColumn(md), ['大文字キーの行', '小文字キーの行']);
  });

  it('⚠️ 途中に何度挿入しても、read の N 行目と table.set の row N が一致する', async () => {
    const { page, ids } = buildFixture();
    const editor = new Editor(page);

    // Issue の手順: 3行目に X、4行目に Y、さらに何度か途中へ挿入する
    const inserts: Array<[number, string]> = [
      [1, 'X'],
      [2, 'Y'],
      [1, 'P'],
      [3, 'Q'],
      [2, 'R'],
      [1, 'S'],
    ];
    for (const [at, label] of inserts) {
      await editor.apply([
        { op: 'table.insertRow', block: ids.t1, at, cells: [label, ''] },
      ]);
    }

    const md = await page.codec.blockToMarkdown(
      page.store.getBlock(ids.t1)!.model
    );
    const shown = ['h1', ...firstColumn(md)];

    // read で見えた位置をそのまま row に使い、expect が通ること
    for (const [row, label] of shown.entries()) {
      await editor.apply([
        {
          op: 'table.set',
          block: ids.t1,
          row,
          col: 0,
          expect: label,
          text: label,
        },
      ]);
    }
  });
});

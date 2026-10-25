/**
 * #275: Markdown からページ全体を差分更新する（設計書 §6.5）。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Text } from '@blocksuite/affine/store';

import { parseArgs } from '../src/commands/args';
import { update as updateCommand } from '../src/commands/pages';
import { Editor } from '../src/domain/editor';
import type { Session } from '../src/domain/session';
import type { Op } from '../src/domain/ops';
import { hasTitleHeading } from '../src/domain/page';
import { assertUpdatable, planUpdate, updateBase } from '../src/domain/update';
import { CliError } from '../src/errors';
import type { Page } from '../src/domain/page';
import { buildFixture, pageFromMarkdown, snapshotOthers } from './fixture';

const BASE = `# 見出し

段落A

段落B

* 親
  * 子1
  * 子2

| 項目 | 値 |
| - | - |
| A | 1 |
| B | 2 |

末尾
`;

/** ブロックの ID を本文で引く */
async function idOf(page: Page, markdown: string): Promise<string> {
  for (const [id] of page.store.doc.yBlocks.entries()) {
    const model = page.store.getBlock(id)?.model;
    if (model && (await page.codec.blockToMarkdown(model)) === markdown) {
      return id;
    }
  }
  throw new Error(`見つからない: ${markdown}`);
}

/** 計画して当て、もう一度計画すると空になる（＝ Markdown どおりになった）ことまで確かめる */
async function update(page: Page, markdown: string): Promise<Op[]> {
  const ops = await planUpdate(page, markdown);
  if (ops.length > 0) {
    await new Editor(page).apply(ops);
  }
  assert.deepEqual(await planUpdate(page, markdown), [], '当てた後に差が残る');
  return ops;
}

describe('planUpdate（#275）', () => {
  it('同じ Markdown なら何もしない', async () => {
    const page = await pageFromMarkdown(BASE);
    assert.deepEqual(await planUpdate(page, BASE), []);
  });

  it('⚠️ 変えた段落だけを replace し、他のブロックは ID も中身も変えない', async () => {
    const page = await pageFromMarkdown(BASE);
    const target = await idOf(page, '段落A');
    const others = snapshotOthers(page, [target]);

    const ops = await update(page, BASE.replace('段落A', '段落A（改）'));

    assert.deepEqual(ops, [
      { op: 'replace', block: target, expect: '段落A', content: '段落A（改）' },
    ]);
    assert.deepEqual(snapshotOthers(page, [target]), others);
  });

  it('入れ子の子だけを変えると、親は触らない', async () => {
    const page = await pageFromMarkdown(BASE);
    const child = await idOf(page, '* 子2');

    const ops = await update(page, BASE.replace('子2', '子2（改）'));

    assert.deepEqual(ops, [
      { op: 'replace', block: child, expect: '* 子2', content: '* 子2（改）' },
    ]);
  });

  it('表は変えたセルだけを table.set する（表の ID は残る）', async () => {
    const page = await pageFromMarkdown(BASE);
    const table = await idOf(page, (await tableMarkdown(page)) as string);

    const ops = await update(page, BASE.replace('| B | 2 |', '| B | 20 |'));

    assert.deepEqual(ops, [
      {
        op: 'table.set',
        block: table,
        row: 2,
        col: 1,
        expect: '2',
        text: '20',
      },
    ]);
  });

  it('表の行の追加・削除は insertRow / deleteRow', async () => {
    const page = await pageFromMarkdown(BASE);
    const table = await idOf(page, (await tableMarkdown(page)) as string);

    const ops = await update(
      page,
      BASE.replace('| A | 1 |\n', '').replace(
        '| B | 2 |',
        '| B | 2 |\n| C | 3 |'
      )
    );

    assert.deepEqual(ops, [
      { op: 'table.deleteRow', block: table, index: 1, expect: ['A', '1'] },
      { op: 'table.insertRow', block: table, at: 2, cells: ['C', '3'] },
    ]);
  });

  it('表の列数が変わったら、表を作り直す', async () => {
    const page = await pageFromMarkdown(BASE);
    const table = await idOf(page, (await tableMarkdown(page)) as string);
    const next = BASE.replace(
      '| 項目 | 値 |\n| - | - |\n| A | 1 |\n| B | 2 |',
      '| 項目 | 値 | 備考 |\n| - | - | - |\n| A | 1 | x |'
    );

    const ops = await update(page, next);

    assert.deepEqual(
      ops.map(o => o.op),
      ['delete', 'insert']
    );
    assert.ok(!page.store.getBlock(table), '古い表が残っている');
  });

  it('途中に足したブロックは、次に残るブロックの前に入る', async () => {
    const page = await pageFromMarkdown(BASE);
    const b = await idOf(page, '段落B');

    const ops = await update(
      page,
      BASE.replace('段落B', '新1\n\n新2\n\n段落B')
    );

    assert.deepEqual(ops, [
      { op: 'insert', before: b, content: '新1' },
      { op: 'insert', before: b, content: '新2' },
    ]);
  });

  it('末尾に足したブロックは、親の末尾に入る', async () => {
    const page = await pageFromMarkdown(BASE);
    const ops = await update(page, `${BASE}\n追加\n`);
    assert.equal(ops.length, 1);
    assert.equal(ops[0].op, 'insert');
    assert.ok('parent' in ops[0] && ops[0].parent);
  });

  it('消したブロックは delete（子ごと）', async () => {
    const page = await pageFromMarkdown(BASE);
    const parent = await idOf(page, '* 親');

    const ops = await update(
      page,
      BASE.replace('* 親\n  * 子1\n  * 子2\n', '')
    );

    assert.deepEqual(ops, [{ op: 'delete', block: parent, expect: '* 親' }]);
  });

  it('種類が変わったら、子ごと作り直す（並びは Markdown どおり）', async () => {
    const page = await pageFromMarkdown(BASE);
    const ops = await update(
      page,
      BASE.replace('段落A\n\n段落B', '1. 番号A\n\n段落B（改）')
    );
    assert.deepEqual(
      ops.map(o => o.op),
      ['delete', 'insert', 'replace']
    );
  });

  it('大きく書き換えても、当てた結果が Markdown と一致する', async () => {
    const page = await pageFromMarkdown(BASE);
    await update(
      page,
      `## 別の見出し

* 親
  * 子0
  * 子1
* 兄弟

\`\`\`ts
const x = 1;
\`\`\`

| 項目 | 値 |
| - | - |
| B | 2 |

---

末尾
`
    );
  });
});

describe('planUpdate の大きなページ・重複（#281 レビュー）', () => {
  const MANY = 2100;
  const lines = (prefix: string) =>
    Array.from({ length: MANY }, (_, i) => `${prefix}${i}`).join('\n\n');

  it('⚠️ 大きなページでも、1か所の変更は前後を除いて比べる', async () => {
    const page = await pageFromMarkdown(lines('段落'));
    const ops = await planUpdate(
      page,
      lines('段落').replace('段落1000\n', '段落1000（改）\n')
    );
    assert.deepEqual(
      ops.map(o => o.op),
      ['replace']
    );
  });

  it('⚠️ 比べる範囲が大きすぎるときは、メモリを使い切る前にエラーにする', async () => {
    const page = await pageFromMarkdown(lines('段落'));
    await assert.rejects(planUpdate(page, lines('別')), /多すぎる/);
  });

  it('同じ本文のブロックが並んでいても、Markdown どおりになる', async () => {
    const page = await pageFromMarkdown('同じ\n\nA\n\n同じ\n\n同じ\n\nB\n');
    await update(page, '同じ\n\nB\n\n同じ\n\nA（改）\n\n同じ\n');
    const empty = await pageFromMarkdown('A\n\nB\n');
    const note = empty.store.root!.children.find(
      c => c.flavour === 'affine:note'
    )!;
    empty.store.addBlock('affine:paragraph', {}, note.id, 0);
    empty.store.addBlock('affine:paragraph', {}, note.id, 2);
    await update(empty, 'A\n\nB（改）\n');
  });
});

describe('planUpdate の末尾（#281 レビュー）', () => {
  it('末尾で作り直しと追加が続いても、並びは Markdown どおり', async () => {
    const page = await pageFromMarkdown('残す\n\n段落1\n\n段落2\n');
    const ops = await update(
      page,
      '残す\n\n* 箇条1\n\n* 箇条2\n\n追加1\n\n追加2\n'
    );
    assert.deepEqual(
      ops.map(o => o.op),
      ['delete', 'insert', 'delete', 'insert', 'insert', 'insert']
    );
  });
});

describe('update コマンドの引数（#281 レビュー）', () => {
  it('⚠️ --dry-run と --base を同時に指定したら拒む（--base が黙って無視されるため）', async () => {
    const session = {
      resolveDoc: () => assert.fail('引数の検査より先にページを探した'),
    } as unknown as Session;
    const args = parseArgs(['doc', '--stdin', '--dry-run', '--base', 'abc']);
    await assert.rejects(updateCommand(session, args), /--dry-run と --base/);
  });
});

describe('assertUpdatable（#275）', () => {
  it('⚠️ 編集不可・読み取り専用のブロックを含むページは拒む', () => {
    const { page } = buildFixture();
    assert.throws(() => assertUpdatable(page), /編集できないブロック/);
  });

  it('note が2つ以上あるページは拒む', async () => {
    const page = await pageFromMarkdown('段落');
    page.store.addBlock('affine:note', {}, page.store.root!.id);
    assert.throws(() => assertUpdatable(page), CliError);
  });

  it('編集可能なブロックだけなら通す', async () => {
    const page = await pageFromMarkdown(BASE);
    assert.doesNotThrow(() => assertUpdatable(page));
  });
});

describe('updateBase（#275 の同時編集の検知）', () => {
  it('変えなければ同じ、本文か題が変われば違う', async () => {
    const page = await pageFromMarkdown(BASE);
    const v1 = await updateBase(page, BASE);
    assert.equal(await updateBase(page, BASE), v1);

    await new Editor(page).apply(
      await planUpdate(page, BASE.replace('末尾', '末尾2'))
    );
    const v2 = await updateBase(page, BASE);
    assert.notEqual(v2, v1);

    page.store.transact(() => {
      (page.store.root!.props as { title: Text }).title.insert('!', 0);
    });
    assert.notEqual(await updateBase(page, BASE), v2);
  });

  it('⚠️ dry-run の後に Markdown や --title を変えたら違う（承認していない内容を送らせない）', async () => {
    const page = await pageFromMarkdown(BASE);
    const base = await updateBase(page, BASE);
    assert.notEqual(await updateBase(page, `${BASE}\n追記\n`), base);
    assert.notEqual(await updateBase(page, BASE, '別の題'), base);
  });
});

async function tableMarkdown(page: Page): Promise<string | undefined> {
  for (const [id] of page.store.doc.yBlocks.entries()) {
    const model = page.store.getBlock(id)?.model;
    if (model?.flavour === 'affine:table') {
      return page.codec.blockToMarkdown(model);
    }
  }
  return undefined;
}

describe('hasTitleHeading（#275 の題の決め方）', () => {
  it('先頭（空行を除く）が # 見出しのときだけ真', () => {
    assert.ok(hasTitleHeading('\n# 題\r\n本文'));
    assert.ok(!hasTitleHeading('## 小見出し\n本文'));
    assert.ok(!hasTitleHeading('本文\n# 後ろの見出し'));
  });
});

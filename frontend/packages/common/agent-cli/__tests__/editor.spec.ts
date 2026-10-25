import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Access, formatPage, renderPage } from '../src/convert/render';
import { Editor } from '../src/domain/editor';
import type { Op } from '../src/domain/ops';
import { CliError } from '../src/errors';
import {
  blockJson,
  buildFixture,
  snapshotOthers,
  WORKSPACE_URL,
} from './fixture';

function textOf(
  page: ReturnType<typeof buildFixture>['page'],
  id: string
): unknown {
  const model = page.store.getBlock(id)?.model as unknown as {
    props: { text: { toDelta(): unknown } };
  };
  return model.props.text.toDelta();
}

describe('読取表現', () => {
  it('編集可能・読み取り専用・編集不可を区別し、編集不可の中身も編集不可にする', async () => {
    const { page, ids } = buildFixture();
    const rendered = await renderPage(page.docId, page.store, page.codec);
    const access = new Map(rendered.blocks.map(b => [b.id, b.access]));

    assert.equal(access.get(ids.p1), Access.Editable);
    assert.equal(access.get(ids.t1), Access.Editable);
    assert.equal(access.get(ids.db), Access.ReadOnly);
    assert.equal(access.get(ids.cols), Access.Locked);
    // #272: カラムの構造は編集不可、中身は編集できる
    assert.equal(access.get(ids.cell), Access.Locked);
    assert.equal(access.get(ids.inCol), Access.Editable);
    // #278: 画像は追加・削除・移動できる
    assert.equal(access.get(ids.img), Access.Editable);
  });

  it('ページ参照は題付きの URL リンク、入れ子は字下げで出す', async () => {
    const { page, ids } = buildFixture();
    const text = formatPage(
      await renderPage(page.docId, page.store, page.codec),
      `${WORKSPACE_URL}/x`
    );

    assert.match(
      text,
      new RegExp(
        `\\{#${ids.ref}\\} see \\[他ページ\\]\\(${WORKSPACE_URL}/other\\) now`
      )
    );
    assert.match(text, new RegExp(`\\{#${ids.l2}\\}   \\* child`));
    assert.match(text, /\[database 読み取り専用\] DB（0 列 × 1 行）/);
    assert.match(text, new RegExp(`\\{#${ids.img}\\} \\[image\\] cap`));
  });
});

describe('replace（G2: 指定したブロック以外に影響しない）', () => {
  it('変えた文字だけを差し替え、変えていない文字の文字色は残す', async () => {
    const { page, ids } = buildFixture();
    const others = snapshotOthers(page, [ids.p1]);

    await new Editor(page).apply([
      {
        op: 'replace',
        block: ids.p1,
        expect: 'Hello world',
        content: 'Hi world',
      },
    ]);

    assert.deepEqual(textOf(page, ids.p1), [
      { insert: 'Hi ' },
      { insert: 'world', attributes: { color: 'red' } },
    ]);
    assert.deepEqual(snapshotOthers(page, [ids.p1]), others);
  });

  it('ページ参照の前後を書き換えても参照は残る', async () => {
    const { page, ids } = buildFixture();
    const content = `see [他ページ](${WORKSPACE_URL}/other) later`;
    await new Editor(page).apply([
      {
        op: 'replace',
        block: ids.ref,
        expect: `see [他ページ](${WORKSPACE_URL}/other) now`,
        content,
      },
    ]);

    const delta = textOf(page, ids.ref) as Array<{
      attributes?: { reference?: { pageId: string } };
    }>;
    const reference = delta.find(op => op.attributes?.reference);
    assert.equal(reference?.attributes?.reference?.pageId, 'other');
    const model = page.store.getBlock(ids.ref)!.model;
    assert.equal(await page.codec.blockToMarkdown(model), content);
  });

  it('expect が今の本文と違えば中止する', async () => {
    const { page, ids } = buildFixture();
    await assert.rejects(
      new Editor(page).apply([
        { op: 'replace', block: ids.p1, expect: '古い', content: 'y' },
      ]),
      /読んだ後に内容が変わっている/
    );
  });

  it('種類が変わるときは同じ位置に作り直し、子を引き継ぐ', async () => {
    const { page, ids } = buildFixture();
    const result = await new Editor(page).apply([
      {
        op: 'replace',
        block: ids.l1,
        expect: '* [ ] todo',
        content: '## todo',
      },
    ]);

    const [{ from, to }] = result.replaced;
    assert.equal(from, ids.l1);
    const model = page.store.getBlock(to)!.model;
    assert.equal(model.flavour, 'affine:paragraph');
    assert.equal((model.props as { type: string }).type, 'h2');
    assert.deepEqual(
      model.children.map(c => c.id),
      [ids.l2]
    );
    assert.equal(page.store.getBlock(ids.l1), undefined);

    const note = page.store.getBlock(ids.note)!.model;
    assert.equal(note.children[1].id, to);
  });

  it('同じ種類なら ID を保ったまま種類だけ変える（ToDo の完了）', async () => {
    const { page, ids } = buildFixture();
    const result = await new Editor(page).apply([
      {
        op: 'replace',
        block: ids.l1,
        expect: '* [ ] todo',
        content: '* [x] todo',
      },
    ]);
    assert.deepEqual(result.replaced, []);
    assert.equal(
      (page.store.getBlock(ids.l1)!.model.props as { checked: boolean })
        .checked,
      true
    );
  });
});

describe('insert / delete / move', () => {
  it('指定位置に複数ブロックを足し、ID を返す', async () => {
    const { page, ids } = buildFixture();
    const result = await new Editor(page).apply([
      { op: 'insert', after: ids.p1, content: '- a\n- b' },
    ]);

    const note = page.store.getBlock(ids.note)!.model;
    assert.deepEqual(
      note.children.slice(1, 3).map(c => c.id),
      result.created
    );
  });

  it('位置を省くとページの末尾に足す', async () => {
    const { page, ids } = buildFixture();
    const result = await new Editor(page).apply([
      { op: 'insert', content: 'last' },
    ]);
    const note = page.store.getBlock(ids.note)!.model;
    assert.equal(note.children.at(-1)!.id, result.created[0]);
  });

  it('子ごと消す。他のブロックは不変', async () => {
    const { page, ids } = buildFixture();
    const others = snapshotOthers(page, [ids.note, ids.l1, ids.l2]);
    await new Editor(page).apply([
      { op: 'delete', block: ids.l1, expect: '* [ ] todo' },
    ]);

    assert.equal(page.store.getBlock(ids.l1), undefined);
    assert.equal(page.store.getBlock(ids.l2), undefined);
    assert.deepEqual(snapshotOthers(page, [ids.note, ids.l1, ids.l2]), others);
  });

  it('子を別の位置へ動かす', async () => {
    const { page, ids } = buildFixture();
    await new Editor(page).apply([
      { op: 'move', block: ids.l2, after: ids.p2 },
    ]);

    const note = page.store.getBlock(ids.note)!.model;
    assert.equal(note.children.at(-1)!.id, ids.l2);
    assert.deepEqual(page.store.getBlock(ids.l1)!.model.children, []);
  });

  it('自分の子孫の中へは動かせない', async () => {
    const { page, ids } = buildFixture();
    await assert.rejects(
      new Editor(page).apply([{ op: 'move', block: ids.l1, parent: ids.l2 }]),
      /自分の中へは動かせない/
    );
  });
});

describe('安全規則（§6.3）', () => {
  const cases: Array<[string, (ids: Record<string, string>) => Op]> = [
    [
      'マルチカラムそのもの（構造）',
      ids => ({ op: 'delete', block: ids.cols, expect: '[columns 編集不可]' }),
    ],
    [
      '画像の replace（差し替えは delete ＋ image）',
      ids => ({
        op: 'replace',
        block: ids.img,
        expect: '[image] cap',
        content: 'x',
      }),
    ],
    ['データベース', ids => ({ op: 'delete', block: ids.db, expect: '' })],
    [
      'データベースの行',
      ids => ({ op: 'replace', block: ids.dbRow, expect: 'row', content: 'x' }),
    ],
    [
      'カラムのセル（構造）の移動',
      ids => ({ op: 'move', block: ids.cell, after: ids.p1 }),
    ],
  ];

  for (const [label, makeOp] of cases) {
    it(`${label}は操作できない`, async () => {
      const { page, ids } = buildFixture();
      const before = snapshotOthers(page, []);
      await assert.rejects(new Editor(page).apply([makeOp(ids)]), CliError);
      assert.deepEqual(snapshotOthers(page, []), before);
    });
  }

  it('画像を作る Markdown は拒む（通信もしない）', async () => {
    const { page } = buildFixture();
    let fetched = false;
    const original = globalThis.fetch;
    globalThis.fetch = (() => {
      fetched = true;
      return Promise.reject(new Error('x'));
    }) as typeof fetch;
    try {
      await assert.rejects(
        new Editor(page).apply([
          { op: 'insert', content: '![a](https://example.com/a.png)' },
        ]),
        /画像は追加できない/
      );
    } finally {
      globalThis.fetch = original;
    }
    assert.equal(fetched, false);
  });
});

describe('表', () => {
  it('セルを変え、他のブロックは不変', async () => {
    const { page, ids } = buildFixture();
    const others = snapshotOthers(page, [ids.t1]);
    await new Editor(page).apply([
      {
        op: 'table.set',
        block: ids.t1,
        row: 1,
        col: 1,
        expect: 'b',
        text: '**B**',
      },
    ]);

    const md = await page.codec.blockToMarkdown(
      page.store.getBlock(ids.t1)!.model
    );
    assert.match(md, /\| a +\| \*\*B\*\* \|/);
    assert.deepEqual(snapshotOthers(page, [ids.t1]), others);
  });

  it('行を足し、列を消す', async () => {
    const { page, ids } = buildFixture();
    await new Editor(page).apply([
      { op: 'table.insertRow', block: ids.t1, at: 1, cells: ['x', 'y'] },
      {
        op: 'table.deleteCol',
        block: ids.t1,
        index: 0,
        expect: ['h1', 'x', 'a'],
      },
    ]);

    const md = await page.codec.blockToMarkdown(
      page.store.getBlock(ids.t1)!.model
    );
    assert.deepEqual(
      md.split('\n').map(line => line.replace(/\s+/g, '')),
      ['|h2|', '|--|', '|y|', '|b|']
    );
  });

  it('セルの expect が違えば中止する', async () => {
    const { page, ids } = buildFixture();
    await assert.rejects(
      new Editor(page).apply([
        {
          op: 'table.set',
          block: ids.t1,
          row: 1,
          col: 1,
          expect: 'z',
          text: 'B',
        },
      ]),
      /読んだ後に内容が変わっている/
    );
  });
});

describe('title', () => {
  it('題を差分で変える', async () => {
    const { page } = buildFixture();
    const result = await new Editor(page).apply([
      { op: 'title', text: '新しい題', expect: '題' },
    ]);
    assert.equal(result.title, '新しい題');
    assert.equal(
      String((page.store.root!.props as { title: unknown }).title),
      '新しい題'
    );
  });
});

describe('送る差分', () => {
  it('編集した分だけが update になる', async () => {
    const { page, ids } = buildFixture();
    assert.equal(page.doc.takeUpdate(), null);
    await new Editor(page).apply([
      { op: 'replace', block: ids.p2, expect: 'tail', content: 'tail!' },
    ]);
    assert.ok(page.doc.takeUpdate());
    assert.ok(blockJson(page, ids.p2));
  });
});

/**
 * #278: ローカルの画像の追加（設計書 §6.9）。
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { LocalImages } from '../src/convert/local-images';
import { Editor } from '../src/domain/editor';
import type { Page } from '../src/domain/page';
import { planUpdate } from '../src/domain/update';
import { CliError } from '../src/errors';
import { buildFixture, pageFromMarkdown, snapshotOthers } from './fixture';

// 4×4 の赤い PNG・1×1 の GIF
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGP4z8AARwzEcQCukw/x0F8jngAAAABJRU5ErkJggg==',
  'base64'
);
const GIF = Buffer.from('R0lGODlhAQABAAAAACw=', 'base64');
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>'
);

/** 画像を置いたディレクトリ。`name → 中身` */
function dirWith(files: Record<string, Buffer>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofuro-images-test-'));
  for (const [name, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), data);
  }
  return dir;
}

/** ブラウザ・サーバーと同じ鍵（SHA-256 の base64url） */
const keyOf = (data: Buffer) =>
  createHash('sha256').update(data).digest('base64url');

function withImages(page: Page, dir: string): LocalImages {
  const images = new LocalImages(dir);
  page.codec.useImages(images);
  return images;
}

describe('LocalImages（#278）', () => {
  it('中身で形式を判定し、ブラウザと同じ鍵を付ける', () => {
    const images = new LocalImages(dirWith({ 'a.dat': PNG, 'b.png': GIF }));
    const a = images.add('./a.dat');
    assert.equal(a.mime, 'image/png', '拡張子でなく中身で判定する');
    assert.equal(a.key, keyOf(PNG));
    assert.equal(images.add('b.png').mime, 'image/gif');
    assert.equal(images.pending().length, 2);
  });

  it('⚠️ SVG・画像でないファイルは拒む（テキストのファイルを画像として送らせない）', () => {
    const images = new LocalImages(
      dirWith({ 'x.svg': SVG, 'secret.png': Buffer.from('password=1') })
    );
    assert.throws(() => images.add('x.svg'), /PNG \/ JPEG \/ GIF \/ WebP/);
    assert.throws(() => images.add('secret.png'), /PNG \/ JPEG \/ GIF \/ WebP/);
  });

  it('無いファイル・大きすぎるファイルは拒む', () => {
    const dir = dirWith({ 'big.png': Buffer.concat([PNG, Buffer.alloc(100)]) });
    assert.throws(
      () => new LocalImages(dir).add('none.png'),
      /画像ファイルを読めない/
    );
    assert.throws(() => new LocalImages(dir, 50).add('big.png'), /大きすぎる/);
  });

  it('同じ画像は1回だけ送る', () => {
    const images = new LocalImages(dirWith({ 'a.png': PNG, 'b.png': PNG }));
    images.add('a.png');
    images.add('b.png');
    assert.equal(images.pending().length, 1);
  });
});

describe('Markdown の画像（#278）', () => {
  it('⚠️ ローカルの画像を画像ブロックにし、変換が作る直前の空の段落は除く', async () => {
    const page = await pageFromMarkdown('先頭');
    withImages(page, dirWith({ 'img/a.png': PNG }));
    const snapshots = await page.codec.parse(
      '段落\n\n![説明](./img/a.png)\n\n末尾\n'
    );
    assert.deepEqual(
      snapshots.map(s => s.flavour),
      ['affine:paragraph', 'affine:image', 'affine:paragraph']
    );
    assert.equal(snapshots[1].props.sourceId, keyOf(PNG));
  });

  it('無いファイルの画像は拒む', async () => {
    const page = await pageFromMarkdown('先頭');
    withImages(page, dirWith({}));
    await assert.rejects(
      page.codec.parse('![](./none.png)'),
      /画像ファイルを読めない/
    );
  });

  it('画像の読み込み先が無い（use していない）変換では、ローカルの画像も拒む', async () => {
    const page = await pageFromMarkdown('先頭');
    await assert.rejects(
      new Editor(page).apply([{ op: 'insert', content: '![](./a.png)' }]),
      CliError
    );
  });
});

describe('edit の image 操作（#278）', () => {
  it('指定位置に画像を足し、キャプションを付ける。他は変えない', async () => {
    const { page, ids } = buildFixture();
    const images = withImages(page, dirWith({ 'a.png': PNG }));
    const before = snapshotOthers(page, []);

    const result = await new Editor(page).apply([
      { op: 'image', file: 'a.png', caption: '構成図', after: ids.p1 },
    ]);

    const [id] = result.created;
    const model = page.store.getBlock(id)!.model;
    assert.equal(model.flavour, 'affine:image');
    assert.equal((model.props as { sourceId: string }).sourceId, keyOf(PNG));
    assert.equal((model.props as { caption: string }).caption, '構成図');
    const note = page.store.getBlock(ids.note)!.model;
    assert.equal(note.children[1].id, id, 'p1 の直後');
    assert.equal(images.pending().length, 1);
    for (const [blockId, json] of before) {
      if (blockId !== ids.note) {
        assert.equal(snapshotOthers(page, [id, ids.note]).get(blockId), json);
      }
    }
  });

  it('画像ブロックは delete・move できる（expect は [image] キャプション）', async () => {
    const { page, ids } = buildFixture();
    await new Editor(page).apply([
      { op: 'move', block: ids.img, before: ids.p1 },
    ]);
    const note = page.store.getBlock(ids.note)!.model;
    assert.equal(note.children[0].id, ids.img);

    await new Editor(page).apply([
      { op: 'delete', block: ids.img, expect: '[image] cap' },
    ]);
    assert.equal(page.store.getBlock(ids.img), undefined);
  });

  it('⚠️ 画像の expect が違えば消さない', async () => {
    const { page, ids } = buildFixture();
    await assert.rejects(
      new Editor(page).apply([
        { op: 'delete', block: ids.img, expect: '[image] 別' },
      ]),
      /読んだ後に内容が変わっている/
    );
  });
});

describe('update の画像（#278）', () => {
  it('⚠️ 同じ画像は鍵で比べて触らない。違う画像は消して足す', async () => {
    const dir = dirWith({ 'a.png': PNG, 'b.gif': GIF });
    const md = '段落\n\n![](./a.png)\n\n末尾\n';
    const page = await pageFromMarkdown('段落\n\n末尾\n');
    withImages(page, dir);
    await new Editor(page).apply(await planUpdate(page, md));

    assert.deepEqual(await planUpdate(page, md), [], '同じ画像なら差が無い');

    const ops = await planUpdate(page, md.replace('./a.png', './b.gif'));
    assert.deepEqual(
      ops.map(o => o.op),
      ['delete', 'image']
    );
    assert.equal((ops[1] as { file: string }).file, './b.gif');
  });
});

describe('ローカルの画像の読み取りの範囲（#288 レビュー）', () => {
  it('⚠️ Markdown の画像は、Markdown の場所かカレントの配下だけ（手元の私的な画像を上げさせない）', () => {
    const outside = dirWith({ 'private.png': PNG });
    const base = dirWith({ 'ok.png': PNG });
    const images = new LocalImages(base);
    assert.throws(
      () => images.addFromMarkdown(path.join(outside, 'private.png')),
      /Markdown の場所/
    );
    assert.throws(
      () =>
        images.addFromMarkdown('../' + path.basename(outside) + '/private.png'),
      /Markdown の場所/
    );
    assert.equal(images.addFromMarkdown('./ok.png').mime, 'image/png');
  });

  it('⚠️ 配下を指すシンボリックリンクでも、実体が外なら拒む', () => {
    const outside = dirWith({ 'private.png': PNG });
    const base = dirWith({});
    fs.symlinkSync(
      path.join(outside, 'private.png'),
      path.join(base, 'link.png')
    );
    assert.throws(
      () => new LocalImages(base).addFromMarkdown('link.png'),
      /Markdown の場所/
    );
  });

  it('image add の --file（名指し）はどこでも読める', () => {
    const outside = dirWith({ 'chart.png': PNG });
    const images = new LocalImages(dirWith({}));
    assert.equal(images.add(path.join(outside, 'chart.png')).mime, 'image/png');
  });

  it('⚠️ 普通のファイルでないもの（ディレクトリ等）は読まずに拒む', () => {
    const dir = dirWith({ 'sub/a.png': PNG });
    assert.throws(
      () => new LocalImages(dir).add('sub'),
      /画像ファイルを読めない/
    );
  });

  it('⚠️ 大きさは読む前に確かめる', () => {
    const dir = dirWith({ 'big.png': Buffer.concat([PNG, Buffer.alloc(100)]) });
    const images = new LocalImages(dir, 50);
    const original = fs.readFileSync;
    let read = false;
    (fs as { readFileSync: unknown }).readFileSync = (...a: unknown[]) => {
      read = true;
      return (original as (...x: unknown[]) => unknown)(...a);
    };
    try {
      assert.throws(() => images.add('big.png'), /大きすぎる/);
    } finally {
      (fs as { readFileSync: unknown }).readFileSync = original;
    }
    assert.equal(read, false);
  });

  it('名前が %20 を含むファイルも読める（デコードした名前が無ければ書かれたとおり）', () => {
    const dir = dirWith({ 'a%20b.png': PNG });
    assert.equal(new LocalImages(dir).add('a%20b.png').mime, 'image/png');
  });
});

describe('コードの中の画像の記法（#288 レビュー）', () => {
  it('⚠️ コードブロック・インラインコードの中の ![](…) は画像として読まない', () => {
    const images = new LocalImages(dirWith({}));
    const md =
      '```md\n![例](./none.png)\n```\n\n説明 `![x](./none2.png)` です\n';
    assert.deepEqual(images.refsIn(md), []);
  });

  it('コードの外の画像は読む', () => {
    const images = new LocalImages(dirWith({}));
    assert.deepEqual(images.refsIn('`code`\n\n![a](./a.png)\n'), ['./a.png']);
  });
});

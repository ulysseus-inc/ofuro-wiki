/**
 * #273: ページ内の画像・添付ファイルの取り出し（設計書 §6.8）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { Text } from '@blocksuite/affine/store';

import { loadDoc } from '../src/convert/blocksuite';
import {
  type FetchBlob,
  MAX_ASSET_BYTES,
  MAX_ASSET_COUNT,
  MAX_TOTAL_BYTES,
  fileName,
  pageAssets,
  saveAssets,
} from '../src/domain/assets';
import { CliError } from '../src/errors';

function buildPage() {
  const { store } = loadDoc('assets');
  const root = store.addBlock('affine:page', { title: new Text('題') });
  store.addBlock('affine:surface', {}, root);
  const note = store.addBlock('affine:note', {}, root);
  const ids = {
    para: store.addBlock('affine:paragraph', { text: new Text('本文') }, note),
    img: store.addBlock(
      'affine:image',
      { sourceId: 'k-img', width: 640, height: 480, caption: '全体図' },
      note
    ),
    file: store.addBlock(
      'affine:attachment',
      {
        sourceId: 'k-pdf',
        name: '../報告\n書.pdf',
        type: 'application/pdf',
        size: 3,
      },
      note
    ),
    uploading: store.addBlock('affine:image', {}, note),
    cols: store.addBlock('affine:columns', {}, note),
    inCol: '',
  };
  const cell = store.addBlock('affine:column-cell', {}, ids.cols);
  ids.inCol = store.addBlock('affine:image', { sourceId: 'k-col' }, cell);
  return { store, ids };
}

/** サーバーの代わり。鍵ごとの中身と形式 */
function fakeBlobs(
  blobs: Record<string, { data: string; mime: string }>,
  asked: string[] = []
): FetchBlob {
  return key => {
    asked.push(key);
    const blob = blobs[key];
    if (!blob) {
      return Promise.reject(new CliError(`無い: ${key}`));
    }
    return Promise.resolve({
      data: new TextEncoder().encode(blob.data),
      mime: blob.mime,
    });
  };
}

const BLOBS = {
  'k-img': { data: 'PNG', mime: 'image/png' },
  'k-pdf': { data: 'PDF', mime: 'application/pdf' },
  'k-col': { data: 'JPG', mime: 'image/jpeg' },
};

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ofuro-assets-test-'));

describe('pageAssets（#273）', () => {
  it('画像と添付を、編集不可の場所（マルチカラム）の中も含めて拾う', () => {
    const { store, ids } = buildPage();
    const assets = pageAssets(store);
    assert.deepEqual(
      assets.map(a => a.blockId),
      [ids.img, ids.file, ids.uploading, ids.inCol]
    );
    const img = assets.find(a => a.blockId === ids.img);
    assert.deepEqual(
      { ...img },
      {
        blockId: ids.img,
        flavour: 'affine:image',
        sourceId: 'k-img',
        width: 640,
        height: 480,
      }
    );
    const file = assets.find(a => a.blockId === ids.file);
    assert.equal(file?.name, '../報告\n書.pdf');
    assert.equal(file?.mime, 'application/pdf');
  });
});

describe('fileName（#273）', () => {
  it('画像はブロック ID と、形式に合った拡張子', () => {
    assert.equal(
      fileName({ blockId: 'b1', flavour: 'affine:image' }, 'image/png'),
      'b1.png'
    );
    assert.equal(
      fileName({ blockId: 'b1', flavour: 'affine:image' }, 'image/jpeg'),
      'b1.jpg'
    );
    assert.equal(
      fileName({ blockId: 'b1', flavour: 'affine:image' }, 'image/svg+xml'),
      'b1.svg'
    );
    assert.equal(
      fileName(
        { blockId: 'b1', flavour: 'affine:image' },
        'application/x-unknown'
      ),
      'b1.bin'
    );
  });

  it('⚠️ 添付の元の名前から、パスの区切り・制御文字を除く（保存先の外へ書かせない）', () => {
    const name = fileName(
      { blockId: 'b2', flavour: 'affine:attachment', name: '../報告\n書.pdf' },
      'application/pdf'
    );
    assert.equal(name, 'b2-.._報告_書.pdf');
    assert.ok(!name.includes('/'));
  });
});

describe('saveAssets（#273）', () => {
  it('指定したブロックの画像を保存し、パスを返す', async () => {
    const { store, ids } = buildPage();
    const dir = tmp();
    const { saved } = await saveAssets(store, [ids.img], dir, fakeBlobs(BLOBS));
    assert.deepEqual(saved, [path.join(dir, `${ids.img}.png`)]);
    assert.equal(fs.readFileSync(saved[0], 'utf8'), 'PNG');
  });

  it('ブロックを省くと、取り出せるもの全部（アップロード中は飛ばす）', async () => {
    const { store, ids } = buildPage();
    const asked: string[] = [];
    const { saved } = await saveAssets(
      store,
      [],
      tmp(),
      fakeBlobs(BLOBS, asked)
    );
    assert.deepEqual(asked, ['k-img', 'k-pdf', 'k-col']);
    assert.equal(saved.length, 3);
    assert.ok(saved.some(p => p.endsWith(`${ids.inCol}.jpg`)));
  });

  it('画像・添付でないブロック・無いブロックは拒む', async () => {
    const { store, ids } = buildPage();
    await assert.rejects(
      saveAssets(store, [ids.para], tmp(), fakeBlobs(BLOBS)),
      /画像・添付ではない/
    );
    await assert.rejects(
      saveAssets(store, ['nope'], tmp(), fakeBlobs(BLOBS)),
      /ブロックが無い/
    );
  });

  it('アップロード中（sourceId が無い）を指定したら知らせる', async () => {
    const { store, ids } = buildPage();
    await assert.rejects(
      saveAssets(store, [ids.uploading], tmp(), fakeBlobs(BLOBS)),
      /アップロード中/
    );
  });

  it('⚠️ 上限を超える大きさは保存しない', async () => {
    const { store, ids } = buildPage();
    const dir = tmp();
    const huge: FetchBlob = () =>
      Promise.resolve({
        data: new Uint8Array(MAX_ASSET_BYTES + 1),
        mime: 'image/png',
      });
    await assert.rejects(saveAssets(store, [ids.img], dir, huge), /大きすぎる/);
    assert.deepEqual(fs.readdirSync(dir), []);
  });
});

describe('保存先の外へ書かせない（#273 セキュリティレビュー）', () => {
  it('⚠️ ブロック ID もファイル名に使える文字だけにする（ID は他人が Yjs で作れる）', () => {
    assert.equal(
      fileName({ blockId: '../../evil', flavour: 'affine:image' }, 'image/png'),
      '.._.._evil.png'
    );
    assert.equal(
      fileName(
        { blockId: 'a/b', flavour: 'affine:attachment', name: 'x.pdf' },
        'application/pdf'
      ),
      'a_b-x.pdf'
    );
  });

  it('⚠️ ブロック ID に ../ を含む画像も、保存先の中に保存する', async () => {
    // 他人が Yjs で直接作ったブロックの形（blocksuite の addBlock では ID を選べない）
    const id = '../escaped';
    const model = {
      id,
      flavour: 'affine:image',
      props: { sourceId: 'k-img' },
      children: [],
    };
    const store = {
      root: { id: 'r', flavour: 'affine:page', props: {}, children: [model] },
      getBlock: (blockId: string) => (blockId === id ? { model } : null),
    } as unknown as Parameters<typeof saveAssets>[0];

    const parent = tmp();
    const dir = path.join(parent, 'out');
    const { saved } = await saveAssets(store, [id], dir, fakeBlobs(BLOBS));
    assert.equal(path.dirname(saved[0]), dir);
    assert.deepEqual(fs.readdirSync(parent), ['out']);
  });

  it('既にあるファイルは上書きしない', async () => {
    const { store, ids } = buildPage();
    const dir = tmp();
    fs.writeFileSync(path.join(dir, `${ids.img}.png`), 'mine');
    await assert.rejects(
      saveAssets(store, [ids.img], dir, fakeBlobs(BLOBS)),
      /既にある/
    );
    assert.equal(
      fs.readFileSync(path.join(dir, `${ids.img}.png`), 'utf8'),
      'mine'
    );
  });
});

describe('取り出しの後始末・重複（#287 レビュー）', () => {
  it('⚠️ ID を指定して途中で失敗したら、その回に保存した分を消す（パスを出せないファイルを残さない）', async () => {
    const { store, ids } = buildPage();
    const dir = tmp();
    const flaky = fakeBlobs({ 'k-img': BLOBS['k-img'] }); // k-pdf で失敗する
    await assert.rejects(
      saveAssets(store, [ids.img, ids.file], dir, flaky),
      /無い: k-pdf/
    );
    assert.deepEqual(fs.readdirSync(dir), []);
  });

  it('⚠️ 全部を取り出すときは、失敗したものを飛ばして残りを保存する（他人が混ぜた壊れた画像で全体を止めない）', async () => {
    const { store, ids } = buildPage();
    const dir = tmp();
    const flaky = fakeBlobs({
      'k-img': BLOBS['k-img'],
      'k-col': BLOBS['k-col'],
    });
    const { saved, skipped } = await saveAssets(store, [], dir, flaky);
    assert.equal(saved.length, 2);
    assert.deepEqual(
      skipped.map(s => s.blockId),
      [ids.file]
    );
    assert.match(skipped[0].reason, /無い: k-pdf/);
  });

  it('同じブロックを2度指定しても1回だけ保存する', async () => {
    const { store, ids } = buildPage();
    const { saved } = await saveAssets(
      store,
      [ids.img, ids.img],
      tmp(),
      fakeBlobs(BLOBS)
    );
    assert.equal(saved.length, 1);
  });

  it('Windows で使えない文字も _ にする', () => {
    assert.equal(
      fileName(
        { blockId: 'b3', flavour: 'affine:attachment', name: 'a:b*c?"<>|.pdf' },
        'application/pdf'
      ),
      'b3-a_b_c_____.pdf'
    );
  });
});

describe('全部の取り出しの上限（#287 レビュー）', () => {
  /** 同じ画像を指すブロックを count 個並べたページ */
  function pageWithCopies(count: number, sourceIds: (i: number) => string) {
    const { store } = loadDoc(`copies-${count}`);
    const root = store.addBlock('affine:page', { title: new Text('題') });
    const note = store.addBlock('affine:note', {}, root);
    for (let i = 0; i < count; i++) {
      store.addBlock('affine:image', { sourceId: sourceIds(i) }, note);
    }
    return store;
  }

  it('⚠️ 同じ画像を指すブロックが並んでいても、取り出すのは1回だけ', async () => {
    const asked: string[] = [];
    const store = pageWithCopies(5, () => 'k-img');
    const { saved, skipped } = await saveAssets(
      store,
      [],
      tmp(),
      fakeBlobs(BLOBS, asked)
    );
    assert.deepEqual(asked, ['k-img']);
    assert.equal(saved.length, 1);
    assert.equal(skipped.length, 4);
    assert.match(skipped[0].reason, /同じ画像/);
  });

  it('⚠️ 件数の上限を超えた分は取りに行かずに飛ばす', async () => {
    const asked: string[] = [];
    const store = pageWithCopies(MAX_ASSET_COUNT + 3, i => `k-${i}`);
    const many = Object.fromEntries(
      Array.from({ length: MAX_ASSET_COUNT + 3 }, (_, i) => [
        `k-${i}`,
        { data: 'x', mime: 'image/png' },
      ])
    );
    const { saved, skipped } = await saveAssets(
      store,
      [],
      tmp(),
      fakeBlobs(many, asked)
    );
    assert.equal(saved.length, MAX_ASSET_COUNT);
    assert.equal(asked.length, MAX_ASSET_COUNT);
    assert.equal(skipped.length, 3);
    assert.match(skipped[0].reason, /上限/);
  });

  it('⚠️ 合計の大きさの上限を超えたら、残りは取りに行かない', async () => {
    const asked: string[] = [];
    const store = pageWithCopies(3, i => `big-${i}`);
    const sixBytes: FetchBlob = key => {
      asked.push(key);
      return Promise.resolve({ data: new Uint8Array(6), mime: 'image/png' });
    };
    const { saved, skipped } = await saveAssets(store, [], tmp(), sixBytes, {
      count: MAX_ASSET_COUNT,
      totalBytes: 10,
    });
    assert.equal(saved.length, 2, '2件目で合計（12）が上限（10）を超える');
    assert.equal(asked.length, 2, '3件目は取りに行かない');
    assert.equal(skipped.length, 1);
    assert.ok(MAX_TOTAL_BYTES > 0);
  });
});

describe('書き込みの失敗の案内（#287 レビュー）', () => {
  it('⚠️ 保存先がファイルなど、書けないときは案内付きのエラーにする', async () => {
    const { store, ids } = buildPage();
    const file = path.join(tmp(), 'not-a-dir');
    fs.writeFileSync(file, 'x');
    await assert.rejects(
      saveAssets(store, [ids.img], file, fakeBlobs(BLOBS)),
      (e: unknown) => e instanceof CliError && /保存できない/.test(e.message)
    );
  });
});

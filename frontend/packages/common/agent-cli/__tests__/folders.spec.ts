/**
 * #274: フォルダ。サイドバーと同じ Yjs 文書 `db$<ws>$folders`（設計書 §6.7）。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as Y from 'yjs';

import { FolderTree } from '../src/domain/folders';
import { CliError } from '../src/errors';

type Row = {
  id: string;
  type?: string;
  data?: string;
  parentId?: string | null;
  index?: string;
  deleted?: boolean;
};

/** 実測と同じ形（開発 DB、2026-10-17）: レコードごとにルートの Y.Map */
function folderState(rows: Row[]): Uint8Array {
  const doc = new Y.Doc();
  for (const r of rows) {
    const m = doc.getMap(r.id);
    m.set('id', r.id);
    if (r.deleted) {
      m.set('$$DELETED', true);
      continue;
    }
    m.set('type', r.type);
    m.set('data', r.data);
    m.set('parentId', r.parentId ?? null);
    m.set('index', r.index);
  }
  return Y.encodeStateAsUpdate(doc);
}

/** 送った差分をサーバー側の状態に当てて、レコードを読む */
function applied(state: Uint8Array, update: Uint8Array) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  Y.applyUpdate(doc, update);
  const out: Record<string, Record<string, unknown>> = {};
  for (const key of doc.share.keys()) {
    out[key] = doc.getMap(key).toJSON();
  }
  return out;
}

const BASE = folderState([
  { id: 'f1', type: 'folder', data: '設計', index: 'a1' },
  { id: 'f2', type: 'folder', data: '調査', index: 'a0' },
  { id: 'f3', type: 'folder', data: '下書き', parentId: 'f1', index: 'a0' },
  { id: 'f4', type: 'folder', data: '下書き', parentId: 'f2', index: 'a0' },
  { id: 'l1', type: 'doc', data: 'docA', parentId: 'f1', index: 'a2' },
  { id: 'l2', type: 'doc', data: 'docB', parentId: 'f1', index: 'a1' },
  { id: 'gone', deleted: true },
]);

describe('FolderTree（#274）', () => {
  it('子を index の昇順で並べる。消したレコードは出さない', () => {
    const tree = FolderTree.fromState(BASE);
    assert.deepEqual(
      tree.children(null).map(n => n.id),
      ['f2', 'f1']
    );
    assert.deepEqual(
      tree.children('f1').map(n => [n.type, n.data]),
      [
        ['folder', '下書き'],
        ['doc', 'docB'],
        ['doc', 'docA'],
      ]
    );
    assert.ok(!tree.children(null).some(n => n.id === 'gone'));
  });

  it('フォルダを名前でも ID でも引ける', () => {
    const tree = FolderTree.fromState(BASE);
    assert.equal(tree.resolve('設計').id, 'f1');
    assert.equal(tree.resolve('f4').id, 'f4');
  });

  it('⚠️ 同じ名前のフォルダが2つあれば、場所と ID を示して拒む', () => {
    const tree = FolderTree.fromState(BASE);
    assert.throws(
      () => tree.resolve('下書き'),
      (e: unknown) =>
        e instanceof CliError &&
        /同じ名前のフォルダが複数ある/.test(e.message) &&
        /設計 \/ 下書き/.test(e.hint ?? '') &&
        /f3/.test(e.hint ?? '')
    );
  });

  it('無いフォルダは拒む', () => {
    const tree = FolderTree.fromState(BASE);
    assert.throws(() => tree.resolve('無い'), /フォルダが無い/);
  });

  it('⚠️ フォルダを作ると、親の末尾に置く（ブラウザと同じ形）', () => {
    const tree = FolderTree.fromState(BASE);
    const id = tree.createFolder('新規', 'f1');
    const rows = applied(BASE, tree.takeUpdate() as Uint8Array);

    assert.equal(rows[id].type, 'folder');
    assert.equal(rows[id].data, '新規');
    assert.equal(rows[id].parentId, 'f1');
    assert.equal(rows[id].id, id);
    assert.ok((rows[id].index as string) > 'a2', '末尾（a2 の後ろ）');
  });

  it('最上位にも作れる（parentId は null）', () => {
    const tree = FolderTree.fromState(BASE);
    const id = tree.createFolder('最上位', null);
    const rows = applied(BASE, tree.takeUpdate() as Uint8Array);
    assert.equal(rows[id].parentId, null);
    assert.ok((rows[id].index as string) > 'a1');
  });

  it('ページを入れると末尾に置く。同じフォルダへ2度は入れない', () => {
    const tree = FolderTree.fromState(BASE);
    assert.equal(tree.addDoc('f1', 'docA'), false, '既にある');
    assert.equal(tree.takeUpdate(), null);

    assert.equal(tree.addDoc('f1', 'docC'), true);
    const rows = applied(BASE, tree.takeUpdate() as Uint8Array);
    const link = Object.values(rows).find(r => r.data === 'docC');
    assert.equal(link?.type, 'doc');
    assert.equal(link?.parentId, 'f1');
    assert.ok((link?.index as string) > 'a2');
  });

  it('⚠️ 1ページを複数のフォルダに入れられる', () => {
    const tree = FolderTree.fromState(BASE);
    assert.equal(tree.addDoc('f2', 'docA'), true);
    assert.deepEqual(
      tree
        .foldersOf('docA')
        .map(f => f.id)
        .sort(),
      ['f1', 'f2']
    );
  });

  it('外すとリンクに削除の印を付ける（ブラウザの ORM と同じ）。他は変えない', () => {
    const tree = FolderTree.fromState(BASE);
    assert.equal(tree.removeDoc('f1', 'docB'), 1);
    const rows = applied(BASE, tree.takeUpdate() as Uint8Array);

    assert.deepEqual(rows.l2, { id: 'l2', $$DELETED: true });
    assert.equal(rows.l1.data, 'docA');
    assert.deepEqual(tree.docsIn('f1'), ['docA']);
  });

  it('フォルダに無いページを外そうとしたら 0 件', () => {
    const tree = FolderTree.fromState(BASE);
    assert.equal(tree.removeDoc('f2', 'docA'), 0);
    assert.equal(tree.takeUpdate(), null);
  });

  it('場所（親 / 子）を出す', () => {
    const tree = FolderTree.fromState(BASE);
    assert.equal(tree.path('f3'), '設計 / 下書き');
  });
});

describe('FolderTree.outline（#274 の権限）', () => {
  it('⚠️ 台帳に無いページ（権限が無い・ゴミ箱）はツリーに出さない', () => {
    const tree = FolderTree.fromState(BASE);
    // docB は権限が無い（台帳に無い）
    const outline = tree.outline(new Map([['docA', '題A']]));

    const design = outline.find(f => f.id === 'f1');
    assert.deepEqual(design?.pages, [{ docId: 'docA', title: '題A' }]);
    assert.ok(!JSON.stringify(outline).includes('docB'));
    assert.deepEqual(
      design?.folders.map(f => f.name),
      ['下書き']
    );
  });
});

describe('FolderTree の壊れたデータ・誤操作（#284 レビュー）', () => {
  // 循環したフォルダは親が null にならないため、最上位から辿り着かない。無限に辿らないことを固定する
  it('⚠️ 親子が循環していても outline は止まる（同時の移動で起こりうる）', () => {
    const tree = FolderTree.fromState(
      folderState([
        { id: 'top', type: 'folder', data: '上', index: 'a0' },
        { id: 'x', type: 'folder', data: 'X', parentId: 'y', index: 'a0' },
        { id: 'y', type: 'folder', data: 'Y', parentId: 'x', index: 'a0' },
        { id: 'z', type: 'folder', data: 'Z', parentId: 'top', index: 'a0' },
      ])
    );
    const outline = tree.outline(new Map());
    assert.deepEqual(
      outline.map(f => f.name),
      ['上']
    );
  });

  it('find は無ければ undefined。前後の空白は ID でも名前でも無視する', () => {
    const tree = FolderTree.fromState(BASE);
    assert.equal(tree.find('無い'), undefined);
    assert.equal(tree.find(' f1 ')?.id, 'f1');
    assert.equal(tree.find(' 設計 ')?.id, 'f1');
    assert.throws(() => tree.find('下書き'), /同じ名前のフォルダが複数ある/);
  });
});

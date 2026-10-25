/**
 * #276: タグ。定義はルート文書 `meta.properties.tags.options`、
 * ページに付いたタグは台帳（設計書 §6.6）。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as Y from 'yjs';

import { option, options, parseArgs } from '../src/commands/args';
import { Missing, TagCatalog } from '../src/domain/tags';
import { CliError } from '../src/errors';

/** 実測と同じ形（開発 DB、2026-10-17）: Y.Map > Y.Map > Y.Array<Y.Map> */
function rootWithTags(
  tags: Array<{ id: string; value: string; color?: string }>
): Uint8Array {
  const doc = new Y.Doc();
  const props = new Y.Map<unknown>();
  const tagMap = new Y.Map<unknown>();
  const list = new Y.Array<Y.Map<unknown>>();
  doc.getMap('meta').set('name', '社内Wiki');
  doc.getMap('meta').set('properties', props);
  props.set('tags', tagMap);
  tagMap.set('options', list);
  for (const t of tags) {
    const m = new Y.Map<unknown>();
    m.set('id', t.id);
    m.set('value', t.value);
    m.set('color', t.color ?? 'var(--affine-palette-line-grey)');
    m.set('createDate', 1);
    m.set('updateDate', 1);
    list.push([m]);
  }
  return Y.encodeStateAsUpdate(doc);
}

/** 送った差分をサーバー側の状態に当て、タグの定義を読み直す */
function applyTo(state: Uint8Array, update: Uint8Array): unknown[] {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  Y.applyUpdate(doc, update);
  const props = doc.getMap('meta').get('properties') as Y.Map<unknown>;
  const tags = props.get('tags') as Y.Map<unknown>;
  return (tags.get('options') as Y.Array<unknown>).toJSON();
}

const BASE = rootWithTags([
  { id: 't1', value: '仕様書' },
  { id: 't2', value: '調査' },
]);

describe('TagCatalog（#276）', () => {
  it('ルート文書からタグの定義を読む', () => {
    const catalog = TagCatalog.fromState(BASE);
    assert.deepEqual(
      catalog.list().map(t => [t.id, t.name]),
      [
        ['t1', '仕様書'],
        ['t2', '調査'],
      ]
    );
  });

  it('名前でも ID でも引ける', () => {
    const catalog = TagCatalog.fromState(BASE);
    assert.deepEqual(catalog.resolve(['仕様書', 't2'], Missing.Reject).ids, [
      't1',
      't2',
    ]);
  });

  it('無い名前は、Reject なら拒む（打ち間違いを黙って通さない）', () => {
    const catalog = TagCatalog.fromState(BASE);
    assert.throws(
      () => catalog.resolve(['仕様', '調査'], Missing.Reject),
      /タグが無い: 仕様/
    );
  });

  it('⚠️ 同じ名前のタグが2つあれば、ID を求める', () => {
    const catalog = TagCatalog.fromState(
      rootWithTags([
        { id: 'a', value: '重複' },
        { id: 'b', value: '重複' },
      ])
    );
    assert.throws(() => catalog.resolve(['重複'], Missing.Create), CliError);
    assert.deepEqual(catalog.resolve(['b'], Missing.Reject).ids, ['b']);
  });

  it('⚠️ 無い名前は、Create なら作る。既存の定義を消さずに1件足す', () => {
    const catalog = TagCatalog.fromState(BASE);
    const { ids, created } = catalog.resolve(
      ['調査', '新規', '新規'],
      Missing.Create
    );

    assert.equal(created.length, 1, '同じ名前を2度作らない');
    assert.equal(created[0].name, '新規');
    assert.equal(ids[0], 't2');
    assert.equal(ids[1], created[0].id);
    assert.equal(ids.length, 2);

    const update = catalog.takeUpdate();
    assert.ok(update);
    const after = applyTo(BASE, update) as Array<Record<string, unknown>>;
    assert.deepEqual(
      after.map(t => t.value),
      ['仕様書', '調査', '新規']
    );
    // ブラウザと同じ形・同じ色の書式
    assert.match(
      after[2].color as string,
      /^var\(--affine-palette-line-[a-z]+\)$/
    );
    assert.equal(typeof after[2].createDate, 'number');
  });

  it('作らなければ送るものは無い', () => {
    const catalog = TagCatalog.fromState(BASE);
    catalog.resolve(['仕様書'], Missing.Create);
    assert.equal(catalog.takeUpdate(), null);
  });

  it('タグの定義が1つも無いワークスペースでも作れる', () => {
    const empty = Y.encodeStateAsUpdate(new Y.Doc());
    const catalog = TagCatalog.fromState(empty);
    assert.deepEqual(catalog.list(), []);
    catalog.resolve(['最初'], Missing.Create);
    const update = catalog.takeUpdate();
    assert.ok(update);
    assert.deepEqual(
      (applyTo(empty, update) as Array<{ value: string }>).map(t => t.value),
      ['最初']
    );
  });

  it('ID を名前に直す。定義に無い ID はそのまま', () => {
    const catalog = TagCatalog.fromState(BASE);
    assert.deepEqual(catalog.names(['t2', 'gone']), ['調査', 'gone']);
  });
});

describe('同じオプションの繰り返し（#276 の --tag / --add）', () => {
  it('すべての値を順に返す。option は最後の1つ', () => {
    const args = parseArgs(['doc', '--tag', 'a', '--tag', 'b', '--json']);
    assert.deepEqual(options(args, 'tag'), ['a', 'b']);
    assert.equal(option(args, 'tag'), 'b');
    assert.deepEqual(options(args, 'none'), []);
  });
});

/**
 * #256: ⚠️ **Undo でページの骨組み（affine:page）を消さないこと。**
 *
 * 骨組みが消えるとページが開けなくなる（本文は下にぶら下がったまま見えない）。
 * 2026-06-21 に本番で、インポート直後の Ctrl-Z で骨組みごと消えた
 * （docs/import-undo-root-guard.md）。インポートの経路は個別に塞いだが、
 * 骨組みの作成が Undo の対象に残る経路が増えるたびに、同じことが起き得る。
 * Undo の側で、骨組みを消させない。
 */
import { expect, test } from 'vitest';

import { Text } from '../reactive/index.js';
import { createAutoIncrementIdGenerator } from '../test/index.js';
import { TestWorkspace } from '../test/test-workspace.js';
import {
  NoteBlockSchemaExtension,
  ParagraphBlockSchemaExtension,
  type RootBlockModel,
  RootBlockSchemaExtension,
} from './test-schema.js';

const extensions = [
  RootBlockSchemaExtension,
  NoteBlockSchemaExtension,
  ParagraphBlockSchemaExtension,
];

function createStore() {
  const collection = new TestWorkspace({
    id: 'test-collection',
    idGenerator: createAutoIncrementIdGenerator(),
  });
  collection.meta.initialize();

  const doc = collection.createDoc('home');
  doc.load();
  const store = doc.getStore({ extensions });

  // ⚠️ Undo の記録は、最初に使われた時点から始まる。エディタは最初から使うが、
  // テストでは先に始めておかないと、その前の操作が Undo の対象にならない
  store.resetHistory();
  return store;
}

test('骨組みの作成を Undo しても、骨組みは残る', () => {
  const store = createStore();

  // インポート直後と同じ形: 骨組みの作成が Undo の対象に積まれている
  const pageId = store.addBlock('affine:page', { title: new Text('題') });
  const noteId = store.addBlock('affine:note', {}, pageId);
  const paragraphId = store.addBlock('affine:paragraph', {}, noteId);

  store.undo();

  // Undo は実際に走っている（骨組みの下は消える）
  expect(store.getBlock(noteId)).toBeFalsy();
  expect(store.getBlock(paragraphId)).toBeFalsy();

  // 骨組みは残る
  const pages = store.getBlocksByFlavour('affine:page');
  expect(pages).toHaveLength(1);
  expect(store.root?.id).toBe(pageId);
  expect(store.root?.flavour).toBe('affine:page');
});

test('骨組みの下のブロックは、これまでどおり Undo で消える', () => {
  const store = createStore();

  const pageId = store.addBlock('affine:page', { title: new Text('題') });
  const noteId = store.addBlock('affine:note', {}, pageId);
  store.captureSync();
  store.resetHistory();

  const paragraphId = store.addBlock('affine:paragraph', {}, noteId);
  expect(store.getBlock(paragraphId)).toBeTruthy();

  store.undo();

  expect(store.getBlock(paragraphId)).toBeFalsy();
  expect(store.root?.id).toBe(pageId);
});

test('骨組みの題の編集は、これまでどおり Undo で戻る', () => {
  const store = createStore();

  store.addBlock('affine:page', { title: new Text('題') });
  store.captureSync();
  store.resetHistory();

  const root = store.root as RootBlockModel;
  root.props.title.insert('追記', 1);
  expect(root.props.title.toString()).toBe('題追記');

  store.undo();

  expect((store.root as RootBlockModel).props.title.toString()).toBe('題');
});

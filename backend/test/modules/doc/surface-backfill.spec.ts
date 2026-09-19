import * as Y from 'yjs';
import {
  markdownToYjsUpdate,
  surfaceBackfillUpdate,
} from '../../../src/modules/doc/yjs-doc-builder';

/**
 * #250: ⚠️ **すでに保存されているページにも surface を足す。**
 *
 * 組み立て側を直しても（`markdownToYjsUpdate`）、**すでに保存済みのページは
 * 直らない**。デモのシードや移行したページは、エッジレスで落ちたままになる
 * （レビュー指摘・2026-09-19）。
 *
 * CRDT なので、**差分を1つ足すだけ**でよい。既存の内容には触らない。
 */
const NATIVE_UNIQ_IDENTIFIER = '$blocksuite:internal:native$';

/** surface を持たない、昔の作りのページを再現する */
function legacyDoc(): Y.Doc {
  const doc = new Y.Doc();
  const blocks = doc.getMap('blocks');
  doc.transact(() => {
    const page = new Y.Map<unknown>();
    blocks.set('page-1', page);
    page.set('sys:id', 'page-1');
    page.set('sys:flavour', 'affine:page');
    page.set('sys:children', Y.Array.from(['note-1']));
    page.set('prop:title', new Y.Text('昔のページ'));

    const note = new Y.Map<unknown>();
    blocks.set('note-1', note);
    note.set('sys:id', 'note-1');
    note.set('sys:flavour', 'affine:note');
    note.set('sys:children', new Y.Array());
  });
  return doc;
}

const flavours = (doc: Y.Doc) =>
  [...doc.getMap('blocks').values()].map((v: any) => v.get('sys:flavour'));

describe('既存ページへの surface の補正（#250）', () => {
  test('⚠️ surface が無いページには、足すための差分を返す', () => {
    const doc = legacyDoc();

    const update = surfaceBackfillUpdate(doc);

    expect(update).not.toBeNull();
    Y.applyUpdate(doc, update!);
    expect(flavours(doc)).toContain('affine:surface');
  });

  test('⚠️ 足した surface は Boxed 形式', () => {
    const doc = legacyDoc();
    Y.applyUpdate(doc, surfaceBackfillUpdate(doc)!);

    const surface = [...doc.getMap('blocks').values()].find(
      (v: any) => v.get('sys:flavour') === 'affine:surface',
    ) as Y.Map<any>;
    const elements = surface.get('prop:elements');

    expect(elements.get('type')).toBe(NATIVE_UNIQ_IDENTIFIER);
    expect(elements.get('value')).toBeInstanceOf(Y.Map);
  });

  test('page の子に surface が入る', () => {
    const doc = legacyDoc();
    Y.applyUpdate(doc, surfaceBackfillUpdate(doc)!);

    const page = doc.getMap('blocks').get('page-1') as Y.Map<any>;
    const children = (page.get('sys:children') as Y.Array<string>).toArray();

    expect(children).toHaveLength(2);
    expect(children).toContain('note-1');
  });

  /**
   * ⚠️ **二重に足さない。** 何度流しても同じ結果になること。
   */
  test('すでに surface があるページには、何もしない', () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, markdownToYjsUpdate('題', '本文'));

    expect(surfaceBackfillUpdate(doc)).toBeNull();
  });

  test('page が無い壊れたページでは、何もしない', () => {
    expect(surfaceBackfillUpdate(new Y.Doc())).toBeNull();
  });

  test('既存の本文は失わない', () => {
    const doc = legacyDoc();
    Y.applyUpdate(doc, surfaceBackfillUpdate(doc)!);

    const page = doc.getMap('blocks').get('page-1') as Y.Map<any>;
    expect(page.get('prop:title').toString()).toBe('昔のページ');
    expect(flavours(doc)).toContain('affine:note');
  });
});

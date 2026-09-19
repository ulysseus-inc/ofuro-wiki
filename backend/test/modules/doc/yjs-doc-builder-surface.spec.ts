import * as Y from 'yjs';
import { markdownToYjsUpdate } from '../../../src/modules/doc/yjs-doc-builder';

/**
 * #250: ⚠️ **組み立てたページを、エッジレスでも開けるようにする。**
 *
 * 内部API（`/api/internal/docs/upsert`）で作ったページには
 * `affine:surface` が無く、エッジレスモードで開くと**真っ白になって落ちていた**
 * （2026-09-19 に PC とスマホの両方で確認）。
 *
 * ```
 * This doc is missing surface block in edgeless.
 * TypeError: Cannot read properties of undefined (reading 'children')
 * ```
 *
 * 画面（BlockSuite）は新規作成のたびに surface を作る。組み立て側も同じにする。
 */
const NATIVE_UNIQ_IDENTIFIER = '$blocksuite:internal:native$';

function build(markdown = '本文'): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, markdownToYjsUpdate('題', markdown));
  return doc;
}

const blockOf = (doc: Y.Doc, flavour: string) =>
  [...doc.getMap('blocks').entries()].find(
    ([, v]) => (v as Y.Map<any>).get('sys:flavour') === flavour,
  );

describe('組み立てたページの surface（#250）', () => {
  test('⚠️ affine:surface がある', () => {
    expect(blockOf(build(), 'affine:surface')).toBeDefined();
  });

  test('⚠️ page の子に surface が入っている', () => {
    const doc = build();
    const [surfaceId] = blockOf(doc, 'affine:surface')!;
    const [, page] = blockOf(doc, 'affine:page')!;

    const children = (page as Y.Map<any>).get('sys:children') as Y.Array<string>;

    expect(children.toArray()).toContain(surfaceId);
  });

  /**
   * ⚠️ **prop:elements は Boxed 形式でなければならない。**
   * 形が違うと画面は黙って無視し、**同じ症状（真っ白）になる**。
   * `{ type: '$blocksuite:internal:native$', value: Y.Map }` が正。
   */
  test('⚠️ prop:elements が Boxed 形式', () => {
    const doc = build();
    const [, surface] = blockOf(doc, 'affine:surface')!;

    const elements = (surface as Y.Map<any>).get('prop:elements');

    expect(elements).toBeInstanceOf(Y.Map);
    expect(elements.get('type')).toBe(NATIVE_UNIQ_IDENTIFIER);
    expect(elements.get('value')).toBeInstanceOf(Y.Map);
  });

  test('本文（note）はこれまでどおり page の子にいる', () => {
    const doc = build();
    const [noteId] = blockOf(doc, 'affine:note')!;
    const [, page] = blockOf(doc, 'affine:page')!;

    expect(
      ((page as Y.Map<any>).get('sys:children') as Y.Array<string>).toArray(),
    ).toContain(noteId);
  });
});

import * as Y from 'yjs';
import { IndexerService } from '../../../src/modules/search/indexer.service';
import type { PrismaService } from '../../../src/prisma.service';

/**
 * #248: ⚠️ **キャンバス（エッジレス）の文字も索引に載せる。**
 *
 * 索引はブロックだけを辿っていたため、`affine:surface` の `prop:elements` に
 * 入る**図形のラベル・線のラベル・フレーム名**が検索に出なかった
 * （2026-09-19 に実機で確認）。フロー図や体制図を描くと、
 * 一番探したい語がまるごと漏れる。
 *
 * ⚠️ **「キャンバスの文字は索引に入らない」は誤り。** 境目はブロックかどうかで、
 * キャンバス上のテキストは `affine:edgeless-text` ブロックになるため元から入る
 * （docs/search-index.md 3-b）。
 */
type ExtractedBlock = {
  blockId: string;
  blockType: string;
  content: string;
  additional?: string;
};

const extractBlocks = (service: IndexerService, doc: Y.Doc): ExtractedBlock[] =>
  (
    service as unknown as { extractBlocks(doc: Y.Doc): ExtractedBlock[] }
  ).extractBlocks(doc);

/** surface に要素を持つドキュメントを作る（実データと同じ形） */
function docWithSurface(
  elements: Array<Record<string, unknown>>,
  wrapInValue = false,
): Y.Doc {
  const doc = new Y.Doc();
  const blocks = doc.getMap('blocks');
  doc.transact(() => {
    const surface = new Y.Map<unknown>();
    blocks.set('surface-1', surface);
    surface.set('sys:flavour', 'affine:surface');

    const map = new Y.Map<unknown>();
    for (const [i, e] of elements.entries()) {
      const el = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(e)) {
        if (k === 'text' || k === 'title') {
          const t = new Y.Text();
          t.insert(0, String(v));
          el.set(k, t);
        } else {
          el.set(k, v);
        }
      }
      map.set(`el-${i}`, el);
    }

    // ⚠️ 実データでは prop:elements の下に value を挟む形もある。両方を扱えること
    if (wrapInValue) {
      const outer = new Y.Map<unknown>();
      outer.set('value', map);
      surface.set('prop:elements', outer);
    } else {
      surface.set('prop:elements', map);
    }
  });
  return doc;
}

describe('キャンバスの文字を索引に載せる（#248）', () => {
  const service = new IndexerService({} as unknown as PrismaService);

  test('⚠️ 図形のラベルを拾う', () => {
    const doc = docWithSurface([{ type: 'shape', text: '受注処理' }]);

    const found = extractBlocks(service, doc).map((b) => b.content);

    expect(found).toContain('受注処理');
  });

  test.each([
    ['線のラベル', { type: 'connector', text: '承認後' }, '承認後'],
    ['フレーム名', { type: 'frame', title: '全体像' }, '全体像'],
    ['旧い形式のキャンバス文字', { type: 'text', text: '補足メモ' }, '補足メモ'],
  ])('%s も拾う', (_name, element, expected) => {
    const doc = docWithSurface([element as Record<string, unknown>]);

    expect(extractBlocks(service, doc).map((b) => b.content)).toContain(
      expected,
    );
  });

  test('⚠️ 実データの value 入れ子でも拾う', () => {
    const doc = docWithSurface([{ type: 'shape', text: '入れ子の図形' }], true);

    expect(extractBlocks(service, doc).map((b) => b.content)).toContain(
      '入れ子の図形',
    );
  });

  /**
   * ⚠️ **blockId は実在するブロックでなければならない。**
   * 検索結果を押すと `openDoc({ blockIds: [blockId] })` に渡されるため、
   * 架空の ID を返すと**その場所へ移動できない**（レビュー指摘・2026-09-19）。
   * surface の要素はブロックではないので、**surface ブロック自身の ID** を返す。
   */
  test('⚠️ blockId は実在する surface ブロックの ID にする', () => {
    const doc = docWithSurface([{ type: 'shape', text: '受注処理' }]);

    const row = extractBlocks(service, doc).find((b) => b.content === '受注処理');

    expect(row?.blockId).toBe('surface-1');
  });

  /**
   * ⚠️ どの要素が当たったかは失わない。あとで画面へ渡せるよう additional に残す。
   */
  test('要素の ID は additional に残す', () => {
    const doc = docWithSurface([{ type: 'shape', text: '受注処理' }]);

    const row = extractBlocks(service, doc).find((b) => b.content === '受注処理');

    expect(JSON.parse(row!.additional!)).toEqual({ elementId: 'el-0' });
  });

  test('手描き（文字を持たない要素）は載せない', () => {
    const doc = docWithSurface([{ type: 'brush' }]);

    // 文字が無いので行は作られない
    expect(extractBlocks(service, doc)).toEqual([]);
  });

  /**
   * ⚠️ 要素ごとに1行にする。まとめると、検索結果でどの図形が当たったのか分からない。
   */
  test('要素ごとに別の行にする', () => {
    const doc = docWithSurface([
      { type: 'shape', text: '受注' },
      { type: 'shape', text: '出荷' },
    ]);

    const rows = extractBlocks(service, doc);

    expect(rows.map((r) => r.content).sort()).toEqual(['出荷', '受注']);
    // 行は要素ごとに分かれる（blockId は同じ surface を指す）
    expect(new Set(rows.map((r) => r.additional)).size).toBe(2);
  });
});

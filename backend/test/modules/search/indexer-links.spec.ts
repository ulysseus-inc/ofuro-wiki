import * as Y from 'yjs';
import { IndexerService } from '../../../src/modules/search/indexer.service';
import type { PrismaService } from '../../../src/prisma.service';

/**
 * #101: ⚠️ **ページ同士のリンクを索引に載せる。**
 *
 * 載せないとバックリンク（このページを参照しているページの一覧）が作れない。
 * 実データでの形は docs/search-index.md 3章。
 *
 * | 種類 | どこに入るか |
 * |---|---|
 * | 本文中のリンク | ブロックの文字（`prop:text`）の装飾 `reference.pageId` |
 * | 埋め込みページ | `affine:embed-linked-doc` / `affine:embed-synced-doc` の `prop:pageId` |
 * | 外部の埋め込み | `prop:url`。ページ参照ではないので載せない |
 */
type ExtractedBlock = {
  blockId: string;
  blockType: string;
  content: string;
  refDocId?: string;
  parentBlockId?: string;
  parentFlavour?: string;
  markdownPreview?: string;
};

const extractBlocks = (service: IndexerService, doc: Y.Doc): ExtractedBlock[] =>
  (
    service as unknown as { extractBlocks(doc: Y.Doc): ExtractedBlock[] }
  ).extractBlocks(doc);

/** 本文にリンクを1つ持つブロックを作る */
function docWithInlineLink(pageId: string, text = 'これは '): Y.Doc {
  const doc = new Y.Doc();
  const blocks = doc.getMap('blocks');
  const block = new Y.Map<unknown>();
  doc.transact(() => {
    blocks.set('block-1', block);
    block.set('sys:flavour', 'affine:paragraph');
    const content = new Y.Text();
    content.insert(0, text);
    content.insert(text.length, ' ', {
      reference: { type: 'LinkedPage', pageId },
    });
    block.set('prop:text', content);
  });
  return doc;
}

/** 埋め込みページのブロックを作る */
function docWithEmbed(flavour: string, props: Record<string, unknown>): Y.Doc {
  const doc = new Y.Doc();
  const blocks = doc.getMap('blocks');
  const block = new Y.Map<unknown>();
  doc.transact(() => {
    blocks.set('block-1', block);
    block.set('sys:flavour', flavour);
    for (const [k, v] of Object.entries(props)) block.set(k, v);
  });
  return doc;
}

describe('IndexerService — ページ同士のリンク（#101）', () => {
  let service: IndexerService;

  beforeEach(() => {
    service = new IndexerService({} as unknown as PrismaService);
  });

  it('⚠️ 本文中のリンク先を拾う', () => {
    const blocks = extractBlocks(service, docWithInlineLink('doc-b'));
    expect(blocks.map(b => b.refDocId)).toContain('doc-b');
  });

  it('⚠️ 埋め込みページのリンク先を拾う', () => {
    const blocks = extractBlocks(
      service,
      docWithEmbed('affine:embed-linked-doc', { 'prop:pageId': 'doc-c' })
    );
    expect(blocks.map(b => b.refDocId)).toContain('doc-c');
  });

  it('⚠️ 同期された埋め込みページも拾う', () => {
    const blocks = extractBlocks(
      service,
      docWithEmbed('affine:embed-synced-doc', { 'prop:pageId': 'doc-d' })
    );
    expect(blocks.map(b => b.refDocId)).toContain('doc-d');
  });

  it('外部の埋め込み（YouTube 等）はページ参照として拾わない', () => {
    const blocks = extractBlocks(
      service,
      docWithEmbed('affine:embed-youtube', {
        'prop:url': 'https://example.com/watch',
      })
    );
    expect(blocks.every(b => !b.refDocId)).toBe(true);
  });

  it('リンクが1つのブロックに2つあれば、両方を別の行にする', () => {
    const doc = new Y.Doc();
    const blocks = doc.getMap('blocks');
    const block = new Y.Map<unknown>();
    doc.transact(() => {
      blocks.set('block-1', block);
      block.set('sys:flavour', 'affine:paragraph');
      const content = new Y.Text();
      content.insert(0, 'A');
      content.insert(1, ' ', { reference: { type: 'LinkedPage', pageId: 'x' } });
      content.insert(2, 'B');
      content.insert(3, ' ', { reference: { type: 'LinkedPage', pageId: 'y' } });
      block.set('prop:text', content);
    });

    const refs = extractBlocks(service, doc)
      .map(b => b.refDocId)
      .filter(Boolean);
    expect(refs).toEqual(expect.arrayContaining(['x', 'y']));
  });

  it('文字が無くてもリンクだけのブロックは索引に載る', () => {
    const blocks = extractBlocks(
      service,
      docWithEmbed('affine:embed-linked-doc', { 'prop:pageId': 'doc-e' })
    );
    expect(blocks).toHaveLength(1);
  });

  /**
   * ⚠️ **リンクだけのブロックでも、画面に出す文を持たせる。**
   * 画面は `markdownPreview` が空の参照を**表示しない**
   * （`bi-directional-link-panel.tsx`: `if (!link.markdownPreview) return null`）。
   * リンクは1文字の埋め込みなので、文字だけを入れると空同然になる。
   */
  it('⚠️ リンクだけのブロックでも、表示用の文が入る', () => {
    const blocks = extractBlocks(service, docWithInlineLink('doc-b', ''));
    const link = blocks.find(b => b.refDocId === 'doc-b');
    expect((link?.markdownPreview ?? '').trim().length).toBeGreaterThan(0);
  });

  it('本文がある場合は、その文字を表示用に使う', () => {
    const blocks = extractBlocks(service, docWithInlineLink('doc-b', '参照の説明 '));
    const link = blocks.find(b => b.refDocId === 'doc-b');
    expect(link?.markdownPreview).toContain('参照の説明');
  });

  /**
   * ⚠️ 親の探索は、ブロック数に比例させる（総当たりにしない）。
   * 総当たりだと、ブロックが増えるほど**二乗**で遅くなる
   * （レビュー指摘・2026-09-17）。
   */
  it('親ブロックを拾う', () => {
    const doc = new Y.Doc();
    const blocks = doc.getMap('blocks');
    doc.transact(() => {
      const note = new Y.Map<unknown>();
      blocks.set('note-1', note);
      note.set('sys:flavour', 'affine:note');
      const children = new Y.Array<string>();
      children.push(['block-1']);
      note.set('sys:children', children);

      const child = new Y.Map<unknown>();
      blocks.set('block-1', child);
      child.set('sys:flavour', 'affine:paragraph');
      const text = new Y.Text();
      text.insert(0, ' ', { reference: { type: 'LinkedPage', pageId: 'doc-z' } });
      child.set('prop:text', text);
    });

    const link = extractBlocks(service, doc).find(b => b.refDocId === 'doc-z');
    expect(link?.parentBlockId).toBe('note-1');
    expect(link?.parentFlavour).toBe('affine:note');
  });

  it('⚠️ ブロックが多くても現実的な時間で終わる（総当たりにしない）', () => {
    const doc = new Y.Doc();
    const blocks = doc.getMap('blocks');
    doc.transact(() => {
      // 1000ブロック。総当たりだと100万回の突き合わせになる
      for (let i = 0; i < 1000; i++) {
        const block = new Y.Map<unknown>();
        blocks.set(`block-${i}`, block);
        block.set('sys:flavour', 'affine:paragraph');
        const text = new Y.Text();
        text.insert(0, `本文${i}`);
        block.set('prop:text', text);
      }
    });

    const started = Date.now();
    const result = extractBlocks(service, doc);
    const elapsed = Date.now() - started;

    expect(result.length).toBe(1000);
    expect(elapsed).toBeLessThan(1000);
  });
});

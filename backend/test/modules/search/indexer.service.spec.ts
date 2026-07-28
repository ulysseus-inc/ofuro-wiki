import * as Y from 'yjs';
import { IndexerService } from '../../../src/modules/search/indexer.service';
import type { PrismaService } from '../../../src/prisma.service';

/**
 * #91: データベースブロック（affine:database）の中身が全文検索に載らない問題の回帰テスト。
 *
 * private メソッドを直接呼ぶ代わりに、実際に使われる extractBlocks 経由で検証する。
 */
type ExtractedBlock = { blockId: string; blockType: string; content: string };

const extractBlocks = (service: IndexerService, doc: Y.Doc): ExtractedBlock[] =>
  (
    service as unknown as {
      extractBlocks(doc: Y.Doc): ExtractedBlock[];
    }
  ).extractBlocks(doc);

/** ブロックを1つ持つ Y.Doc を作る */
const createDoc = (
  blockId: string,
  flavour: string,
  props: Record<string, unknown>
): Y.Doc => {
  const doc = new Y.Doc();
  const blocks = doc.getMap('blocks');
  const block = new Y.Map<unknown>();

  doc.transact(() => {
    blocks.set(blockId, block);
    block.set('sys:flavour', flavour);
    for (const [key, value] of Object.entries(props)) {
      block.set(key, value);
    }
  });

  return doc;
};

describe('IndexerService — ブロックからのテキスト抽出', () => {
  let service: IndexerService;

  beforeEach(() => {
    // extractBlocks / extractDatabaseText は Prisma を使わないため、依存はダミーで足りる
    service = new IndexerService({} as unknown as PrismaService);
  });

  describe('通常のブロック（従来の挙動を壊していないこと）', () => {
    it('段落の prop:text を拾う', () => {
      const text = new Y.Text();
      text.insert(0, '就業規則について');
      const doc = createDoc('b1', 'affine:paragraph', { 'prop:text': text });

      const blocks = extractBlocks(service, doc);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].content).toBe('就業規則について');
      expect(blocks[0].blockType).toBe('affine:paragraph');
    });

    it('中身が無いブロックは登録しない', () => {
      const doc = createDoc('b1', 'affine:divider', {});

      expect(extractBlocks(service, doc)).toHaveLength(0);
    });
  });

  describe('#91 データベースブロック', () => {
    /**
     * prop:cells / prop:columns は素の JS オブジェクトとして Yjs に入る場合と、
     * Y.Map として入る場合があるため、両方を検証する。
     */
    const columns = [
      { id: 'col-title', type: 'title', name: '項目', data: {} },
      { id: 'col-owner', type: 'rich-text', name: '担当者', data: {} },
      {
        id: 'col-status',
        type: 'select',
        name: 'ステータス',
        data: {
          options: [
            { id: 'opt-1', value: '運用中' },
            { id: 'opt-2', value: '廃止' },
          ],
        },
      },
      {
        id: 'col-tags',
        type: 'multi-select',
        name: 'タグ',
        data: {
          options: [
            { id: 'tag-1', value: '経理' },
            { id: 'tag-2', value: '総務' },
          ],
        },
      },
      { id: 'col-date', type: 'date', name: '改訂日', data: {} },
      { id: 'col-num', type: 'number', name: '版数', data: {} },
      { id: 'col-done', type: 'checkbox', name: '完了', data: {} },
      { id: 'col-prog', type: 'progress', name: '進捗', data: {} },
    ];

    // フロントエンドは date-fns の parse でローカル深夜のタイムスタンプを保存する。
    // UTC 基準で整形すると JST では1日ずれるため、ローカル深夜の値でテストする。
    const localMidnight = new Date(2026, 6, 28, 0, 0, 0).getTime();

    const cells = {
      'row-1': {
        'col-owner': { columnId: 'col-owner', value: '田中太郎' },
        'col-status': { columnId: 'col-status', value: 'opt-1' },
        'col-tags': { columnId: 'col-tags', value: ['tag-1', 'tag-2'] },
        'col-date': { columnId: 'col-date', value: localMidnight },
        'col-num': { columnId: 'col-num', value: 12345 },
        'col-done': { columnId: 'col-done', value: true },
        'col-prog': { columnId: 'col-prog', value: 0 },
      },
    };

    it('素のオブジェクトで格納されたセルの値を拾う', () => {
      const title = new Y.Text();
      title.insert(0, '規程一覧');
      const doc = createDoc('db1', 'affine:database', {
        'prop:title': title,
        'prop:columns': columns,
        'prop:cells': cells,
      });

      const blocks = extractBlocks(service, doc);
      expect(blocks).toHaveLength(1);
      const { content } = blocks[0];

      // データベースのタイトル（従来から拾えていた部分）
      expect(content).toContain('規程一覧');
      // 列名
      expect(content).toContain('担当者');
      expect(content).toContain('ステータス');
      // リッチテキストのセル
      expect(content).toContain('田中太郎');
      // select は選択肢 ID ではなく表示名に解決する
      expect(content).toContain('運用中');
      expect(content).not.toContain('opt-1');
      // multi-select も表示名に解決する
      expect(content).toContain('経理');
      expect(content).toContain('総務');
      // 日付は「画面に表示されているとおりの日付」で検索できること。
      // UTC 基準で整形していると 2026-07-27 になり、この検証で落ちる。
      expect(content).toContain('2026-07-28');
      // 数値はそのまま
      expect(content).toContain('12345');
      // チェックボックスの true/false は検索語にならないので含めない
      expect(content).not.toContain('true');
      expect(content).not.toContain('false');
      // 進捗（0〜100）は検索ノイズになるだけなので含めない
      expect(content).not.toMatch(/(^|\s)0(\s|$)/);
    });

    it('日付をローカルタイムゾーン基準で整形する（UTCとずれる場合は両方含める）', () => {
      // JST の 2026-07-28 00:00 は UTC では 2026-07-27 15:00。
      // サーバーとブラウザの TZ が異なる場合に備え、両方を検索対象にする。
      const localMidnightDate = new Date(2026, 6, 28, 0, 0, 0);
      const doc = createDoc('db1', 'affine:database', {
        'prop:columns': [
          { id: 'col-date', type: 'date', name: '改訂日', data: {} },
        ],
        'prop:cells': {
          'row-1': {
            'col-date': {
              columnId: 'col-date',
              value: localMidnightDate.getTime(),
            },
          },
        },
      });

      const content = extractBlocks(service, doc)[0]?.content ?? '';

      expect(content).toContain('2026-07-28');
      const utcDate = localMidnightDate.toISOString().slice(0, 10);
      if (utcDate !== '2026-07-28') {
        expect(content).toContain(utcDate);
      }
    });

    it('不正な日付値では日付を出力しない', () => {
      const doc = createDoc('db1', 'affine:database', {
        'prop:columns': [
          { id: 'col-date', type: 'date', name: '改訂日', data: {} },
        ],
        'prop:cells': {
          'row-1': {
            'col-date': { columnId: 'col-date', value: Number.NaN },
          },
        },
      });

      // 列名だけが残り、例外は起きない
      const content = extractBlocks(service, doc)[0]?.content ?? '';
      expect(content).toBe('改訂日');
    });

    it('Y.Map / Y.Text で格納されたセルの値も拾う', () => {
      const doc = new Y.Doc();
      const blocks = doc.getMap('blocks');
      const block = new Y.Map<unknown>();

      const yColumns = new Y.Array<unknown>();
      const yCells = new Y.Map<unknown>();
      const yRow = new Y.Map<unknown>();
      const yCell = new Y.Map<unknown>();
      const richText = new Y.Text();

      doc.transact(() => {
        blocks.set('db1', block);
        block.set('sys:flavour', 'affine:database');
        block.set('prop:columns', yColumns);
        block.set('prop:cells', yCells);

        yColumns.push([
          { id: 'col-owner', type: 'rich-text', name: '担当者', data: {} },
        ]);

        yCells.set('row-1', yRow);
        yRow.set('col-owner', yCell);
        yCell.set('columnId', 'col-owner');
        yCell.set('value', richText);
        richText.insert(0, '鈴木花子');
      });

      const content = extractBlocks(service, doc)[0]?.content ?? '';

      expect(content).toContain('担当者');
      expect(content).toContain('鈴木花子');
    });

    it('列やセルが空でも落ちない', () => {
      const doc = createDoc('db1', 'affine:database', {
        'prop:columns': [],
        'prop:cells': {},
      });

      expect(() => extractBlocks(service, doc)).not.toThrow();
      expect(extractBlocks(service, doc)).toHaveLength(0);
    });

    it('壊れた構造でも例外を投げない', () => {
      const doc = createDoc('db1', 'affine:database', {
        'prop:columns': 'これは配列ではない',
        'prop:cells': [null, undefined, 42],
      });

      expect(() => extractBlocks(service, doc)).not.toThrow();
    });
  });
});

import * as Y from 'yjs';
import {
  diffFolders,
  FolderChangeKind,
  readFolders,
} from '../../../src/modules/audit/folder-diff';

/**
 * #283: フォルダの差分を操作に直す（docs/logging.md 2.12）。
 *
 * 文書の形は frontend の YjsTableAdapter と同じに作る
 * （項目ごとに Y.Map。消すと id 以外が消えて `$$DELETED: true` が残る）。
 */
describe('フォルダの差分 (#283)', () => {
  let doc: Y.Doc;

  function put(id: string, fields: Record<string, string | null>) {
    doc.transact(() => {
      const map = doc.getMap(id);
      map.set('id', id);
      for (const [k, v] of Object.entries(fields)) {
        map.set(k, v);
      }
      map.delete('$$DELETED');
    });
  }

  function folder(id: string, name: string, parentId: string | null = null, index = 'a0') {
    put(id, { type: 'folder', data: name, parentId, index });
  }

  function item(id: string, docId: string, parentId: string, index = 'a0', type = 'doc') {
    put(id, { type, data: docId, parentId, index });
  }

  function remove(...ids: string[]) {
    doc.transact(() => {
      for (const id of ids) {
        const map = doc.getMap(id);
        for (const k of ['id', 'type', 'data', 'parentId', 'index']) {
          map.delete(k);
        }
        map.set('$$DELETED', true);
      }
    });
  }

  /** 操作の前後で、届いた差分だけを取り出す（サーバーに届くのと同じ形） */
  function change(op: () => void) {
    const before = Y.encodeStateAsUpdate(doc);
    const vector = Y.encodeStateVector(doc);
    op();
    const update = Y.encodeStateAsUpdate(doc, vector);
    return diffFolders(before, update);
  }

  beforeEach(() => {
    doc = new Y.Doc();
  });

  it('フォルダを作る', () => {
    const changes = change(() => folder('f1', '設計'));

    expect(changes).toEqual([
      { kind: FolderChangeKind.Create, node: expect.objectContaining({ id: 'f1', data: '設計' }) },
    ]);
  });

  it('名前を変える（前の名前も分かる）', () => {
    folder('f1', '設計');

    const changes = change(() => doc.getMap('f1').set('data', '設計書'));

    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe(FolderChangeKind.Rename);
    expect(changes[0].before?.data).toBe('設計');
    expect(changes[0].node.data).toBe('設計書');
  });

  it('【重要】並べ替え（index だけの変更）は記録しない', () => {
    folder('f1', '設計', null, 'a0');
    folder('f2', '調査', null, 'a1');
    item('i1', 'doc-1', 'f1', 'a0');

    const changes = change(() => {
      doc.getMap('f1').set('index', 'a2');
      doc.getMap('i1').set('index', 'a5');
    });

    expect(changes).toEqual([]);
  });

  it('フォルダを別のフォルダへ移す', () => {
    folder('f1', '設計');
    folder('f2', '調査');

    const changes = change(() => {
      doc.getMap('f2').set('parentId', 'f1');
      doc.getMap('f2').set('index', 'a3');
    });

    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe(FolderChangeKind.Move);
    expect(changes[0].before?.parentId).toBeNull();
    expect(changes[0].node.parentId).toBe('f1');
  });

  it('名前の変更と移動が同じ差分で届いたら、両方返す', () => {
    folder('f1', '設計');
    folder('f2', '調査');

    const changes = change(() => {
      doc.getMap('f2').set('data', '調査メモ');
      doc.getMap('f2').set('parentId', 'f1');
    });

    expect(changes.map((c) => c.kind)).toEqual([
      FolderChangeKind.Rename,
      FolderChangeKind.Move,
    ]);
  });

  it('ページを入れる・別のフォルダへ移す・出す', () => {
    folder('f1', '設計');
    folder('f2', '調査');

    expect(change(() => item('i1', 'doc-1', 'f1'))[0]).toMatchObject({
      kind: FolderChangeKind.ItemAdd,
      node: { data: 'doc-1', parentId: 'f1', type: 'doc' },
    });
    expect(change(() => doc.getMap('i1').set('parentId', 'f2'))[0]).toMatchObject({
      kind: FolderChangeKind.ItemMove,
      before: { parentId: 'f1' },
      node: { parentId: 'f2' },
    });
    expect(change(() => remove('i1'))[0]).toMatchObject({
      kind: FolderChangeKind.ItemRemove,
      node: { data: 'doc-1', parentId: 'f2' },
    });
  });

  it('タグ・コレクションを入れても中身の出し入れとして残す', () => {
    folder('f1', '設計');

    const changes = change(() => item('i1', 'tag-1', 'f1', 'a0', 'tag'));

    expect(changes[0]).toMatchObject({
      kind: FolderChangeKind.ItemAdd,
      node: { type: 'tag', data: 'tag-1' },
    });
  });

  it('【重要】フォルダを中身ごと消すと、親の 1 件にまとめて数を持つ', () => {
    folder('f1', '設計');
    folder('f2', '下書き', 'f1');
    item('i1', 'doc-1', 'f1');
    item('i2', 'doc-2', 'f2');
    folder('f3', '調査');

    const changes = change(() => remove('f1', 'f2', 'i1', 'i2'));

    expect(changes).toEqual([
      {
        kind: FolderChangeKind.Delete,
        node: expect.objectContaining({ id: 'f1', data: '設計' }),
        items: 3,
      },
    ]);
  });

  it('【重要】親を消したあとの差分で子が消えても、1 件ずつ記録しない', () => {
    // 画面は親を消してから子を順に消す。差分が分かれて届くことがある
    folder('f1', '設計');
    item('i1', 'doc-1', 'f1');
    folder('f2', '下書き', 'f1');

    expect(change(() => remove('f1'))).toHaveLength(1);
    expect(change(() => remove('i1', 'f2'))).toEqual([]);
  });

  it('消えたものは、消える前の値で返す（名前を残すため）', () => {
    folder('f1', '設計');

    const [deleted] = change(() => remove('f1'));

    expect(deleted.node.data).toBe('設計');
    expect(deleted.items).toBe(0);
  });

  it('元から消えていた項目は無いものとして扱う', () => {
    folder('f1', '設計');
    remove('f1');

    expect(change(() => folder('f2', '調査'))).toHaveLength(1);
  });

  it('readFolders は消えていない項目だけ返す', () => {
    folder('f1', '設計');
    folder('f2', '調査');
    remove('f2');

    const nodes = readFolders(Y.encodeStateAsUpdate(doc));

    expect([...nodes.keys()]).toEqual(['f1']);
    expect(nodes.get('f1')).toEqual({
      id: 'f1',
      type: 'folder',
      data: '設計',
      parentId: null,
      index: 'a0',
    });
  });
});

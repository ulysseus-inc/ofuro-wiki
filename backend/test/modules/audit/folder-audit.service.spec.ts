import * as Y from 'yjs';
import { FolderAuditService } from '../../../src/modules/audit/folder-audit.service';

/** #283: フォルダの操作を監査ログの形にする（docs/logging.md 2.4.1・2.12） */
describe('フォルダの操作の記録 (#283)', () => {
  let audit: { record: jest.Mock };
  let service: FolderAuditService;
  let doc: Y.Doc;

  const actor = { id: 'user-1', email: 'user-1@example.com', name: '山田 太郎' };

  function folder(id: string, name: string, parentId: string | null = null) {
    const map = doc.getMap(id);
    doc.transact(() => {
      map.set('id', id);
      map.set('type', 'folder');
      map.set('data', name);
      map.set('parentId', parentId);
      map.set('index', 'a0');
    });
  }

  function item(id: string, docId: string, parentId: string) {
    const map = doc.getMap(id);
    doc.transact(() => {
      map.set('id', id);
      map.set('type', 'doc');
      map.set('data', docId);
      map.set('parentId', parentId);
      map.set('index', 'a0');
    });
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

  /** 操作を記録させ、記録された 1 件目を返す */
  async function recordOf(op: () => void) {
    const before = Y.encodeStateAsUpdate(doc);
    const vector = Y.encodeStateVector(doc);
    op();
    const update = Y.encodeStateAsUpdate(doc, vector);
    audit.record.mockClear();
    await service.record({ actor, workspaceId: 'ws-1', ip: '10.0.0.1', before, update });
    return audit.record.mock.calls.map((c) => c[0]);
  }

  beforeEach(() => {
    doc = new Y.Doc();
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new FolderAuditService(audit as any);
  });

  it('作成: 対象はフォルダ、名前を値で残す', async () => {
    const [entry] = await recordOf(() => folder('f1', '設計'));

    expect(entry).toEqual({
      action: 'folder.create',
      actor,
      targetType: 'folder',
      targetId: 'f1',
      targetName: '設計',
      workspaceId: 'ws-1',
      ip: '10.0.0.1',
    });
  });

  it('名前の変更: before / after に名前', async () => {
    folder('f1', '設計');

    const [entry] = await recordOf(() => doc.getMap('f1').set('data', '設計書'));

    expect(entry).toMatchObject({
      action: 'folder.rename',
      targetName: '設計書',
      detail: { before: { name: '設計' }, after: { name: '設計書' } },
    });
  });

  it('移動: before / after に親の名前。最上位は null', async () => {
    folder('f1', '設計');
    folder('f2', '調査');

    const [entry] = await recordOf(() => doc.getMap('f2').set('parentId', 'f1'));

    expect(entry).toMatchObject({
      action: 'folder.move',
      targetName: '調査',
      detail: { before: { parent: null }, after: { parent: '設計' } },
    });
  });

  it('削除: 消えた名前と、一緒に消えた中身の数', async () => {
    folder('f1', '設計');
    item('i1', 'doc-1', 'f1');

    const entries = await recordOf(() => remove('f1', 'i1'));

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'folder.delete',
      targetId: 'f1',
      targetName: '設計',
      detail: { meta: { items: 1 } },
    });
  });

  it('ページの出し入れ: 対象はページ、フォルダの名前は meta', async () => {
    folder('f1', '設計');

    const [added] = await recordOf(() => item('i1', 'doc-1', 'f1'));
    const [removed] = await recordOf(() => remove('i1'));

    expect(added).toMatchObject({
      action: 'folder.item.add',
      targetType: 'doc',
      targetId: 'doc-1',
      detail: { meta: { folder: '設計', type: 'doc' } },
    });
    expect(removed).toMatchObject({
      action: 'folder.item.remove',
      targetId: 'doc-1',
      detail: { meta: { folder: '設計', type: 'doc' } },
    });
  });

  it('ページの移動: before / after にフォルダの名前', async () => {
    folder('f1', '設計');
    folder('f2', '調査');
    item('i1', 'doc-1', 'f1');

    const [entry] = await recordOf(() => doc.getMap('i1').set('parentId', 'f2'));

    expect(entry).toMatchObject({
      action: 'folder.item.move',
      targetId: 'doc-1',
      detail: { before: { folder: '設計' }, after: { folder: '調査' } },
    });
  });

  it('同じ差分で作ったフォルダへ入れても、フォルダの名前が分かる', async () => {
    const entries = await recordOf(() => {
      folder('f1', '設計');
      item('i1', 'doc-1', 'f1');
    });

    expect(entries.map((e) => e.action)).toEqual(['folder.create', 'folder.item.add']);
    expect(entries[1].detail.meta.folder).toBe('設計');
  });

  it('【重要】壊れた差分でも例外を外へ出さない（同期を止めない）', async () => {
    await expect(
      service.record({
        actor,
        workspaceId: 'ws-1',
        before: new Uint8Array([1, 2, 3]),
        update: new Uint8Array([9, 9]),
      }),
    ).resolves.toBeUndefined();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

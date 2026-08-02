import {
  DocEditAggregator,
  EDIT_WINDOW_MS,
} from '../../../src/modules/audit/doc-edit-aggregator';

describe('ドキュメント編集の集約 (#90)', () => {
  let audit: { record: jest.Mock };
  let aggregator: DocEditAggregator;

  const edit = (docId = 'doc-1', actorId = 'user-1') =>
    aggregator.track({
      actorId,
      actorEmail: `${actorId}@example.com`,
      actorName: '山田 太郎',
      workspaceId: 'ws-1',
      docId,
    });

  beforeEach(() => {
    jest.useFakeTimers();
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    aggregator = new DocEditAggregator(audit as any);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // 打鍵のたびに1件記録すると、10人が1時間編集しただけで数万行になる
  it('窓の中の編集は1件にまとまる', async () => {
    for (let i = 0; i < 50; i++) edit();
    expect(audit.record).not.toHaveBeenCalled();

    jest.advanceTimersByTime(EDIT_WINDOW_MS);
    await Promise.resolve();

    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][0]).toMatchObject({
      action: 'doc.update',
      targetType: 'doc',
      targetId: 'doc-1',
      workspaceId: 'ws-1',
    });
    expect(audit.record.mock.calls[0][0].detail.meta.updates).toBe(50);
  });

  it('ドキュメントが違えば別の記録になる', async () => {
    edit('doc-1');
    edit('doc-2');
    jest.advanceTimersByTime(EDIT_WINDOW_MS);
    await Promise.resolve();
    expect(audit.record).toHaveBeenCalledTimes(2);
  });

  it('利用者が違えば別の記録になる', async () => {
    edit('doc-1', 'user-1');
    edit('doc-1', 'user-2');
    jest.advanceTimersByTime(EDIT_WINDOW_MS);
    await Promise.resolve();
    expect(audit.record).toHaveBeenCalledTimes(2);
  });

  it('窓が閉じた後の編集は次の窓になる', async () => {
    edit();
    jest.advanceTimersByTime(EDIT_WINDOW_MS);
    await Promise.resolve();
    edit();
    jest.advanceTimersByTime(EDIT_WINDOW_MS);
    await Promise.resolve();
    expect(audit.record).toHaveBeenCalledTimes(2);
  });

  // 再起動のたびに編集の記録が消えると、監査ログとして信用できない
  it('停止時に、開いている窓をすべて記録する', async () => {
    edit('doc-1');
    edit('doc-2');
    await aggregator.onModuleDestroy();
    expect(audit.record).toHaveBeenCalledTimes(2);
  });
});

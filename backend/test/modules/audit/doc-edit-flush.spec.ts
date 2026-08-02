import { DocEditAggregator } from '../../../src/modules/audit/doc-edit-aggregator';

/**
 * #90: 停止時に集約中の編集を書き出せているか。
 * これが動かないと、再起動のたびに最大15分ぶんの記録が黙って消える。
 */
describe('停止時の書き出し (#90)', () => {
  it('OnModuleDestroy を実装している（Nest から呼ばれる契約）', () => {
    const aggregator = new DocEditAggregator({ record: jest.fn() } as any);
    expect(typeof aggregator.onModuleDestroy).toBe('function');
  });

  it('開いている窓をすべて記録してから終わる', async () => {
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const aggregator = new DocEditAggregator(audit as any);

    for (const docId of ['doc-1', 'doc-2', 'doc-3']) {
      aggregator.track({
        actorId: 'u1',
        actorEmail: 'u1@example.com',
        workspaceId: 'ws-1',
        docId,
      });
    }

    await aggregator.onModuleDestroy();

    expect(audit.record).toHaveBeenCalledTimes(3);
  });

  it('二重に呼ばれても重複して記録しない', async () => {
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const aggregator = new DocEditAggregator(audit as any);
    aggregator.track({
      actorId: 'u1',
      actorEmail: 'u1@example.com',
      workspaceId: 'ws-1',
      docId: 'doc-1',
    });

    await aggregator.onModuleDestroy();
    await aggregator.onModuleDestroy();

    expect(audit.record).toHaveBeenCalledTimes(1);
  });
});

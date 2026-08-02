import {
  recordDenial,
  resetDenialWindow,
  denialWindowSize,
} from '../../src/common/guards/audit-denial.util';

/**
 * #90: 認証済みの利用者は拒否される操作を連打できる。
 * 1回ごとに記録すると監査ログを一方的に膨らませられる（保持3年）。
 */
describe('認可拒否の記録 (#90)', () => {
  let audit: { record: jest.Mock };

  const context = (userId: string) =>
    ({
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: userId, email: `${userId}@example.com` },
          ip: '10.0.0.1',
          method: 'POST',
          url: '/api/admin',
          headers: {},
        }),
      }),
    }) as any;

  beforeEach(() => {
    resetDenialWindow();
    audit = { record: jest.fn().mockResolvedValue(undefined) };
  });

  it('拒否を記録する', async () => {
    await recordDenial(audit as any, context('u1'), 'admin.denied');
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  // 連打しても増え続けない
  it('同じ拒否の繰り返しは1回だけ記録する', async () => {
    for (let i = 0; i < 50; i++) {
      await recordDenial(audit as any, context('u1'), 'admin.denied');
    }
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  // まとめすぎて別人の試行が消えると、検知材料にならない
  it('利用者が違えば別々に記録する', async () => {
    await recordDenial(audit as any, context('u1'), 'admin.denied');
    await recordDenial(audit as any, context('u2'), 'admin.denied');
    expect(audit.record).toHaveBeenCalledTimes(2);
  });

  it('対象が違えば別々に記録する', async () => {
    await recordDenial(audit as any, context('u1'), 'workspace.denied', {
      workspaceId: 'ws-1',
    });
    await recordDenial(audit as any, context('u1'), 'workspace.denied', {
      workspaceId: 'ws-2',
    });
    expect(audit.record).toHaveBeenCalledTimes(2);
  });

  // キーには利用者が指定できる値（workspaceId）が入る。
  // 「期限切れだけ削除」だと、毎回違う値を送られると1件も消えず増え続ける
  it('毎回違う対象を送られてもマップが際限なく増えない', async () => {
    for (let i = 0; i < 5000; i++) {
      await recordDenial(audit as any, context('u1'), 'workspace.denied', {
        workspaceId: `ws-${i}`,
      });
    }
    expect(denialWindowSize()).toBeLessThanOrEqual(1001);
  });
});

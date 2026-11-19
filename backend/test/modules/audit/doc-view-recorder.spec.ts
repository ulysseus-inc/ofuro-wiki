import {
  DocViewRecorder,
  DOC_VIEW_SETTING_KEY,
  SETTING_CACHE_MS,
} from '../../../src/modules/audit/doc-view-recorder';
import { WorkspaceKind } from '../../../src/common/workspace-kind';

/** #100: ページの閲覧の記録（docs/logging.md 2.11） */
describe('ページの閲覧の記録 (#100)', () => {
  let audit: { record: jest.Mock };
  let prisma: any;
  let recorder: DocViewRecorder;

  const DAY = 24 * 60 * 60 * 1000;

  const view = (docId = 'doc-1', actorId = 'user-1', workspaceId = 'ws-1') =>
    recorder.record({
      actorId,
      actorEmail: `${actorId}@example.com`,
      actorName: '山田 太郎',
      workspaceId,
      docId,
      ip: '10.0.0.1',
    });

  /** 管理画面で「記録する」にした状態 */
  function enable(value = 'true') {
    prisma.serverSetting.findUnique.mockResolvedValue({ value });
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date(2026, 10, 6, 10, 0, 0) });
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      serverSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      workspace: {
        findUnique: jest.fn().mockResolvedValue({ kind: WorkspaceKind.Shared }),
      },
      auditLog: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    recorder = new DocViewRecorder(prisma, audit as any);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('【重要】既定（設定が無い）では記録しない', async () => {
    await view();

    expect(audit.record).not.toHaveBeenCalled();
    expect(prisma.serverSetting.findUnique).toHaveBeenCalledWith({
      where: { key: DOC_VIEW_SETTING_KEY },
    });
  });

  it("'true' 以外の値では記録しない", async () => {
    enable('yes');

    await view();

    expect(audit.record).not.toHaveBeenCalled();
  });

  it('記録するにすると、共有での閲覧を doc.view で残す', async () => {
    enable();

    await view();

    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][0]).toMatchObject({
      action: 'doc.view',
      actor: { id: 'user-1', email: 'user-1@example.com', name: '山田 太郎' },
      targetType: 'doc',
      targetId: 'doc-1',
      workspaceId: 'ws-1',
      ip: '10.0.0.1',
    });
  });

  it('【重要】同じ日の 2 回目以降は記録しない', async () => {
    enable();

    await view();
    await view();
    await view();

    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('同時に届いても 1 件だけ', async () => {
    enable();

    await Promise.all([view(), view(), view()]);

    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('ページ・利用者が違えば別に記録する', async () => {
    enable();

    await view('doc-1', 'user-1');
    await view('doc-2', 'user-1');
    await view('doc-1', 'user-2');

    expect(audit.record).toHaveBeenCalledTimes(3);
  });

  it('次の日は、また記録する', async () => {
    enable();
    await view();

    jest.setSystemTime(Date.now() + DAY);
    await view();

    expect(audit.record).toHaveBeenCalledTimes(2);
  });

  it('【重要】再起動の直後でも、今日の記録が DB にあれば記録しない', async () => {
    enable();
    prisma.auditLog.findFirst.mockResolvedValue({ id: 'already' });

    await view();

    expect(audit.record).not.toHaveBeenCalled();
    // 今日（サーバーの時刻帯の 0 時）以降の、同じ人・同じページの doc.view を引く
    expect(prisma.auditLog.findFirst.mock.calls[0][0].where).toEqual({
      action: 'doc.view',
      actorId: 'user-1',
      targetId: 'doc-1',
      workspaceId: 'ws-1',
      createdAt: { gte: new Date(2026, 10, 6, 0, 0, 0) },
    });
  });

  it('【重要】プライベートでの閲覧は記録しない', async () => {
    enable();
    prisma.workspace.findUnique.mockResolvedValue({ kind: WorkspaceKind.Private });

    await view();

    expect(audit.record).not.toHaveBeenCalled();
  });

  it('ワークスペースが無ければ記録しない', async () => {
    enable();
    prisma.workspace.findUnique.mockResolvedValue(null);

    await view();

    expect(audit.record).not.toHaveBeenCalled();
  });

  it('設定は 1 分覚えておき、過ぎたら引き直す', async () => {
    await view('doc-1');
    enable();

    await view('doc-2');
    expect(audit.record).not.toHaveBeenCalled();

    jest.setSystemTime(Date.now() + SETTING_CACHE_MS + 1);
    await view('doc-3');
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('管理画面で変えたら（forgetSetting）、次の閲覧から効く', async () => {
    await view('doc-1');
    enable();

    recorder.forgetSetting();
    await view('doc-2');

    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('【重要】DB の失敗で記録できなかったら、次に開いたときにまた試す', async () => {
    enable();
    prisma.auditLog.findFirst.mockRejectedValueOnce(new Error('db down'));

    await view();
    await view();

    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('DB の失敗を外へ出さない（ページを開く処理を止めない）', async () => {
    prisma.serverSetting.findUnique.mockRejectedValue(new Error('db down'));

    await expect(view()).resolves.toBeUndefined();
  });
});

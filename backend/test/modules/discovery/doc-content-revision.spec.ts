import {
  CONTENT_BUMP_INTERVAL_MS,
  DocContentRevisionService,
} from '../../../src/modules/discovery/doc-content-revision.service';

/**
 * 本文の保存でも一覧の版数を上げる。ただしワークスペースごとに 30 秒に 1 回まで
 * （docs/discovery-stage3-comparison.md 7.10.6）。
 * 上げないと、本文だけ書き換えたページの更新日時が、一覧でいつまでも古いままになる
 */
describe('本文の保存での版数（間引き）', () => {
  let bump: jest.Mock;
  let service: DocContentRevisionService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-11T09:00:00Z'));
    bump = jest.fn().mockResolvedValue(undefined);
    service = new DocContentRevisionService({ bump } as never);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('30 秒', () => {
    expect(CONTENT_BUMP_INTERVAL_MS).toBe(30_000);
  });

  it('最初の保存で、すぐ上げる', () => {
    service.touch('ws-1');

    expect(bump).toHaveBeenCalledTimes(1);
    expect(bump).toHaveBeenCalledWith('ws-1', 'doc-content');
  });

  it('30 秒以内の保存では、すぐには上げない', () => {
    service.touch('ws-1');
    jest.advanceTimersByTime(5_000);
    service.touch('ws-1');
    service.touch('ws-1');

    expect(bump).toHaveBeenCalledTimes(1);
  });

  it('【重要】30 秒以内に保存があれば、30 秒の終わりに 1 回だけ上げる（後追い）', () => {
    // 後追いが無いと、この間の保存は次に誰かが書くまで一覧に出ない
    service.touch('ws-1');
    jest.advanceTimersByTime(5_000);
    service.touch('ws-1');
    service.touch('ws-1');

    jest.advanceTimersByTime(24_999);
    expect(bump).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1);
    expect(bump).toHaveBeenCalledTimes(2);
  });

  it('30 秒の間に保存が無ければ、後追いはしない', () => {
    service.touch('ws-1');
    jest.advanceTimersByTime(60_000);

    expect(bump).toHaveBeenCalledTimes(1);
  });

  it('30 秒たってからの保存は、またすぐ上げる', () => {
    service.touch('ws-1');
    jest.advanceTimersByTime(30_000);
    service.touch('ws-1');

    expect(bump).toHaveBeenCalledTimes(2);
  });

  it('書き続けても、30 秒に 1 回を超えない', () => {
    // 1 秒ごとに 2 分間保存する
    for (let s = 0; s < 120; s++) {
      service.touch('ws-1');
      jest.advanceTimersByTime(1_000);
    }
    jest.advanceTimersByTime(30_000);

    // 0・30・60・90 秒と、最後の後追い
    expect(bump.mock.calls.length).toBeLessThanOrEqual(5);
    expect(bump.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('後追いの直後の保存は、また 30 秒の終わりに後追いで上げる', () => {
    service.touch('ws-1'); // 0 秒: すぐ上げる
    jest.advanceTimersByTime(10_000);
    service.touch('ws-1'); // 10 秒: 後追いを予約
    jest.advanceTimersByTime(20_000); // 30 秒: 後追いで上げる
    expect(bump).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(1_000);
    service.touch('ws-1'); // 31 秒: 後追いから 1 秒。すぐには上げない
    expect(bump).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(29_000); // 60 秒: 後追いから 30 秒で上げる
    expect(bump).toHaveBeenCalledTimes(3);
  });

  it('【重要】後追いのタイマーは、プロセスの終了を止めない（unref）', () => {
    // 終了の処理（onModuleDestroy）が呼ばれない起動（スクリプト等）でも、30 秒残らないように
    const spy = jest.spyOn(global, 'setTimeout');
    service.touch('ws-1');
    service.touch('ws-1');

    const timer = spy.mock.results[spy.mock.results.length - 1].value as NodeJS.Timeout;
    expect(timer.hasRef()).toBe(false);
    spy.mockRestore();
  });

  it('ワークスペースごとに数える', () => {
    service.touch('ws-1');
    service.touch('ws-2');

    expect(bump).toHaveBeenCalledWith('ws-1', 'doc-content');
    expect(bump).toHaveBeenCalledWith('ws-2', 'doc-content');
  });

  it('終了時に、待っている後追いを捨てる（タイマーを残さない）', () => {
    service.touch('ws-1');
    service.touch('ws-1');
    service.onModuleDestroy();

    jest.advanceTimersByTime(60_000);
    expect(bump).toHaveBeenCalledTimes(1);
  });
});

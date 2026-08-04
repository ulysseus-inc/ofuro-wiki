import { IntrusionDetectionService } from '../../../src/modules/security/intrusion-detection.service';
import { AttackCounterService } from '../../../src/modules/security/attack-counter.service';
import { loadAlertConfig, positiveInt } from '../../../src/modules/security/alert-config';

/**
 * #117: 検知バッチ（docs/intrusion-detection.md）。
 *
 * 実 DB は使わず、Prisma の呼び出しを差し替えて検証する。
 */

const NOW = new Date('2026-08-04T12:00:00.000Z');

function makePrisma(overrides: any = {}) {
  return {
    auditLog: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      ...overrides.auditLog,
    },
    user: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ email: 'admin@example.com' }]),
      ...overrides.user,
    },
  } as any;
}

function makeService(prisma: any, mail?: any, counter?: AttackCounterService) {
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const mailService = mail ?? {
    isEnabled: jest.fn().mockReturnValue(true),
    // 既定は「宛先1人に届いた」
    sendSecurityAlert: jest
      .fn()
      .mockResolvedValue({ delivered: 1, rejected: 0 }),
  };
  const attackCounter = counter ?? new AttackCounterService();
  const service = new IntrusionDetectionService(
    prisma,
    audit,
    mailService as any,
    attackCounter,
  );
  service.onModuleInit();
  return { service, audit, mailService, attackCounter };
}

/** 監査ログの行を作る。 */
function lockRow(email: string, ip = '203.0.113.5') {
  return { actorEmail: email, actorId: null, ip };
}

describe('設定の読み込み (#117)', () => {
  it('既定値を使う', () => {
    const c = loadAlertConfig({} as any);
    expect(c.windowMinutes).toBe(60);
    expect(c.quietMinutes).toBe(30);
    expect(c.lockThreshold).toBe(3);
    expect(c.disabled).toBe(false);
  });

  it('環境変数で上書きできる', () => {
    const c = loadAlertConfig({
      ALERT_WINDOW_MINUTES: '30',
      ALERT_LOCK_THRESHOLD: '5',
      ALERT_DISABLED: 'true',
    } as any);
    expect(c.windowMinutes).toBe(30);
    expect(c.lockThreshold).toBe(5);
    expect(c.disabled).toBe(true);
  });

  /**
   * ⚠️ しきい値 0 は「常に検知」を意味し、5分ごとに通知が飛び続ける。
   * 設定ミスで通知が使いものにならなくなるより、既定値で動く方がよい。
   */
  it('0・負数・非数値は既定値に倒す', () => {
    expect(positiveInt('0', 3)).toBe(3);
    expect(positiveInt('-1', 3)).toBe(3);
    expect(positiveInt('abc', 3)).toBe(3);
    expect(positiveInt('1.5', 3)).toBe(3);
    expect(positiveInt(undefined, 3)).toBe(3);
    expect(positiveInt('7', 3)).toBe(7);
  });
});

describe('検知条件A: 同一アカウントへの集中攻撃 (#117)', () => {
  it('しきい値に達したら記録して通知する', async () => {
    const prisma = makePrisma({
      auditLog: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            lockRow('victim@example.com'),
            lockRow('victim@example.com'),
            lockRow('victim@example.com', '198.51.100.9'),
          ])
          // resolveQuietAlerts 用
          .mockResolvedValue([]),
      },
    });
    const { service, audit, mailService } = makeService(prisma);

    await service.runOnce(NOW);

    expect(audit.record).toHaveBeenCalledTimes(1);
    const entry = audit.record.mock.calls[0][0];
    expect(entry.action).toBe('security.alert');
    expect(entry.actor.email).toBe('system');
    expect(entry.targetName).toBe('victim@example.com');
    expect(entry.detail.meta.kind).toBe('A');
    expect(entry.detail.meta.severity).toBe('MEDIUM');
    expect(entry.detail.meta.observed).toBe(3);
    expect(entry.detail.meta.mailStatus).toBe('success');
    expect(mailService.sendSecurityAlert).toHaveBeenCalledTimes(1);
  });

  it('しきい値未満なら何もしない', async () => {
    const prisma = makePrisma({
      auditLog: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([lockRow('victim@example.com')])
          .mockResolvedValue([]),
      },
    });
    const { service, audit, mailService } = makeService(prisma);

    await service.runOnce(NOW);

    expect(audit.record).not.toHaveBeenCalled();
    expect(mailService.sendSecurityAlert).not.toHaveBeenCalled();
  });

  // アカウントごとに独立して数える（他人のロックを合算して誤検知しない）
  it('別々のアカウントのロックを合算しない', async () => {
    const prisma = makePrisma({
      auditLog: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            lockRow('a@example.com'),
            lockRow('b@example.com'),
            lockRow('c@example.com'),
          ])
          .mockResolvedValue([]),
      },
    });
    const { service, audit } = makeService(prisma);

    await service.runOnce(NOW);
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('検知条件B: パスワードスプレー (#117)', () => {
  const accounts = (n: number, per = 3) =>
    Array.from({ length: n }, (_, i) => ({
      actorEmail: `user${i}@example.com`,
      _count: { _all: per },
    }));

  it('アカウント数と総回数の両方を記録する', async () => {
    const prisma = makePrisma({
      auditLog: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest
          .fn()
          .mockResolvedValueOnce(accounts(24, 13))
          .mockResolvedValueOnce([
            { ip: '203.0.113.5', _count: { _all: 300 } },
            { ip: '198.51.100.9', _count: { _all: 12 } },
          ]),
      },
    });
    const { service, audit } = makeService(prisma);

    await service.runOnce(NOW);

    const meta = audit.record.mock.calls[0][0].detail.meta;
    expect(meta.kind).toBe('B');
    // ロックが発生しないまま進行するため、最も危険度が高い
    expect(meta.severity).toBe('HIGH');
    expect(meta.accounts).toBe(24);
    // 「広さ」だけでなく「深さ」も残す（docs/intrusion-detection.md 3.5）
    expect(meta.totalFailures).toBe(24 * 13);
    // 調査の足がかり。全件は残さない
    expect(meta.sampleAccounts).toHaveLength(5);
    // 発信元は上位3件まで
    expect(meta.topIps).toHaveLength(2);
  });

  it('しきい値未満なら通知しない', async () => {
    const prisma = makePrisma({
      auditLog: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValueOnce(accounts(19)),
      },
    });
    const { service, audit } = makeService(prisma);

    await service.runOnce(NOW);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('発信元は上位3件に絞り、残りは件数だけ残す', async () => {
    const prisma = makePrisma({
      auditLog: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest
          .fn()
          .mockResolvedValueOnce(accounts(20))
          .mockResolvedValueOnce(
            Array.from({ length: 7 }, (_, i) => ({
              ip: `10.0.0.${i}`,
              _count: { _all: 10 - i },
            })),
          ),
      },
    });
    const { service, audit } = makeService(prisma);

    await service.runOnce(NOW);

    const meta = audit.record.mock.calls[0][0].detail.meta;
    expect(meta.topIps).toHaveLength(3);
    expect(meta.topIps[0]).toEqual({ ip: '10.0.0.0', count: 10 });
    expect(meta.otherIpCount).toBe(4);
  });
});

describe('検知条件C・D: カウンタ由来 (#117)', () => {
  it('429 が閾値に達したら検知する', async () => {
    const counter = new AttackCounterService();
    for (let i = 0; i < 100; i++) counter.recordThrottled('203.0.113.5');

    const { service, audit } = makeService(makePrisma(), undefined, counter);
    await service.runOnce(NOW);

    const meta = audit.record.mock.calls[0][0].detail.meta;
    expect(meta.kind).toBe('C');
    // レート制限が弾いている＝防げている
    expect(meta.severity).toBe('MEDIUM');
    expect(meta.observed).toBe(100);
  });

  it('未登録アドレスへの試行が閾値に達したら検知する', async () => {
    const counter = new AttackCounterService();
    for (let i = 0; i < 50; i++) counter.recordUnknownEmail('203.0.113.5');

    const { service, audit } = makeService(makePrisma(), undefined, counter);
    await service.runOnce(NOW);

    const meta = audit.record.mock.calls[0][0].detail.meta;
    expect(meta.kind).toBe('D');
    // 存在しないアカウントなので突破されようがない
    expect(meta.severity).toBe('LOW');
  });
});

describe('抑制 (#117)', () => {
  /**
   * ⚠️ 攻撃中は5分ごとに条件を満たす。そのまま送ると通知スパムになり、
   * 逆に無視されるようになる。
   */
  it('窓内にすでに警報を出していれば送らない', async () => {
    const prisma = makePrisma({
      auditLog: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            lockRow('victim@example.com'),
            lockRow('victim@example.com'),
            lockRow('victim@example.com'),
          ])
          .mockResolvedValue([]),
        // 既存の security.alert が見つかる
        findFirst: jest.fn().mockResolvedValue({ id: 'existing' }),
      },
    });
    const { service, audit, mailService } = makeService(prisma);

    await service.runOnce(NOW);

    expect(audit.record).not.toHaveBeenCalled();
    expect(mailService.sendSecurityAlert).not.toHaveBeenCalled();
  });
});

describe('終息通知 (#117)', () => {
  const openAlert = {
    action: 'security.alert',
    targetName: 'victim@example.com',
    targetId: null,
    detail: { meta: { kind: 'A' } },
    createdAt: new Date('2026-08-04T11:00:00.000Z'),
  };

  it('静穏時間に事象が無ければ終息を通知する', async () => {
    const prisma = makePrisma({
      auditLog: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([]) // 検知条件A: なし
          .mockResolvedValueOnce([openAlert]), // 未終息の警報あり
        count: jest.fn().mockResolvedValue(0), // 静穏
      },
    });
    const { service, audit, mailService } = makeService(prisma);

    await service.runOnce(NOW);

    expect(audit.record).toHaveBeenCalledTimes(1);
    const entry = audit.record.mock.calls[0][0];
    expect(entry.action).toBe('security.alert.resolved');
    expect(entry.targetName).toBe('victim@example.com');
    expect(mailService.sendSecurityAlert).toHaveBeenCalledTimes(1);
  });

  /**
   * ⚠️ ここがヒステリシス。事象が続いている間は終息を出さない。
   * 出してしまうと「検知→終息→再検知」を短時間に繰り返し、通知の価値が失われる。
   */
  it('静穏時間内に事象があれば終息を出さない', async () => {
    const prisma = makePrisma({
      auditLog: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([openAlert]),
        count: jest.fn().mockResolvedValue(1), // まだ起きている
      },
    });
    const { service, audit } = makeService(prisma);

    await service.runOnce(NOW);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('すでに終息済みなら二重に出さない', async () => {
    const prisma = makePrisma({
      auditLog: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            openAlert,
            {
              action: 'security.alert.resolved',
              targetName: 'victim@example.com',
              targetId: null,
              detail: { meta: { kind: 'A' } },
              createdAt: new Date('2026-08-04T11:40:00.000Z'),
            },
          ]),
        count: jest.fn().mockResolvedValue(0),
      },
    });
    const { service, audit } = makeService(prisma);

    await service.runOnce(NOW);
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('メールが送れないとき (#117)', () => {
  // ⚠️ 毎回作り直す。describe 直下で1つ作ると mockResolvedValueOnce が
  // 最初のテストで消費され、2件目以降が黙って0件になる
  const threeLocks = () => ({
    auditLog: {
      findMany: jest
        .fn()
        .mockResolvedValueOnce([
          lockRow('victim@example.com'),
          lockRow('victim@example.com'),
          lockRow('victim@example.com'),
        ])
        .mockResolvedValue([]),
    },
  });

  /**
   * ⚠️ 記録は送信の成否によらず必ず行う。
   * 「通知が来なかった＝攻撃が無かった」と誤解されるのを防ぐ。
   */
  it('SMTP 未設定でも記録は残す（mailStatus=disabled）', async () => {
    const { service, audit } = makeService(makePrisma(threeLocks()), {
      isEnabled: jest.fn().mockReturnValue(false),
      sendSecurityAlert: jest.fn(),
    });

    await service.runOnce(NOW);

    const meta = audit.record.mock.calls[0][0].detail.meta;
    expect(meta.mailStatus).toBe('disabled');
    expect(meta.recipients).toBe(0);
  });

  // disabled と failed は対処がまったく違うため、区別できなければならない
  it('送信に失敗しても記録は残す（mailStatus=failed）', async () => {
    const { service, audit } = makeService(makePrisma(threeLocks()), {
      isEnabled: jest.fn().mockReturnValue(true),
      sendSecurityAlert: jest.fn().mockRejectedValue(new Error('SMTP down')),
    });

    await service.runOnce(NOW);

    const meta = audit.record.mock.calls[0][0].detail.meta;
    expect(meta.mailStatus).toBe('failed');
  });

  /**
   * ⚠️ 送信の例外（接続不能・認証失敗）を「宛先が拒否された」と記録してはいけない。
   *
   * `rejected: 2` と残すと、運用者は **Admin のアドレスが無効だと考えて
   * アカウントの整理を始める**。実際は SMTP サーバー側の問題であり、
   * 直すべき場所がまったく違う。
   */
  it('送信の例外を「宛先の拒否」として記録しない', async () => {
    const { service, audit } = makeService(makePrisma(threeLocks()), {
      isEnabled: jest.fn().mockReturnValue(true),
      sendSecurityAlert: jest
        .fn()
        .mockRejectedValue(new Error('ECONNREFUSED')),
    });

    await service.runOnce(NOW);

    const meta = audit.record.mock.calls[0][0].detail.meta;
    expect(meta.mailStatus).toBe('failed');
    expect(meta.delivered).toBe(0);
    // 拒否ではないので 0。送信が成立していないことは mailStatus が示す
    expect(meta.rejected).toBe(0);
  });

  /**
   * ⚠️ 一部の宛先が拒否されても `sendMail` は例外を投げない。
   * 「送った人数」だけを記録すると、**退職者の Admin アカウントが残っていて不達**
   * といった状況で、記録上は成功に見えたまま誰も気づかない。
   */
  it('一部の宛先が拒否されたら件数を残す', async () => {
    const prisma = makePrisma({
      ...threeLocks(),
      user: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { email: 'admin@example.com' },
            { email: 'stale@invalid.local' },
          ]),
      },
    });
    const { service, audit } = makeService(prisma, {
      isEnabled: jest.fn().mockReturnValue(true),
      sendSecurityAlert: jest
        .fn()
        .mockResolvedValue({ delivered: 1, rejected: 1 }),
    });

    await service.runOnce(NOW);

    const meta = audit.record.mock.calls[0][0].detail.meta;
    // 1人には届いているので成功
    expect(meta.mailStatus).toBe('success');
    expect(meta.recipients).toBe(2);
    expect(meta.delivered).toBe(1);
    expect(meta.rejected).toBe(1);
  });

  // 全員に拒否されたら「送った」ではなく「届かなかった」
  it('全員に拒否されたら failed として残す', async () => {
    const { service, audit } = makeService(makePrisma(threeLocks()), {
      isEnabled: jest.fn().mockReturnValue(true),
      sendSecurityAlert: jest
        .fn()
        .mockResolvedValue({ delivered: 0, rejected: 2 }),
    });

    await service.runOnce(NOW);

    const meta = audit.record.mock.calls[0][0].detail.meta;
    expect(meta.mailStatus).toBe('failed');
    expect(meta.delivered).toBe(0);
  });

  it('Admin が1人もいなければ failed として残す', async () => {
    const prisma = makePrisma({
      ...threeLocks(),
      user: { findMany: jest.fn().mockResolvedValue([]) },
    });
    const { service, audit, mailService } = makeService(prisma);

    await service.runOnce(NOW);

    const meta = audit.record.mock.calls[0][0].detail.meta;
    expect(meta.mailStatus).toBe('failed');
    expect(meta.recipients).toBe(0);
    expect(mailService.sendSecurityAlert).not.toHaveBeenCalled();
  });
});

describe('無効化と失敗時の扱い (#117)', () => {
  it('ALERT_DISABLED なら何もしない', async () => {
    const prisma = makePrisma();
    const audit = { record: jest.fn() } as any;
    const service = new IntrusionDetectionService(
      prisma,
      audit,
      {
        isEnabled: () => true,
        sendSecurityAlert: jest
          .fn()
          .mockResolvedValue({ delivered: 1, rejected: 0 }),
      } as any,
      new AttackCounterService(),
    );
    const original = process.env.ALERT_DISABLED;
    process.env.ALERT_DISABLED = 'true';
    service.onModuleInit();

    await service.scan();

    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
    process.env.ALERT_DISABLED = original;
  });

  /**
   * ⚠️ 検知の失敗でアプリを止めない（fail-open）。
   * ただし失敗した事実は必ずログに残す。
   */
  it('集計に失敗しても例外を投げない', async () => {
    const prisma = makePrisma({
      auditLog: {
        findMany: jest.fn().mockRejectedValue(new Error('DB down')),
      },
    });
    const { service } = makeService(prisma);

    await expect(service.scan()).resolves.toBeUndefined();
  });
});

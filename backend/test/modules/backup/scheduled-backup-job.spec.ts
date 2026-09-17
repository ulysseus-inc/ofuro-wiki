// ⚠️ fs の関数は ts-jest では再定義できない（jest.spyOn が
// "Cannot redefine property" で落ちる）。rmSync だけを差し替え可能にし、
// 既定では本物を呼ぶ（他の検査の振る舞いは変えない）
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return { ...actual, rmSync: jest.fn((...args: any[]) => actual.rmSync(...args)) };
});

import { ConflictException } from '@nestjs/common';
import * as fs from 'fs';
import {
  BACKUP_IN_PROGRESS,
  BACKUP_STATUS,
  ScheduledBackupService,
} from '../../../src/modules/backup/scheduled-backup.service';

/**
 * #212: **バックアップの作成を非同期ジョブにする。**
 *
 * ⚠️ ここで守っているのは、**画面は「失敗」なのにサーバーは成功している**、
 * あるいは**裏で2本走っている**といった、見た目と実態がずれる性質のもの。
 *
 * 以前は1つのリクエストの中で pg_dump → ZIP → 記録まで行い、約27秒かかった。
 * ブラウザ（15秒）と本番 nginx（60秒）のタイムアウトに当たり、押し直すと
 * 裏で前の pg_dump が走ったまま2本目が始まった。
 *
 * 詳細は docs/backup.md
 */
describe('バックアップの非同期ジョブ（#212）', () => {
  type Row = {
    id: string;
    filename: string;
    size: bigint;
    workspaceCount: number;
    docCount: number;
    blobCount: number;
    status: string;
    createdAt: Date;
    createdBy: string | null;
  };

  const make = () => {
    const rows = new Map<string, Row>();
    let seq = 0;

    const prisma: any = {
      backupRecord: {
        create: jest.fn(async ({ data }: any) => {
          const row: Row = {
            id: `b${++seq}`,
            createdAt: new Date(),
            ...data,
          };
          rows.set(row.id, row);
          return { ...row };
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = rows.get(where.id);
          if (!row) throw new Error('Record to update not found');
          Object.assign(row, data);
          return { ...row };
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const row of rows.values()) {
            if (row.status === where.status) {
              Object.assign(row, data);
              count++;
            }
          }
          return { count };
        }),
        findUnique: jest.fn(async ({ where }: any) => {
          const row = rows.get(where.id);
          return row ? { ...row } : null;
        }),
        findMany: jest.fn(async () => [...rows.values()]),
        findFirst: jest.fn(async () => null),
        delete: jest.fn(async ({ where }: any) => {
          rows.delete(where.id);
        }),
      },
    };
    // 定期実行が見る設定（自動バックアップ: 有効・毎日）
    const adminService: any = {
      getSettingValue: jest.fn(async (key: string) =>
        key === 'backup_enabled' ? 'true' : key === 'backup_schedule' ? 'daily' : null,
      ),
    };
    const service = new ScheduledBackupService(prisma, adminService);
    const prune = jest
      .spyOn(service as any, 'pruneOldBackups')
      .mockResolvedValue(undefined);

    // ⚠️ 本物の pg_dump は走らせない。ZIP 作りの完了を外から操れるようにする
    let finish!: (v: unknown) => void;
    let fail!: (e: unknown) => void;
    const archive = jest
      .spyOn(service as any, 'buildBackupArchive')
      .mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            finish = resolve;
            fail = reject;
          }),
      );

    const restoreBody = jest
      .spyOn(service as any, 'restoreFromBackupUnlocked')
      .mockResolvedValue(undefined);

    return {
      service,
      prisma,
      rows,
      archive,
      restoreBody,
      prune,
      finish: () =>
        finish({ size: BigInt(123), workspaceCount: 2, docCount: 5, blobCount: 7 }),
      fail: (e: Error) => fail(e),
    };
  };

  /** 待たずに投げたジョブが片付くまで、マイクロタスクを回す */
  const settle = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  /**
   * ⚠️ **これが #212 の核心。** 完了を待たずに返す。
   * 待つと 15秒・60秒のタイムアウトに当たる。
   */
  test('⚠️ 作成は完了を待たずに running を返す', async () => {
    const { service, rows } = make();

    const record = await service.startBackup('admin-1');

    expect(record.status).toBe(BACKUP_STATUS.RUNNING);
    expect(rows.get(record.id)?.status).toBe(BACKUP_STATUS.RUNNING);
  });

  test('ZIP ができたら completed になり、件数とサイズが入る', async () => {
    const { service, rows, finish } = make();

    const record = await service.startBackup('admin-1');
    finish();
    await settle();

    const row = rows.get(record.id)!;
    expect(row.status).toBe(BACKUP_STATUS.COMPLETED);
    expect(row.size).toBe(BigInt(123));
    expect(row.docCount).toBe(5);
  });

  /** ⚠️ running のまま残すと、削除もできなくなる（実行中は削除を拒否するため） */
  test('⚠️ 失敗したら failed になり、鍵も返る', async () => {
    const { service, rows, fail } = make();

    const record = await service.startBackup('admin-1');
    fail(new Error('pg_dump failed'));
    await settle();

    expect(rows.get(record.id)?.status).toBe(BACKUP_STATUS.FAILED);
    // 鍵が返っていれば、次のバックアップを始められる
    await expect(service.startBackup('admin-1')).resolves.toBeTruthy();
  });

  describe('⚠️ 同時に1つだけ（docs/backup.md 3章）', () => {
    /**
     * ⚠️ 以前は「失敗」と出て押し直すと、裏で前の pg_dump が走ったまま
     * 2本目が始まった。
     */
    test('⚠️ 実行中に2本目を始めようとしたら拒否する', async () => {
      const { service } = make();

      await service.startBackup('admin-1');

      await expect(service.startBackup('admin-1')).rejects.toThrow(
        BACKUP_IN_PROGRESS,
      );
    });

    /** ⚠️ pg_dump が書き換え途中の DB を読むと、どちらの結果も信用できない */
    test('⚠️ バックアップ中はリストアを拒否する', async () => {
      const { service, restoreBody } = make();

      await service.startBackup('admin-1');

      await expect(service.restoreFromBackup('/tmp/x.zip')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(restoreBody).not.toHaveBeenCalled();
    });

    test('⚠️ リストア中はバックアップを拒否する', async () => {
      const { service, restoreBody, prisma } = make();
      let releaseRestore!: () => void;
      restoreBody.mockImplementation(
        () => new Promise<void>((resolve) => (releaseRestore = resolve)),
      );

      const restoring = service.restoreFromBackup('/tmp/x.zip');

      await expect(service.startBackup('admin-1')).rejects.toThrow(
        BACKUP_IN_PROGRESS,
      );
      // 記録も作らない（拒否したのに running が残ると、削除もできない）
      expect(prisma.backupRecord.create).not.toHaveBeenCalled();

      releaseRestore();
      await restoring;
    });

    test('リストアが終われば、バックアップを始められる', async () => {
      const { service } = make();

      await service.restoreFromBackup('/tmp/x.zip');

      await expect(service.startBackup('admin-1')).resolves.toBeTruthy();
    });

    /** ⚠️ 記録を作れなかったときに鍵を持ったままだと、以後ずっと拒否される */
    test('⚠️ 記録の作成に失敗したら、鍵を返す', async () => {
      const { service, prisma } = make();
      prisma.backupRecord.create.mockRejectedValueOnce(new Error('db down'));

      await expect(service.startBackup('admin-1')).rejects.toThrow('db down');
      await expect(service.startBackup('admin-1')).resolves.toBeTruthy();
    });
  });

  describe('⚠️ 実行中は削除を拒否する（docs/backup.md 2章）', () => {
    /**
     * ⚠️ 拒否しないと、記録だけ消えてジョブは走り続け、最後に消えた記録を
     * 更新しようとして失敗し、**ZIP だけが残る**。
     */
    test('⚠️ running の記録は削除できない', async () => {
      const { service, rows } = make();
      const record = await service.startBackup('admin-1');

      await expect(service.deleteBackup(record.id)).rejects.toThrow(
        BACKUP_IN_PROGRESS,
      );
      expect(rows.has(record.id)).toBe(true);
    });

    test('完了したら削除できる', async () => {
      const { service, rows, finish } = make();
      const record = await service.startBackup('admin-1');
      finish();
      await settle();

      await expect(service.deleteBackup(record.id)).resolves.toBe(true);
      expect(rows.has(record.id)).toBe(false);
    });
  });

  /**
   * ⚠️ 実行中に落ちると running のまま残る。プロセスが無い以上その作業は
   * 二度と終わらず、しかも**削除もできない**。
   */
  test('⚠️ 起動時に、実行中のまま残った記録を failed にする', async () => {
    const { service, rows, prisma } = make();
    const stale = await prisma.backupRecord.create({
      data: { filename: 'x.zip', status: BACKUP_STATUS.RUNNING },
    });
    const done = await prisma.backupRecord.create({
      data: { filename: 'y.zip', status: BACKUP_STATUS.COMPLETED },
    });

    await service.onModuleInit();

    expect(rows.get(stale.id)?.status).toBe(BACKUP_STATUS.FAILED);
    expect(rows.get(done.id)?.status).toBe(BACKUP_STATUS.COMPLETED);
  });

  /** 定期実行（毎日3時）は完了まで待ち、同じ鍵を使う */
  test('定期実行用の createFullBackup は完了まで待ち、終わったら鍵を返す', async () => {
    const { service, finish } = make();

    const running = service.createFullBackup();
    await settle();
    finish();
    const result = await running;

    expect(result?.status).toBe(BACKUP_STATUS.COMPLETED);
    await expect(service.startBackup('admin-1')).resolves.toBeTruthy();
  });

  /**
   * #212 レビュー指摘（Codex P1・code-review）: ⚠️ **失敗した日に古い正常なものを消さない。**
   *
   * runBackupJob は失敗を failed に変えて正常に返す（投げない）。定期実行が結果を
   * 確かめずに保持期間の削除を続けると、**正常なバックアップが補充されないまま減り、
   * 失敗が続けば1つも無くなる**。以前は createFullBackup が投げていたので起きなかった。
   */
  describe('⚠️ 定期実行（毎日3時）', () => {
    test('⚠️ 失敗したら、古いバックアップを消さない', async () => {
      const { service, prune, fail } = make();

      const run = service.handleScheduledBackup();
      await settle();
      fail(new Error('pg_dump failed'));
      await run;

      expect(prune).not.toHaveBeenCalled();
    });

    test('成功したら、保持期間を過ぎた古いものを消す', async () => {
      const { service, prune, finish } = make();

      const run = service.handleScheduledBackup();
      await settle();
      finish();
      await run;

      expect(prune).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * #212 レビュー指摘（Codex P2）: ⚠️ **作りかけの ZIP の削除に失敗しても、failed にする。**
   *
   * 削除が投げると failed への更新に届かず、記録が **running のまま残る**
   * （画面は取り直しを続け、削除も拒否され続ける）。手動のジョブは待たれないので、
   * 投げた例外は誰にも拾われない。
   */
  test('⚠️ 作りかけの ZIP の削除が投げても、failed になり鍵も返る', async () => {
    const { service, rows, fail } = make();
    // 作りかけの ZIP の削除が、権限エラーなどで投げる
    (fs.rmSync as unknown as jest.Mock).mockImplementationOnce(() => {
      throw new Error('EACCES: permission denied');
    });

    const record = await service.startBackup('admin-1');
    fail(new Error('pg_dump failed'));
    await settle();

    expect(fs.rmSync).toHaveBeenCalled();
    expect(rows.get(record.id)?.status).toBe(BACKUP_STATUS.FAILED);
    // 鍵が返っていれば、次のバックアップを始められる
    await expect(service.startBackup('admin-1')).resolves.toBeTruthy();
  });
});

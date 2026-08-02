import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AdminService } from '../../../src/modules/admin/admin.service';

describe('AdminService', () => {
  let service: AdminService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }: any) => ({
          id: `id-${data.email}`,
          ...data,
        })),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    service = new AdminService(mockPrisma, { record: jest.fn() } as any);
  });

  // #92: CSV 一括登録
  describe('validateUserCsv', () => {
    const row = (line: number, email: string, password = 'Pass1234!') => ({
      line,
      email,
      name: '',
      password,
    });

    it('問題のない行は ok', async () => {
      const [result] = await service.validateUserCsv([row(2, 'a@example.com')]);
      expect(result).toMatchObject({ line: 2, email: 'a@example.com', ok: true });
    });

    it('検証だけでは登録しない', async () => {
      await service.validateUserCsv([row(2, 'a@example.com')]);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it.each([
      ['メールアドレスが空', row(2, ''), 'メールアドレスが空です'],
      ['形式不正', row(2, 'not-an-email'), 'メールアドレスの形式が正しくありません'],
      ['パスワードが空', row(2, 'a@example.com', ''), 'パスワードが空です'],
    ])('%s は NG', async (_label, target, message) => {
      const [result] = await service.validateUserCsv([target]);
      expect(result.ok).toBe(false);
      expect(result.error).toBe(message);
    });

    it('パスワードの前後に空白があると NG', async () => {
      const [result] = await service.validateUserCsv([
        row(2, 'a@example.com', ' Pass1234! '),
      ]);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('パスワードの前後に空白が含まれています');
    });

    it('短すぎるパスワードは NG（他経路と同じ検証）', async () => {
      const [result] = await service.validateUserCsv([
        row(2, 'a@example.com', 'short'),
      ]);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('パスワード');
    });

    // 1件目まで巻き添えで NG にすると、直しようがなくなる
    it('CSV 内で重複したら2件目以降だけ NG', async () => {
      const results = await service.validateUserCsv([
        row(2, 'a@example.com'),
        row(3, 'A@Example.com'),
      ]);
      expect(results[0].ok).toBe(true);
      expect(results[1].ok).toBe(false);
      expect(results[1].error).toBe('この CSV 内で重複しています');
    });

    it('既存ユーザーと重複したら NG', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { email: 'a@example.com' },
      ]);
      const [result] = await service.validateUserCsv([row(2, 'A@EXAMPLE.com')]);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('すでに登録されているメールアドレスです');
    });
  });

  describe('importUsersFromCsv', () => {
    const row = (line: number, email: string, password = 'Pass1234!') => ({
      line,
      email,
      name: '',
      password,
    });

    // 失敗行があっても他の行は登録する（全件ロールバックしない）
    it('NG 行があっても OK 行は登録する', async () => {
      const results = await service.importUsersFromCsv(
        [row(2, 'a@example.com'), row(3, 'bad-email'), row(4, 'c@example.com')],
        'admin@example.com',
      );
      expect(results.map((r) => r.ok)).toEqual([true, false, true]);
      expect(mockPrisma.user.create).toHaveBeenCalledTimes(2);
    });

    it('NG 行は作成を試みない', async () => {
      await service.importUsersFromCsv(
        [row(2, 'a@example.com', 'short')],
        'admin@example.com',
      );
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    // 検証と登録の間に別の Admin が登録した場合を想定
    it('作成時の例外は、その行だけ失敗にする', async () => {
      mockPrisma.user.create
        .mockRejectedValueOnce(new Error('Email already registered'))
        .mockImplementationOnce(({ data }: any) => ({ id: 'x', ...data }));
      const results = await service.importUsersFromCsv(
        [row(2, 'a@example.com'), row(3, 'b@example.com')],
        'admin@example.com',
      );
      expect(results[0]).toMatchObject({
        ok: false,
        error: 'Email already registered',
      });
      expect(results[1].ok).toBe(true);
    });
  });

  // #115: パスワードを忘れた利用者を復旧させる主経路。
  describe('setUserPassword', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'target@example.com',
      });
    });

    it('パスワードをハッシュ化して保存する', async () => {
      await service.setUserPassword('user-1', 'NewPass123!', 'admin@example.com');

      const { data, where } = mockPrisma.user.update.mock.calls[0][0];
      expect(where).toEqual({ id: 'user-1' });
      // 平文のまま保存していないこと
      expect(data.passwordHash).not.toBe('NewPass123!');
      await expect(
        bcrypt.compare('NewPass123!', data.passwordHash),
      ).resolves.toBe(true);
    });

    // 乗っ取られたアカウントの復旧を想定。攻撃者のセッションを残さない。
    it('対象ユーザーの全セッションを失効させる', async () => {
      await service.setUserPassword('user-1', 'NewPass123!', 'admin@example.com');

      const { data } = mockPrisma.user.update.mock.calls[0][0];
      expect(data.tokenVersion).toEqual({ increment: 1 });
    });

    it('存在しないユーザーは NotFound', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.setUserPassword('missing', 'NewPass123!', 'admin@example.com'),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it.each([
      ['短すぎる', 'Short1!'],
      ['長すぎる', 'a'.repeat(129)],
    ])('%s パスワードは拒否する', async (_label, password) => {
      await expect(
        service.setUserPassword('user-1', password, 'admin@example.com'),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });
});

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
        update: jest.fn().mockResolvedValue({}),
      },
    };
    service = new AdminService(mockPrisma);
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

import { BadRequestException } from '@nestjs/common';
import { AuthEmailResolver } from '../../../src/modules/auth/auth-email.resolver';

describe('AuthEmailResolver', () => {
  let resolver: AuthEmailResolver;
  let mockAuthService: any;
  let mockMailService: any;
  let mockPrisma: any;

  beforeEach(() => {
    mockAuthService = {
      changePassword: jest.fn().mockResolvedValue(true),
    };

    mockMailService = {
      ensureEnabled: jest.fn(),
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendChangeEmailNotification: jest.fn().mockResolvedValue(undefined),
      sendNewEmailVerification: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
      sendSetPasswordEmail: jest.fn().mockResolvedValue(undefined),
      verifyToken: jest.fn(),
      deleteToken: jest.fn().mockResolvedValue(undefined),
    };

    mockPrisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    resolver = new AuthEmailResolver(
      mockAuthService,
      mockMailService,
      mockPrisma,
    );
  });

  describe('sendVerifyEmail', () => {
    it('認証メールを送信', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
      });

      const result = await resolver.sendVerifyEmail(
        { id: 'user-1' },
        'http://localhost/verify',
      );

      expect(result).toBe(true);
      expect(mockMailService.ensureEnabled).toHaveBeenCalled();
      expect(mockMailService.sendVerificationEmail).toHaveBeenCalledWith(
        'user-1',
        'user@example.com',
        'http://localhost/verify',
      );
    });

    it('ユーザーが存在しない場合エラー', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        resolver.sendVerifyEmail({ id: 'nonexistent' }, 'http://localhost'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('verifyEmail', () => {
    it('トークン検証してemailVerifiedをtrueに更新', async () => {
      mockMailService.verifyToken.mockResolvedValue({ userId: 'user-1' });
      mockPrisma.user.update.mockResolvedValue({});

      const result = await resolver.verifyEmail('valid-token');

      expect(result).toBe(true);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { emailVerified: true },
      });
      expect(mockMailService.deleteToken).toHaveBeenCalledWith('valid-token');
    });

    it('無効なトークンでエラー', async () => {
      mockMailService.verifyToken.mockResolvedValue(null);

      await expect(resolver.verifyEmail('bad-token')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('sendChangeEmail', () => {
    it('メール変更通知を送信', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'old@example.com',
      });

      const result = await resolver.sendChangeEmail(
        { id: 'user-1' },
        'http://localhost/change',
      );

      expect(result).toBe(true);
      expect(mockMailService.sendChangeEmailNotification).toHaveBeenCalledWith(
        'user-1',
        'old@example.com',
        'http://localhost/change',
      );
    });
  });

  describe('sendVerifyChangeEmail', () => {
    it('変更トークン検証して新メールに確認メール送信', async () => {
      mockMailService.verifyToken.mockResolvedValue({ userId: 'user-1' });
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null) // email check - not in use
        .mockResolvedValueOnce({ id: 'user-1', email: 'old@example.com' });

      const result = await resolver.sendVerifyChangeEmail(
        'change-token',
        'new@example.com',
        'http://localhost/confirm',
      );

      expect(result).toBe(true);
      expect(mockMailService.sendNewEmailVerification).toHaveBeenCalledWith(
        'user-1',
        'old@example.com',
        'new@example.com',
        'http://localhost/confirm',
      );
      expect(mockMailService.deleteToken).toHaveBeenCalledWith('change-token');
    });

    it('メールが既に使用中の場合エラー', async () => {
      mockMailService.verifyToken.mockResolvedValue({ userId: 'user-1' });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'other-user',
        email: 'new@example.com',
      });

      await expect(
        resolver.sendVerifyChangeEmail(
          'token',
          'new@example.com',
          'http://localhost',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('changeEmail', () => {
    it('トークン検証してメールアドレスを更新', async () => {
      mockMailService.verifyToken.mockResolvedValue({
        userId: 'user-1',
        email: 'new@example.com',
      });
      mockPrisma.user.findUnique.mockResolvedValue(null); // not in use
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-1',
        email: 'new@example.com',
        name: 'Test',
        avatarUrl: null,
        emailVerified: true,
        createdAt: new Date('2025-01-01'),
      });

      const result = await resolver.changeEmail(
        'new-email-token',
        'new@example.com',
      );

      expect(result.email).toBe('new@example.com');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { email: 'new@example.com', emailVerified: true },
      });
    });

    it('メール不一致でエラー', async () => {
      mockMailService.verifyToken.mockResolvedValue({
        userId: 'user-1',
        email: 'different@example.com',
      });

      await expect(
        resolver.changeEmail('token', 'new@example.com'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('sendChangePasswordEmail', () => {
    it('パスワードリセットメールを送信', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
      });

      const result = await resolver.sendChangePasswordEmail(
        { id: 'user-1' },
        'http://localhost/reset',
      );

      expect(result).toBe(true);
      expect(mockMailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        'user-1',
        'user@example.com',
        'http://localhost/reset',
      );
    });
  });

  describe('sendSetPasswordEmail', () => {
    it('パスワード設定メールを送信', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
      });

      const result = await resolver.sendSetPasswordEmail(
        { id: 'user-1' },
        'http://localhost/set',
      );

      expect(result).toBe(true);
      expect(mockMailService.sendSetPasswordEmail).toHaveBeenCalledWith(
        'user-1',
        'user@example.com',
        'http://localhost/set',
      );
    });
  });

  describe('changePassword', () => {
    it('トークンベースでパスワードをリセット', async () => {
      mockMailService.verifyToken.mockResolvedValue({ userId: 'user-1' });
      mockPrisma.user.update.mockResolvedValue({});

      const result = await resolver.changePassword(
        undefined,
        'newPass123',
        'reset-token',
        'user-1',
      );

      expect(result).toBe(true);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { passwordHash: expect.any(String) },
      });
      expect(mockMailService.deleteToken).toHaveBeenCalledWith('reset-token');
    });

    it('password_setトークンでもパスワードを設定可能', async () => {
      mockMailService.verifyToken
        .mockResolvedValueOnce(null) // password_reset → not found
        .mockResolvedValueOnce({ userId: 'user-1' }); // password_set → found
      mockPrisma.user.update.mockResolvedValue({});

      const result = await resolver.changePassword(
        undefined,
        'newPass123',
        'set-token',
        'user-1',
      );

      expect(result).toBe(true);
      expect(mockMailService.verifyToken).toHaveBeenCalledWith(
        'set-token',
        'password_reset',
      );
      expect(mockMailService.verifyToken).toHaveBeenCalledWith(
        'set-token',
        'password_set',
      );
    });

    it('userId不一致でエラー', async () => {
      mockMailService.verifyToken.mockResolvedValue({ userId: 'user-1' });

      await expect(
        resolver.changePassword(
          undefined,
          'newPass',
          'token',
          'wrong-user',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('無効なトークンでエラー', async () => {
      mockMailService.verifyToken.mockResolvedValue(null);

      await expect(
        resolver.changePassword(
          undefined,
          'newPass',
          'bad-token',
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('ログイン済みユーザーが現パスワードで変更', async () => {
      const result = await resolver.changePassword(
        { id: 'user-1' },
        'newPass123',
        undefined,
        undefined,
        'currentPass',
      );

      expect(result).toBe(true);
      expect(mockAuthService.changePassword).toHaveBeenCalledWith(
        'user-1',
        'currentPass',
        'newPass123',
      );
    });

    it('パラメータ不足でエラー', async () => {
      await expect(
        resolver.changePassword(undefined, 'newPass'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

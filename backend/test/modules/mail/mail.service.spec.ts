import { BadRequestException } from '@nestjs/common';

// Mock sendMail must use jest.fn reference that survives hoisting
const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: mockSendMail,
  })),
}));

jest.mock('crypto', () => ({
  randomBytes: jest.fn(() => ({
    toString: () => 'mock-token-hex-string',
  })),
}));

// Import after mocks
import { MailService } from '../../../src/modules/mail/mail.service';

describe('MailService', () => {
  let service: MailService;
  let mockPrisma: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMail.mockResolvedValue({ messageId: 'test-id' });

    mockPrisma = {
      emailToken: {
        create: jest.fn().mockResolvedValue({ token: 'mock-token-hex-string' }),
        findUnique: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    // Set env for enabled mail
    process.env.MAILER_HOST = 'localhost';
    process.env.MAILER_PORT = '1025';
    process.env.MAILER_SENDER = 'test@ofuro-wiki.local';
    delete process.env.MAILER_USER;
    delete process.env.MAILER_PASSWORD;
    process.env.MAILER_IGNORE_TLS = 'true';

    service = new MailService(mockPrisma);
  });

  afterEach(() => {
    delete process.env.MAILER_HOST;
    delete process.env.MAILER_PORT;
    delete process.env.MAILER_SENDER;
    delete process.env.MAILER_IGNORE_TLS;
  });

  describe('isEnabled', () => {
    it('SMTP設定ありで有効', () => {
      expect(service.isEnabled()).toBe(true);
    });

    it('SMTP設定なしで無効', () => {
      delete process.env.MAILER_HOST;
      delete process.env.MAILER_PORT;
      const disabledService = new MailService(mockPrisma);
      expect(disabledService.isEnabled()).toBe(false);
    });
  });

  describe('ensureEnabled', () => {
    it('無効時にBadRequestExceptionをスロー', () => {
      delete process.env.MAILER_HOST;
      delete process.env.MAILER_PORT;
      const disabledService = new MailService(mockPrisma);
      expect(() => disabledService.ensureEnabled()).toThrow(
        BadRequestException,
      );
    });

    it('有効時はスローしない', () => {
      expect(() => service.ensureEnabled()).not.toThrow();
    });
  });

  describe('createEmailToken', () => {
    it('トークンを生成してDBに保存', async () => {
      const token = await service.createEmailToken(
        'user-id',
        'email_verification',
      );
      expect(token).toBe('mock-token-hex-string');
      expect(mockPrisma.emailToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-id',
          token: 'mock-token-hex-string',
          type: 'email_verification',
          email: undefined,
        }),
      });
    });

    it('emailパラメータ付きでトークン生成', async () => {
      await service.createEmailToken(
        'user-id',
        'email_change',
        'new@example.com',
      );
      expect(mockPrisma.emailToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'new@example.com',
        }),
      });
    });

    // 有効期限は「呼び出し時刻 + TTL」なので、計測した差は必ず TTL 以上になる
    // （呼び出しに要した時間の分だけ大きい）。上限は余裕をもって判定する。
    const HOUR = 60 * 60 * 1000;
    const TOLERANCE = 30 * 1000;
    const expectTtl = (expiresAt: Date, before: number, expected: number) => {
      const ttl = expiresAt.getTime() - before;
      expect(ttl).toBeGreaterThanOrEqual(expected);
      expect(ttl).toBeLessThan(expected + TOLERANCE);
    };

    // #115: 有効期間は「どう手渡すか」で決める。用途（type）では決まらない。
    it('既定の有効期間は1時間', async () => {
      const before = Date.now();
      await service.createEmailToken('user-id', 'password_reset');
      const { expiresAt } = mockPrisma.emailToken.create.mock.calls[0][0].data;
      expectTtl(expiresAt, before, HOUR);
    });

    it('管理者発行の有効期間を指定すると24時間になる', async () => {
      const before = Date.now();
      await service.createEmailToken(
        'user-id',
        'password_reset',
        undefined,
        MailService.ADMIN_ISSUED_TOKEN_TTL_MS,
      );
      const { expiresAt } = mockPrisma.emailToken.create.mock.calls[0][0].data;
      expectTtl(expiresAt, before, 24 * HOUR);
    });

    // メール送信は本文で「1時間後に無効になります」と伝えているため、
    // 同じ password_reset でもメール経路は 1時間のままでなければならない。
    it('メール送信のパスワードリセットは1時間のまま', async () => {
      const before = Date.now();
      await service.sendPasswordResetEmail(
        'user-id',
        'user@example.com',
        'http://localhost:8080/auth/changePassword',
      );
      const { expiresAt } = mockPrisma.emailToken.create.mock.calls[0][0].data;
      expectTtl(expiresAt, before, HOUR);
    });
  });

  describe('verifyToken', () => {
    it('有効なトークンを検証', async () => {
      mockPrisma.emailToken.findUnique.mockResolvedValue({
        userId: 'user-id',
        type: 'email_verification',
        email: null,
        expiresAt: new Date(Date.now() + 3600000),
      });

      const result = await service.verifyToken(
        'valid-token',
        'email_verification',
      );
      expect(result).toEqual({ userId: 'user-id', email: null });
    });

    it('存在しないトークンはnull', async () => {
      mockPrisma.emailToken.findUnique.mockResolvedValue(null);
      const result = await service.verifyToken('invalid', 'email_verification');
      expect(result).toBeNull();
    });

    it('タイプ不一致はnull', async () => {
      mockPrisma.emailToken.findUnique.mockResolvedValue({
        userId: 'user-id',
        type: 'email_change',
        email: null,
        expiresAt: new Date(Date.now() + 3600000),
      });

      const result = await service.verifyToken(
        'token',
        'email_verification',
      );
      expect(result).toBeNull();
    });

    it('期限切れトークンはnull', async () => {
      mockPrisma.emailToken.findUnique.mockResolvedValue({
        userId: 'user-id',
        type: 'email_verification',
        email: null,
        expiresAt: new Date(Date.now() - 1000),
      });

      const result = await service.verifyToken(
        'expired',
        'email_verification',
      );
      expect(result).toBeNull();
    });
  });

  describe('deleteToken', () => {
    it('トークンを削除', async () => {
      await service.deleteToken('token-to-delete');
      expect(mockPrisma.emailToken.deleteMany).toHaveBeenCalledWith({
        where: { token: 'token-to-delete' },
      });
    });
  });

  describe('sendVerificationEmail', () => {
    it('認証メールを送信', async () => {
      await service.sendVerificationEmail(
        'user-id',
        'user@example.com',
        'http://localhost:3010/verify-email',
      );

      expect(mockPrisma.emailToken.create).toHaveBeenCalled();
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: expect.stringContaining('認証'),
        }),
      );
    });
  });

  describe('sendChangeEmailNotification', () => {
    it('メール変更通知を送信', async () => {
      await service.sendChangeEmailNotification(
        'user-id',
        'old@example.com',
        'http://localhost:3010/change-email',
      );

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'old@example.com',
          subject: expect.stringContaining('変更'),
        }),
      );
    });
  });

  describe('sendNewEmailVerification', () => {
    it('新メール確認を送信', async () => {
      await service.sendNewEmailVerification(
        'user-id',
        'old@example.com',
        'new@example.com',
        'http://localhost:3010/confirm',
      );

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'new@example.com',
          subject: expect.stringContaining('新しいメールアドレス'),
        }),
      );
    });
  });

  describe('sendPasswordResetEmail', () => {
    it('パスワードリセットメールを送信', async () => {
      await service.sendPasswordResetEmail(
        'user-id',
        'user@example.com',
        'http://localhost:3010/reset',
      );

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: expect.stringContaining('リセット'),
        }),
      );
    });
  });


  describe('sendInvitationEmail', () => {
    it('招待メールを送信', async () => {
      await service.sendInvitationEmail(
        'Tanaka',
        'invitee@example.com',
        'MyWiki',
        'invite-id-123',
      );

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'invitee@example.com',
          subject: expect.stringContaining('招待'),
        }),
      );
    });
  });

  describe('sendTestEmail', () => {
    it('テストメールを送信', async () => {
      await service.sendTestEmail({
        host: 'smtp.example.com',
        port: 587,
        sender: 'test@example.com',
        username: 'user',
        password: 'pass',
        ignoreTLS: false,
      });

      // createTransport is called again for test email
      const { createTransport } = require('nodemailer');
      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'smtp.example.com',
          port: 587,
        }),
      );
    });
  });

  describe('createPasswordResetUrl', () => {
    it('リセットURLを生成', () => {
      const url = service.createPasswordResetUrl(
        'token123',
        'http://localhost:3010/reset',
      );
      expect(url).toBe('http://localhost:3010/reset?token=token123');
    });
  });
});

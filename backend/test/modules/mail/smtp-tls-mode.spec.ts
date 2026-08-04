const mockSendMail = jest.fn();
const mockCreateTransport = jest.fn(() => ({ sendMail: mockSendMail }));
jest.mock('nodemailer', () => ({
  createTransport: mockCreateTransport,
}));

import { MailService, useImplicitTls } from '../../../src/modules/mail/mail.service';

/**
 * SMTP の接続方式をポートから決める。
 *
 * | ポート | 方式 | secure |
 * |---|---|---|
 * | 587 / 25 | STARTTLS（平文で接続してから TLS へ切り替える） | false |
 * | **465** | **SSL/TLS**（最初から TLS） | **true** |
 *
 * ⚠️ **`secure: false` を固定すると 465 では接続そのものが成立しない。**
 * しかも起動ログには `Mail service enabled` と出るため、
 * **設定は正しいように見えて、メールだけが届かない。**
 *
 * #117 の通知はメールが唯一の経路であり、ここが黙って壊れると
 * 「攻撃を検知したのに誰にも届かない」状態になる。
 */
describe('SMTP の接続方式 (#117)', () => {
  describe('useImplicitTls', () => {
    it('465 は SSL/TLS', () => {
      expect(useImplicitTls(465)).toBe(true);
    });

    it('587 は STARTTLS', () => {
      expect(useImplicitTls(587)).toBe(false);
    });

    it('25 は STARTTLS', () => {
      expect(useImplicitTls(25)).toBe(false);
    });

    it('1025（開発用 SMTP）は STARTTLS', () => {
      expect(useImplicitTls(1025)).toBe(false);
    });
  });

  describe('トランスポートの生成', () => {
    const prisma = {} as any;

    beforeEach(() => {
      jest.clearAllMocks();
      process.env.MAILER_HOST = 'smtp.example.com';
      delete process.env.MAILER_USER;
      delete process.env.MAILER_PASSWORD;
      delete process.env.MAILER_IGNORE_TLS;
    });

    afterEach(() => {
      delete process.env.MAILER_HOST;
      delete process.env.MAILER_PORT;
    });

    it('465 なら secure: true で繋ぐ', () => {
      process.env.MAILER_PORT = '465';
      new MailService(prisma);

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({ port: 465, secure: true }),
      );
    });

    it('587 なら secure: false で繋ぐ', () => {
      process.env.MAILER_PORT = '587';
      new MailService(prisma);

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({ port: 587, secure: false }),
      );
    });

    /**
     * ⚠️ テスト送信と本番の接続で判定が違うと、
     * 「テストは通るのに本番では届かない」（またはその逆）になり、
     * 原因の切り分けが極めて難しくなる。
     */
    it('テスト送信も本番と同じ判定を使う', async () => {
      process.env.MAILER_PORT = '587';
      const service = new MailService(prisma);
      mockCreateTransport.mockClear();

      await service.sendTestEmail({
        host: 'smtp.example.com',
        port: 465,
        sender: 'a@example.com',
        username: '',
        password: '',
        ignoreTLS: false,
      });

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({ port: 465, secure: true }),
      );
    });
  });
});

/**
 * #117: 検知通知の宛先ごとの結果。
 *
 * ⚠️ **一部の宛先が拒否されても `sendMail` は例外を投げない。**
 * 「送った人数」だけを記録すると、**退職者の Admin アカウントが残っていて不達**
 * といった状況で、記録上は成功に見えたまま誰も気づかない。
 */
describe('検知通知の宛先ごとの結果 (#117)', () => {
  const prisma = {} as any;
  let service: MailService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MAILER_HOST = 'smtp.example.com';
    process.env.MAILER_PORT = '587';
    process.env.MAILER_SENDER = 'noreply@example.com';
    service = new MailService(prisma);
  });

  afterEach(() => {
    delete process.env.MAILER_HOST;
    delete process.env.MAILER_PORT;
    delete process.env.MAILER_SENDER;
  });

  it('全員に届けば delivered だけが増える', async () => {
    mockSendMail.mockResolvedValue({
      accepted: ['noreply@example.com', 'a@example.com', 'b@example.com'],
      rejected: [],
    });

    const r = await service.sendSecurityAlert(
      ['a@example.com', 'b@example.com'],
      's',
      'b',
    );
    expect(r).toEqual({ delivered: 2, rejected: 0 });
  });

  it('拒否された宛先を数える', async () => {
    mockSendMail.mockResolvedValue({
      accepted: ['noreply@example.com', 'a@example.com'],
      rejected: ['stale@invalid.local'],
    });

    const r = await service.sendSecurityAlert(
      ['a@example.com', 'stale@invalid.local'],
      's',
      'b',
    );
    expect(r).toEqual({ delivered: 1, rejected: 1 });
  });

  /**
   * ⚠️ 差出人（`to`）は accepted に必ず含まれる。
   * そのまま数えると、**誰にも届いていないのに delivered=1 になる。**
   */
  it('差出人自身を宛先として数えない', async () => {
    mockSendMail.mockResolvedValue({
      accepted: ['noreply@example.com'],
      rejected: ['stale@invalid.local'],
    });

    const r = await service.sendSecurityAlert(
      ['stale@invalid.local'],
      's',
      'b',
    );
    expect(r).toEqual({ delivered: 0, rejected: 1 });
  });

  it('大文字小文字が違っても同じ宛先として数える', async () => {
    mockSendMail.mockResolvedValue({
      accepted: ['A@Example.com'],
      rejected: [],
    });

    const r = await service.sendSecurityAlert(['a@example.com'], 's', 'b');
    expect(r).toEqual({ delivered: 1, rejected: 0 });
  });

  // nodemailer の応答が想定と違っても落ちないこと（送信自体は済んでいる）
  it('accepted / rejected が無くても落ちない', async () => {
    mockSendMail.mockResolvedValue({});

    const r = await service.sendSecurityAlert(['a@example.com'], 's', 'b');
    expect(r).toEqual({ delivered: 0, rejected: 0 });
  });
});

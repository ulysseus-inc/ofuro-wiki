const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

import { MailService } from '../../../src/modules/mail/mail.service';

/**
 * 人の名前・ワークスペース名・ページの題は、利用者が決められる値。
 * メールの HTML にそのまま埋め込むと、リンクやフォームを差し込める（#319 で
 * ワークスペース名も画面で付けた名前になった）。件名には改行を入れさせない
 */
describe('メールに埋め込む利用者の値 (#319)', () => {
  const EVIL = '<a href="https://evil.example/">クリック</a>';
  const ESCAPED = '&lt;a href=&quot;https://evil.example/&quot;&gt;クリック&lt;/a&gt;';
  const CRLF = '名前\r\nBcc: victim@example.com';

  let service: MailService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMail.mockResolvedValue({ messageId: 'id' });
    process.env.MAILER_HOST = 'localhost';
    process.env.MAILER_PORT = '1025';
    process.env.MAILER_SENDER = 'test@ofuro-wiki.local';
    process.env.MAILER_IGNORE_TLS = 'true';
    service = new MailService({} as never);
  });

  afterEach(() => {
    delete process.env.MAILER_HOST;
    delete process.env.MAILER_PORT;
    delete process.env.MAILER_SENDER;
    delete process.env.MAILER_IGNORE_TLS;
  });

  const sent = () => mockSendMail.mock.calls[0][0] as { subject: string; html: string };

  it('招待: 招待した人の名前とワークスペース名をエスケープする', async () => {
    await service.sendInvitationEmail(EVIL, 'to@example.com', EVIL, 'inv-1');

    expect(sent().html).not.toContain(EVIL);
    expect(sent().html).toContain(ESCAPED);
  });

  it.each([
    ['コメント', 'sendCommentNotificationEmail'],
    ['メンション', 'sendMentionNotificationEmail'],
  ] as const)('%s: 人の名前・ワークスペース名・ページの題をエスケープする', async (_label, method) => {
    await service[method]({
      recipientEmail: 'to@example.com',
      actorName: EVIL,
      workspaceName: EVIL,
      docTitle: EVIL,
      contentPreview: '',
      docUrl: 'https://wiki.example/workspace/ws/doc',
    });

    expect(sent().html).not.toContain(EVIL);
    expect(sent().html.split(ESCAPED).length - 1).toBe(3);
  });

  it('件名に改行を入れさせない（ヘッダーの差し込みを防ぐ）', async () => {
    await service.sendInvitationEmail(CRLF, 'to@example.com', CRLF, 'inv-1');

    expect(sent().subject).not.toMatch(/[\r\n]/);
  });
});

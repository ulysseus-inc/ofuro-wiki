import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { createTransport, Transporter } from 'nodemailer';
import { randomBytes } from 'crypto';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private sender: string;

  constructor(private prisma: PrismaService) {
    const host = process.env.MAILER_HOST;
    const port = process.env.MAILER_PORT;
    this.sender =
      process.env.MAILER_SENDER || 'noreply@ofuro-wiki.local';

    if (host && port) {
      const ignoreTLS = process.env.MAILER_IGNORE_TLS === 'true';
      this.transporter = createTransport({
        host,
        port: parseInt(port, 10),
        secure: false,
        auth:
          process.env.MAILER_USER && process.env.MAILER_PASSWORD
            ? {
                user: process.env.MAILER_USER,
                pass: process.env.MAILER_PASSWORD,
              }
            : undefined,
        tls: ignoreTLS ? { rejectUnauthorized: false } : undefined,
      });
      this.logger.log(`Mail service enabled (host: ${host}:${port})`);
    } else {
      this.logger.warn(
        'Mail service disabled: MAILER_HOST or MAILER_PORT not configured',
      );
    }
  }

  isEnabled(): boolean {
    return this.transporter !== null;
  }

  ensureEnabled(): void {
    if (!this.transporter) {
      throw new BadRequestException('EMAIL_SERVICE_NOT_CONFIGURED');
    }
  }

  /**
   * #115: トークンの有効期間は「どう手渡すか」で決める。用途（type）では決まらない。
   * メールで送るものは利用者がその場で受け取れるため 1時間で足りる（既定）。
   * 管理者が発行してチャット等で手渡す再設定 URL は受け渡しに時間差が生じるため、
   * 1時間では実運用に耐えない。呼び出し側が ADMIN_ISSUED_TOKEN_TTL_MS を明示する。
   *
   * ⚠️ password_reset は「メール送信」と「管理者発行」の両方で使う。
   * type で切り替えると、メール本文の「1時間後に無効になります」と実際の期限がずれる。
   * 設定可能にはしない（選択肢を増やすより、既定値を明記する方が運用しやすい）。
   */
  static readonly DEFAULT_TOKEN_TTL_MS = 60 * 60 * 1000; // 1時間
  static readonly ADMIN_ISSUED_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24時間

  async createEmailToken(
    userId: string,
    type: string,
    email?: string,
    ttlMs: number = MailService.DEFAULT_TOKEN_TTL_MS,
  ): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + ttlMs);

    await this.prisma.emailToken.create({
      data: { userId, token, type, email, expiresAt },
    });

    return token;
  }

  async verifyToken(
    token: string,
    type: string,
  ): Promise<{ userId: string; email?: string | null } | null> {
    const record = await this.prisma.emailToken.findUnique({
      where: { token },
    });

    if (!record || record.type !== type || record.expiresAt < new Date()) {
      return null;
    }

    return { userId: record.userId, email: record.email };
  }

  async deleteToken(token: string): Promise<void> {
    await this.prisma.emailToken.deleteMany({ where: { token } });
  }

  async sendVerificationEmail(
    userId: string,
    email: string,
    callbackUrl: string,
  ): Promise<void> {
    this.ensureEnabled();
    const token = await this.createEmailToken(userId, 'email_verification');
    const url = `${callbackUrl}?token=${token}`;

    await this.transporter!.sendMail({
      from: this.sender,
      to: email,
      subject: 'ofuro-wiki: メールアドレスの認証',
      html: `
        <h2>メールアドレスの認証</h2>
        <p>以下のリンクをクリックしてメールアドレスを認証してください。</p>
        <p><a href="${url}">メールアドレスを認証する</a></p>
        <p>このリンクは1時間後に無効になります。</p>
        <p>心当たりがない場合は、このメールを無視してください。</p>
      `,
    });

    this.logger.log(`Verification email sent to ${email}`);
  }

  async sendChangeEmailNotification(
    userId: string,
    email: string,
    callbackUrl: string,
  ): Promise<void> {
    this.ensureEnabled();
    const token = await this.createEmailToken(userId, 'email_change');
    const url = `${callbackUrl}?token=${token}`;

    await this.transporter!.sendMail({
      from: this.sender,
      to: email,
      subject: 'ofuro-wiki: メールアドレスの変更リクエスト',
      html: `
        <h2>メールアドレスの変更</h2>
        <p>メールアドレスの変更がリクエストされました。</p>
        <p>以下のリンクをクリックして手続きを進めてください。</p>
        <p><a href="${url}">メールアドレスを変更する</a></p>
        <p>このリンクは1時間後に無効になります。</p>
        <p>心当たりがない場合は、このメールを無視してください。</p>
      `,
    });

    this.logger.log(`Change email notification sent to ${email}`);
  }

  async sendNewEmailVerification(
    userId: string,
    oldEmail: string,
    newEmail: string,
    callbackUrl: string,
  ): Promise<void> {
    this.ensureEnabled();
    const token = await this.createEmailToken(
      userId,
      'new_email_verification',
      newEmail,
    );
    const url = `${callbackUrl}?token=${token}&email=${encodeURIComponent(newEmail)}`;

    await this.transporter!.sendMail({
      from: this.sender,
      to: newEmail,
      subject: 'ofuro-wiki: 新しいメールアドレスの確認',
      html: `
        <h2>新しいメールアドレスの確認</h2>
        <p>${oldEmail} から ${newEmail} への変更を確認してください。</p>
        <p><a href="${url}">新しいメールアドレスを確認する</a></p>
        <p>このリンクは1時間後に無効になります。</p>
        <p>心当たりがない場合は、このメールを無視してください。</p>
      `,
    });

    this.logger.log(`New email verification sent to ${newEmail}`);
  }

  /**
   * ⚠️ 現在この送信経路の呼び出し元は無い。
   * 本人向けの `sendChangePasswordEmail` mutation（AFFiNE 由来の「メールで本人確認して
   * パスワードを変更する」流れ）は、PR #130 で `changeMyPassword`（現在のパスワードを
   * 検証する方式）に置き換わったため削除した。
   * この送信処理自体は **#132（Admin 発行 URL のメール送信）で再利用する**ため残している。
   */
  async sendPasswordResetEmail(
    userId: string,
    email: string,
    callbackUrl: string,
  ): Promise<void> {
    this.ensureEnabled();
    const token = await this.createEmailToken(userId, 'password_reset');
    const url = `${callbackUrl}?token=${token}`;

    await this.transporter!.sendMail({
      from: this.sender,
      to: email,
      subject: 'ofuro-wiki: パスワードのリセット',
      html: `
        <h2>パスワードのリセット</h2>
        <p>以下のリンクをクリックしてパスワードを再設定してください。</p>
        <p><a href="${url}">パスワードをリセットする</a></p>
        <p>このリンクは1時間後に無効になります。</p>
        <p>心当たりがない場合は、このメールを無視してください。</p>
      `,
    });

    this.logger.log(`Password reset email sent to ${email}`);
  }

  /** #115: Admin 発行の変更 URL を組み立てる（トークンの発行は呼び出し側）。 */
  createPasswordResetUrl(token: string, callbackUrl: string): string {
    return `${callbackUrl}?token=${token}`;
  }

  async sendTestEmail(config: {
    host: string;
    port: number;
    sender: string;
    username: string;
    password: string;
    ignoreTLS: boolean;
  }): Promise<void> {
    const testTransporter = createTransport({
      host: config.host,
      port: config.port,
      secure: false,
      auth:
        config.username && config.password
          ? { user: config.username, pass: config.password }
          : undefined,
      tls: config.ignoreTLS ? { rejectUnauthorized: false } : undefined,
    });

    await testTransporter.sendMail({
      from: config.sender,
      to: config.sender,
      subject: 'ofuro-wiki: テストメール',
      html: `
        <h2>テストメール</h2>
        <p>SMTP設定のテストメールです。このメールが届いていれば、設定は正常です。</p>
      `,
    });

    this.logger.log(`Test email sent via ${config.host}:${config.port}`);
  }

  async sendCommentNotificationEmail(params: {
    recipientEmail: string;
    actorName: string;
    workspaceName: string;
    docTitle: string;
    contentPreview: string;
    docUrl: string;
  }): Promise<void> {
    if (!this.transporter) return;

    await this.transporter.sendMail({
      from: this.sender,
      to: params.recipientEmail,
      subject: `ofuro-wiki: ${params.actorName} さんが「${params.docTitle}」にコメントしました`,
      html: `
        <h2>新しいコメント</h2>
        <p><strong>${params.actorName}</strong> さんが <strong>${params.workspaceName}</strong> の「<strong>${params.docTitle}</strong>」にコメントしました。</p>
        ${params.contentPreview ? `<blockquote style="border-left: 3px solid #ccc; padding-left: 12px; color: #555;">${this.escapeHtml(params.contentPreview)}</blockquote>` : ''}
        <p><a href="${params.docUrl}">ドキュメントを開く</a></p>
      `,
    });

    this.logger.log(`Comment notification email sent to ${params.recipientEmail}`);
  }

  async sendMentionNotificationEmail(params: {
    recipientEmail: string;
    actorName: string;
    workspaceName: string;
    docTitle: string;
    contentPreview: string;
    docUrl: string;
  }): Promise<void> {
    if (!this.transporter) return;

    await this.transporter.sendMail({
      from: this.sender,
      to: params.recipientEmail,
      subject: `ofuro-wiki: ${params.actorName} さんが「${params.docTitle}」であなたをメンションしました`,
      html: `
        <h2>メンション通知</h2>
        <p><strong>${params.actorName}</strong> さんが <strong>${params.workspaceName}</strong> の「<strong>${params.docTitle}</strong>」であなたをメンションしました。</p>
        ${params.contentPreview ? `<blockquote style="border-left: 3px solid #ccc; padding-left: 12px; color: #555;">${this.escapeHtml(params.contentPreview)}</blockquote>` : ''}
        <p><a href="${params.docUrl}">ドキュメントを開く</a></p>
      `,
    });

    this.logger.log(`Mention notification email sent to ${params.recipientEmail}`);
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async sendInvitationEmail(
    inviterName: string,
    inviteeEmail: string,
    workspaceName: string,
    inviteId: string,
  ): Promise<void> {
    this.ensureEnabled();
    const baseUrl = process.env.BASE_URL || 'http://localhost:3010';
    const url = `${baseUrl}/invite/${inviteId}`;

    await this.transporter!.sendMail({
      from: this.sender,
      to: inviteeEmail,
      subject: `ofuro-wiki: ${inviterName} さんが「${workspaceName}」に招待しました`,
      html: `
        <h2>ofuro-wiki ワークスペースへの招待</h2>
        <p>${inviterName} さんがあなたを ofuro-wiki のワークスペース「${workspaceName}」に招待しました。</p>
        <p><a href="${url}">招待を確認する</a></p>
      `,
    });

    this.logger.log(`Invitation email sent to ${inviteeEmail}`);
  }
}

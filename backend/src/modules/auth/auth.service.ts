import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma.service';
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from './dto/auth.dto';
import { BCRYPT_ROUNDS } from '../../common/security.constants';
import { deriveUserName } from '../../common/user-name.util';
import { isAdminEmail } from '../../common/admin-email';

export interface JwtPayload {
  sub: string;
  email: string;
  // L-1: トークンのバージョン。DB の users.token_version と不一致なら失効扱い。
  tv?: number;
}

// タイミング攻撃対策用のダミー bcrypt ハッシュ（cost=12、BCRYPT_ROUNDS と一致）。
// ユーザー不在時にも bcrypt.compare を実行して応答時間を既存ユーザー経路と均一化する。
const DUMMY_PASSWORD_HASH =
  '$2b$12$RGvytIJk.Dwgf62T.saYfuUt13T5jQyqsKymo6ecLQaFUNaAphhSy';

/**
 * #93: アカウントロックアウトのしきい値。
 *
 * 設定可能にはしていない。0 や極端な値を設定されるとセキュリティ機能自体が
 * 無効化されるため、意図的にハードコードしている。
 * 変更が必要になったらここを直す（ドキュメント: docs/deploy/README.md）。
 */
const LOGIN_MAX_FAILED_ATTEMPTS = 10;
const LOGIN_LOCKOUT_DURATION_MS = 15 * 60 * 1000;

/**
 * #93: 同一IPからのアカウント作成の上限（1時間あたり）。
 *
 * HTTP 層のレート制限だけでは塞げない。`/api/auth/sign-in` は未登録メールのとき
 * アカウントを自動作成する（`AUTH_SIGNIN_AUTOCREATE`）一方、サインインのレート制限は
 * 「IP + メールアドレス」で数えるため、**メールアドレスを変えるたびに新しい枠**になり、
 * サインアップ側の制限（10回/1時間）を迂回してアカウントを量産できてしまう。
 *
 * そのため、エンドポイントではなく「アカウント作成そのもの」に上限を掛ける。
 */
const SIGNUP_MAX_PER_IP = 10;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;

/**
 * #93: サインイン失敗の連射に対する上限（IP + メールアドレスあたり）。
 *
 * HTTP 層のレート制限（@Throttle）は「リクエスト数」を数えるため、**成功した
 * サインインも枠を消費する**。複数端末・複数タブ・CI から正当にサインインしただけで
 * 締め出されてしまい、可用性の問題になる。
 *
 * そこで、失敗だけを数えるこの制限で総当たりを抑止し、
 * HTTP 層の制限は単純な連射・DoS の抑制に徹する。
 * これにより「攻撃者には厳しく、正当な利用者には影響しない」を両立できる。
 *
 * ⚠️ カウントはプロセス内メモリに保持する（@nestjs/throttler の既定ストレージも同様）。
 *    そのため **再起動でリセットされ、複数インスタンス構成では共有されない**。
 *    ofuro-wiki は単一インスタンス構成を前提としており、この範囲では問題にならない。
 *    複数インスタンスに対応する場合は、DB に記録するアカウントロックアウト
 *    （users.failed_login_count・10回で15分）が唯一の永続的な防御になるため、
 *    共有ストア（Redis 等）への移行が必要になる。
 */
const SIGNIN_MAX_FAILURES = 5;
const SIGNIN_FAILURE_WINDOW_MS = 5 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** #93: IP ごとのアカウント作成時刻（メモリ保持・プロセス再起動でリセット） */
  private readonly signupAttempts = new Map<string, number[]>();
  /** #93: 「IP + メールアドレス」ごとのサインイン失敗時刻（成功時にクリア） */
  private readonly signinFailures = new Map<string, number[]>();

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  /** パスワードポリシー検証（サインアップ・変更時の共通チェック）。 */
  validatePasswordStrength(password: string): void {
    if (
      typeof password !== 'string' ||
      password.length < PASSWORD_MIN_LENGTH ||
      password.length > PASSWORD_MAX_LENGTH
    ) {
      throw new BadRequestException(
        `パスワードは${PASSWORD_MIN_LENGTH}〜${PASSWORD_MAX_LENGTH}文字にしてください`,
      );
    }
  }

  private async isRegistrationOpen(): Promise<boolean> {
    const setting = await this.prisma.serverSetting.findUnique({
      where: { key: 'registration_open' },
    });
    // Default to open if not set
    return setting?.value !== 'false';
  }

  /**
   * #93: 同一IPからのアカウント作成回数を制限する。
   * サインアップ経路と、サインインでの自動作成経路の両方から呼ぶ。
   */
  private assertSignupAllowed(ip?: string): void {
    if (!ip) return;

    const now = Date.now();
    const recent = (this.signupAttempts.get(ip) ?? []).filter(
      (at) => now - at < SIGNUP_WINDOW_MS,
    );

    if (recent.length >= SIGNUP_MAX_PER_IP) {
      this.logger.warn(
        `Account creation rate limit exceeded: ip=${ip} ` +
          `(${recent.length}/${SIGNUP_MAX_PER_IP} in the last hour)`,
      );
      throw new HttpException(
        'Too many accounts created from this address. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    recent.push(now);
    this.signupAttempts.set(ip, recent);

    // 古いエントリの掃除（IPごとの配列が無限に増えないようにする）
    if (this.signupAttempts.size > 1000) {
      for (const [key, times] of this.signupAttempts) {
        const alive = times.filter((at) => now - at < SIGNUP_WINDOW_MS);
        if (alive.length === 0) this.signupAttempts.delete(key);
        else this.signupAttempts.set(key, alive);
      }
    }
  }

  async signUp(email: string, password: string, name?: string, ip?: string) {
    if (!(await this.isRegistrationOpen())) {
      throw new ForbiddenException('Registration is closed');
    }

    this.assertSignupAllowed(ip);

    this.validatePasswordStrength(password);

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    // #77: ADMIN_EMAIL のユーザーは、作成時点で Admin にする。
    // 起動時のシード（AdminService.seedAdmin）は「その時点で存在するユーザー」しか
    // 対象にできないため、サインアップ側でも付与しないと、
    // 「サインアップ後にコンテナを再起動するまで Admin にならない」状態になる。
    const isAdmin = isAdminEmail(email);

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        // 名前未指定時は email のローカル部を既定表示名にする。
        name: deriveUserName(email, name),
        emailVerified: true,
        isAdmin,
      },
    });

    if (isAdmin) {
      this.logger.log(`Admin role granted on sign-up: ${email}`);
    }

    return this.generateTokenResponse(user);
  }

  /**
   * #93: サインイン失敗の記録キー。
   * 大文字小文字を揃えるのは、表記を変えるだけで制限を回避されないようにするため
   * （権限判定と違い、レート制限では正規化する方が安全側に働く）。
   */
  private signinKey(email: string, ip?: string): string {
    return `${ip ?? 'unknown'}:${email.trim().toLowerCase()}`;
  }

  /** #93: 直近の失敗回数が上限に達していれば 429 を返す（パスワード照合の前に呼ぶ）。 */
  private assertSigninAllowed(email: string, ip?: string): void {
    const now = Date.now();
    const key = this.signinKey(email, ip);
    const recent = (this.signinFailures.get(key) ?? []).filter(
      (at) => now - at < SIGNIN_FAILURE_WINDOW_MS,
    );

    if (recent.length >= SIGNIN_MAX_FAILURES) {
      this.logger.warn(
        `Sign-in rate limit exceeded: ${email} ip=${ip ?? 'unknown'} ` +
          `(${recent.length} failures in the last ${SIGNIN_FAILURE_WINDOW_MS / 60000} min)`,
      );
      throw new HttpException(
        'Too many failed sign-in attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** #93: サインイン失敗を記録する。成功したサインインは記録しない（枠を消費しない）。 */
  private recordSigninFailure(email: string, ip?: string): void {
    const now = Date.now();
    const key = this.signinKey(email, ip);
    const recent = (this.signinFailures.get(key) ?? []).filter(
      (at) => now - at < SIGNIN_FAILURE_WINDOW_MS,
    );
    recent.push(now);
    this.signinFailures.set(key, recent);

    // 古いエントリの掃除
    if (this.signinFailures.size > 1000) {
      for (const [k, times] of this.signinFailures) {
        const alive = times.filter((at) => now - at < SIGNIN_FAILURE_WINDOW_MS);
        if (alive.length === 0) this.signinFailures.delete(k);
        else this.signinFailures.set(k, alive);
      }
    }
  }

  /** #93: サインイン成功時に失敗の記録を消す。 */
  private clearSigninFailures(email: string, ip?: string): void {
    this.signinFailures.delete(this.signinKey(email, ip));
  }

  async signIn(email: string, password: string, ip?: string) {
    // #93: 失敗が続いている場合は、パスワード照合（bcrypt）に入る前に打ち切る。
    // 存在しないアドレスでも同様に数えるため、応答からアカウントの有無は判別できない。
    this.assertSigninAllowed(email, ip);

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      // タイミング攻撃対策: 不在/パスワード未設定でもダミー比較で時間を均一化。
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      this.recordSigninFailure(email, ip);
      throw new UnauthorizedException('Invalid credentials');
    }

    // #93: ロック中は、パスワードの正誤にかかわらず認証させない。
    // 応答は通常の失敗と同一にする（「ロック中」と返すとアカウントの存在が判明するため）。
    if (this.isLocked(user)) {
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      this.logger.warn(
        `Sign-in rejected for locked account: ${email} ip=${ip ?? 'unknown'} ` +
          `until=${user.lockedUntil?.toISOString()}`,
      );
      this.recordSigninFailure(email, ip);
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      this.recordSigninFailure(email, ip);
      await this.registerFailedLogin(user, ip);
      throw new UnauthorizedException('Invalid credentials');
    }

    // 成功したサインインは枠を消費しない（複数端末・複数タブでも締め出されない）
    this.clearSigninFailures(email, ip);
    await this.resetFailedLogins(user);

    return this.generateTokenResponse(user);
  }

  /** #93: ロック期間中かどうか。期限切れのロックは無効として扱う。 */
  private isLocked(user: { lockedUntil: Date | null }): boolean {
    return !!user.lockedUntil && user.lockedUntil.getTime() > Date.now();
  }

  /**
   * #93: ログイン失敗を記録し、しきい値に達したらロックする。
   *
   * ロックが自動解除された後の失敗は 1 回目として数える
   * （解除時にカウントを 0 に戻す仕様のため）。
   */
  private async registerFailedLogin(
    user: { id: string; email: string; failedLoginCount: number; lockedUntil: Date | null },
    ip?: string,
  ): Promise<void> {
    // 期限切れのロックが残っている場合、カウントはリセット済みとして数え直す
    const previous = user.lockedUntil ? 0 : user.failedLoginCount;
    const count = previous + 1;
    const shouldLock = count >= LOGIN_MAX_FAILED_ATTEMPTS;
    const lockedUntil = shouldLock
      ? new Date(Date.now() + LOGIN_LOCKOUT_DURATION_MS)
      : null;

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: shouldLock ? 0 : count,
        lockedUntil,
        lastFailedLoginAt: new Date(),
      },
    });

    if (shouldLock) {
      this.logger.warn(
        `Account locked after ${count} failed sign-in attempts: ${user.email} ` +
          `ip=${ip ?? 'unknown'} until=${lockedUntil?.toISOString()}`,
      );
    } else {
      this.logger.warn(
        `Failed sign-in attempt ${count}/${LOGIN_MAX_FAILED_ATTEMPTS}: ` +
          `${user.email} ip=${ip ?? 'unknown'}`,
      );
    }
  }

  /** #93: ログイン成功・パスワードリセット完了時に失敗カウントとロックを解除する。 */
  private async resetFailedLogins(user: {
    id: string;
    failedLoginCount: number;
    lockedUntil: Date | null;
  }): Promise<void> {
    if (user.failedLoginCount === 0 && !user.lockedUntil) return;

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  }

  async signInOrSignUp(email: string, password: string, ip?: string) {
    // #93: 未登録アドレスへの試行も失敗として数える（存在の有無を漏らさないため）
    this.assertSigninAllowed(email, ip);

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // M-2(B/C): 未登録メールの挙動を「誤パスワード」と区別できないよう一律 401 に倒す。
      // - C: AUTH_SIGNIN_AUTOCREATE=false なら sign-in での自動作成を無効化（既定は true=後方互換）。
      // - B: 登録クローズ時も `Registration is closed`(403) ではなく `Invalid credentials`(401)。
      // いずれもユーザー存在オラクルを与えない。登録オープン＋自動作成有効時のみ従来どおり作成。
      const autoCreate = process.env.AUTH_SIGNIN_AUTOCREATE !== 'false';
      if (!autoCreate || !(await this.isRegistrationOpen())) {
        // タイミング攻撃対策: 既存ユーザー経路の bcrypt.compare と処理時間を
        // 揃えるため、不在時もダミーハッシュで比較してから 401 を返す。
        await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
        this.recordSigninFailure(email, ip);
        throw new UnauthorizedException('Invalid credentials');
      }
      // 自動作成の経路でも、サインインが成立した以上は失敗の記録を消す
      // （signIn 側と挙動を揃える。未登録時の失敗が新規アカウントに残らないように）
      const created = await this.signUp(email, password, undefined, ip);
      this.clearSigninFailures(email, ip);
      return created;
    }
    return this.signIn(email, password, ip);
  }

  async preflight(_email: string) {
    // M-2(A): ユーザー列挙・本名漏れを防ぐため、存在有無に依存しない定数を返す。
    // hasPassword:true 固定でフロントは常にパスワード画面へ遷移する（新規登録は
    // sign-in POST 側の自動作成で成立するため機能は壊れない）。
    return {
      registered: true,
      hasPassword: true,
      magicLink: false,
      name: null,
    };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Wrong password');
    }

    this.validatePasswordStrength(newPassword);
    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    // L-1: パスワード変更時は既存の全トークンを失効させる（tokenVersion +1）。
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash, tokenVersion: { increment: 1 } },
    });
    return true;
  }

  /** L-1: 対象ユーザーの全トークンを失効させる（tokenVersion +1）。 */
  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
  }

  /** L-1: payload.tv と DB の tokenVersion を突き合わせ、有効ならユーザーを返す。 */
  async validateTokenPayload(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        emailVerified: true,
        createdAt: true,
        tokenVersion: true,
      },
    });
    if (!user) return null;
    // 既存の tv 無しトークンは 0 とみなす（後方互換）。
    if ((payload.tv ?? 0) !== user.tokenVersion) return null;
    return user;
  }

  async deleteAccount(userId: string): Promise<boolean> {
    // Check if this is the last admin
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.isAdmin) {
      const adminCount = await this.prisma.user.count({ where: { isAdmin: true } });
      if (adminCount <= 1) {
        throw new ForbiddenException('Cannot delete the last admin account');
      }
    }

    // Cascade delete handles related data
    await this.prisma.user.delete({ where: { id: userId } });
    return true;
  }

  async validateUser(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        emailVerified: true,
        createdAt: true,
      },
    });
  }

  /**
   * #89: OIDC（SSO）でのサインイン。
   *
   * IdP 側の認証は済んでいる前提で、こちら側のアカウントに突き合わせる。
   *
   * ⚠️ **アカウントの自動作成は既定で行わない。**
   * 「その IdP でログインできる人」全員が対象になるため、社外にも開かれた IdP
   * （Google の一般アカウント等）では、自動作成を有効にすると部外者が入れてしまう。
   * 有効化するかは管理画面で選ばせる（既定 false）。
   */
  async signInWithOidc(params: {
    email: string;
    name?: string;
    autoCreateUser: boolean;
    ip?: string;
  }) {
    const { email, name, autoCreateUser, ip } = params;

    // ⚠️ 大文字小文字を無視して既存アカウントを探す。
    // OIDC 側のメールは小文字化しているが、パスワード認証で作られた
    // アカウントは入力そのままで保存されている。完全一致で探すと、
    // 大文字を含むアドレスの既存利用者が SSO で照合できず、
    // 「アカウントがない」と拒否される／重複アカウントが作られる。
    const matched = await this.prisma.user.findMany({
      where: { email: { equals: email, mode: 'insensitive' } },
      take: 2,
    });

    // 大文字違いのアカウントが複数ある場合、どれを本人とみなすか決められない。
    // 取り違えは乗っ取りと同じ結果になるため、選ばずに拒否する。
    if (matched.length > 1) {
      this.logger.warn(
        `OIDC sign-in rejected (multiple accounts differ only by case): ${email} ip=${ip ?? 'unknown'}`,
      );
      throw new UnauthorizedException(
        'このメールアドレスに一致するアカウントが複数あります。管理者にお問い合わせください。',
      );
    }

    const user = matched[0];

    if (user) {
      // システムアカウント（マニュアルWS所有者など）はログインさせない
      if (user.isSystem) {
        this.logger.warn(
          `OIDC sign-in rejected for system account: ${email} ip=${ip ?? 'unknown'}`,
        );
        throw new UnauthorizedException('このアカウントではサインインできません。');
      }

      // #93: パスワード認証と同様、ロック中はサインインさせない
      if (this.isLocked(user)) {
        this.logger.warn(
          `OIDC sign-in rejected for locked account: ${email} ip=${ip ?? 'unknown'}`,
        );
        throw new UnauthorizedException('このアカウントではサインインできません。');
      }

      await this.resetFailedLogins(user);
      this.logger.log(`OIDC sign-in: ${email}`);
      return this.generateTokenResponse(user);
    }

    if (!autoCreateUser) {
      this.logger.warn(
        `OIDC sign-in rejected (no account, auto-create disabled): ${email} ip=${ip ?? 'unknown'}`,
      );
      throw new UnauthorizedException(
        'このメールアドレスのアカウントがありません。管理者にお問い合わせください。',
      );
    }

    // 自動作成が有効な場合のみ。IP あたりの作成上限は共通で適用する（#93）
    this.assertSignupAllowed(ip);

    const created = await this.prisma.user.create({
      data: {
        email,
        // SSO 利用者はパスワードを持たない（パスワード認証では入れない）
        passwordHash: null,
        name: deriveUserName(email, name),
        emailVerified: true,
        isAdmin: isAdminEmail(email),
      },
    });

    this.logger.log(`OIDC sign-in: created account for ${email}`);
    return this.generateTokenResponse(created);
  }

  private generateTokenResponse(user: {
    id: string;
    email: string;
    tokenVersion?: number;
  }) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tv: user.tokenVersion ?? 0,
    };
    const token = this.jwtService.sign(payload);
    return { token, user };
  }
}

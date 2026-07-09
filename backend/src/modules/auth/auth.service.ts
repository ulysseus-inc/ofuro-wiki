import {
  Injectable,
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

@Injectable()
export class AuthService {
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

  async signUp(email: string, password: string, name?: string) {
    if (!(await this.isRegistrationOpen())) {
      throw new ForbiddenException('Registration is closed');
    }

    this.validatePasswordStrength(password);

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        // 名前未指定時は email のローカル部を既定表示名にする。
        name: deriveUserName(email, name),
        emailVerified: true,
      },
    });

    return this.generateTokenResponse(user);
  }

  async signIn(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      // タイミング攻撃対策: 不在/パスワード未設定でもダミー比較で時間を均一化。
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.generateTokenResponse(user);
  }

  async signInOrSignUp(email: string, password: string) {
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
        throw new UnauthorizedException('Invalid credentials');
      }
      return this.signUp(email, password);
    }
    return this.signIn(email, password);
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

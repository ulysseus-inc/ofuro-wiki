import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma.service';
import { getAdminEmail } from '../../common/admin-email';
import { BCRYPT_ROUNDS } from '../../common/security.constants';
import { deriveUserName } from '../../common/user-name.util';
import { validatePasswordStrength } from '../../common/password.util';
import { AuditService } from '../audit/audit.service';
import { ParsedCsvRow } from './user-csv.util';
import { CsvUserRowResult } from './admin.model';

// メールアドレスの簡易検証。RFC 準拠の完全な判定は行わない
// （厳密にやるほど正当なアドレスを弾く危険が増すため、明らかな誤りだけを弾く）。
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async listUsers(search?: string, skip = 0, take = 20) {
    // #72: システム内部アカウント（マニュアルWS所有等）は外部に出さない。
    const where: any = { isSystem: false };
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' as const } },
        { name: { contains: search, mode: 'insensitive' as const } },
      ];
    }

    const [items, totalCount] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          isAdmin: true,
          emailVerified: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, totalCount };
  }

  async createUser(email: string, password: string, name?: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    validatePasswordStrength(password);

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    return this.prisma.user.create({
      data: {
        email,
        passwordHash,
        name: deriveUserName(email, name),
        emailVerified: true,
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        isAdmin: true,
        emailVerified: true,
        createdAt: true,
      },
    });
  }

  /**
   * #115: 管理者が対象ユーザーのパスワードを直接再設定する（機能 3）。
   *
   * パスワードを忘れた利用者の復旧経路。現在のパスワードは要求しない
   * （忘れているから使えない）ため、Admin 権限そのものが唯一の防壁になる。
   * この操作の後、Admin は対象利用者のパスワードを知った状態になる。
   * 本人に URL を渡せる場合は 4（変更 URL 発行）を使うこと。
   * 設定後は対象ユーザーの全セッションを失効させる（tokenVersion +1）。
   * 乗っ取り時に「気づかれずに居座る」ことを防ぐため、既存セッションは残さない。
   */
  async setUserPassword(userId: string, password: string, actorEmail: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    validatePasswordStrength(password);

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });

    // #90: 対象のメールアドレスを残したいので、ここで明示的に記録する
    // （Interceptor では対象が UUID でしか分からない）
    await this.audit.record({
      action: 'user.password.reset',
      actor: { email: actorEmail },
      targetType: 'user',
      targetId: userId,
      targetName: user.email,
    });
    return true;
  }

  /**
   * #92: CSV の各行を検証する。**登録は行わない。**
   *
   * 画面はこの結果を一覧表示し、Admin が確認してから登録する。
   * 登録後に失敗行を報告する方式だと後始末が発生するため、押す前に分かるようにする。
   */
  async validateUserCsv(rows: ParsedCsvRow[]): Promise<CsvUserRowResult[]> {
    // 既存ユーザーとの重複は1件ずつ問い合わせると行数分のクエリになるため、
    // 対象メールアドレスをまとめて引く。
    const emails = rows.map((r) => r.email.toLowerCase()).filter(Boolean);
    const existing = await this.prisma.user.findMany({
      where: { email: { in: emails, mode: 'insensitive' } },
      select: { email: true },
    });
    const taken = new Set(existing.map((u) => u.email.toLowerCase()));

    const seen = new Set<string>();
    return rows.map((row) => {
      const error = this.validateCsvRow(row, taken, seen);
      if (!error) seen.add(row.email.toLowerCase());
      return {
        line: row.line,
        email: row.email,
        name: row.name || undefined,
        ok: !error,
        error,
      };
    });
  }

  /** #92: 1行分の検証。理由を1つだけ返す（利用者が直す順序を迷わないため）。 */
  private validateCsvRow(
    row: ParsedCsvRow,
    taken: Set<string>,
    seen: Set<string>,
  ): string | undefined {
    if (!row.email) {
      return 'メールアドレスが空です';
    }
    if (!EMAIL_PATTERN.test(row.email)) {
      return 'メールアドレスの形式が正しくありません';
    }
    const key = row.email.toLowerCase();
    if (seen.has(key)) {
      return 'この CSV 内で重複しています';
    }
    if (taken.has(key)) {
      return 'すでに登録されているメールアドレスです';
    }
    if (!row.password) {
      return 'パスワードが空です';
    }
    // 前後の空白は、区切り文字の後ろに空けた分が紛れ込んだのか、
    // 意図した文字なのかを区別できない。黙ってどちらかに倒すと、
    // 「CSV に書いた値でサインインできない」事故になるため直してもらう。
    if (row.password !== row.password.trim()) {
      return 'パスワードの前後に空白が含まれています';
    }
    try {
      validatePasswordStrength(row.password);
    } catch (e: any) {
      return e?.message ?? 'パスワードが要件を満たしていません';
    }
    return undefined;
  }

  /**
   * #92: CSV の内容を登録する。
   *
   * ⚠️ 画面が持っている検証結果は信用せず、**登録時にも同じ検証を行う**。
   * 検証から登録までの間に、別の Admin が同じメールアドレスを登録している
   * 可能性があるため。
   *
   * 行ごとに判定し、失敗した行があっても他の行は登録する（全件ロールバックしない）。
   */
  async importUsersFromCsv(
    rows: ParsedCsvRow[],
    actorEmail: string,
  ): Promise<CsvUserRowResult[]> {
    const validated = await this.validateUserCsv(rows);
    const byLine = new Map(rows.map((r) => [r.line, r]));
    const results: CsvUserRowResult[] = [];

    for (const candidate of validated) {
      if (!candidate.ok) {
        results.push(candidate);
        continue;
      }
      const row = byLine.get(candidate.line)!;
      try {
        await this.createUser(row.email, row.password, row.name || undefined);
        results.push(candidate);
      } catch (e: any) {
        // 同時実行で一意制約に触れた場合もここへ来る。1行の失敗で全体は止めない。
        results.push({
          ...candidate,
          ok: false,
          error: e?.message ?? '登録できませんでした',
        });
      }
    }

    const created = results.filter((r) => r.ok).length;
    // #90: 件数は結果にしか無いため、ここで記録する
    await this.audit.record({
      action: 'user.import',
      actor: { email: actorEmail },
      targetType: 'user',
      detail: {
        meta: { ok: created, ng: results.length - created },
      },
    });
    return results;
  }

  /** #90: actor は監査ログに残すため必須。誰が消したか分からない記録は役に立たない。 */
  async deleteUser(userId: string, actor: { id?: string; email: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // #90: 消したものの名前は**消す前にしか取れない**。
    // UUID だけ残しても、参照先が消えているため後から何を消したのか分からない。
    const ownedWorkspaces = await this.prisma.workspace.findMany({
      where: { ownerId: userId },
      select: { id: true, name: true },
    });

    // Delete owned workspaces first to avoid FK constraint on ownerId
    await this.prisma.workspace.deleteMany({ where: { ownerId: userId } });
    await this.prisma.user.delete({ where: { id: userId } });

    await this.audit.record({
      action: 'user.delete',
      actor,
      targetType: 'user',
      targetId: userId,
      targetName: user.email,
      detail: {
        meta: {
          // 連鎖して消えたワークスペースも残す（利用者削除に伴い黙って消える）
          deletedWorkspaces: ownedWorkspaces.map((w) => ({
            id: w.id,
            name: w.name,
          })),
        },
      },
    });
    return true;
  }

  /** L-1: 対象ユーザーの全トークンを失効させる（tokenVersion +1）。 */
  async revokeUserSessions(userId: string): Promise<boolean> {
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
      });
      return true;
    } catch (error: any) {
      // 対象ユーザーが存在しない場合 Prisma は P2025 を投げる
      if (error?.code === 'P2025') {
        throw new NotFoundException('User not found');
      }
      throw error;
    }
  }

  async setAdmin(userId: string, isAdmin: boolean) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { isAdmin },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        isAdmin: true,
        emailVerified: true,
        createdAt: true,
      },
    });
  }

  async getSettings() {
    return this.prisma.serverSetting.findMany({
      orderBy: { key: 'asc' },
    });
  }

  async updateSetting(key: string, value: string) {
    return this.prisma.serverSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  async getSettingValue(key: string): Promise<string | null> {
    const setting = await this.prisma.serverSetting.findUnique({
      where: { key },
    });
    return setting?.value ?? null;
  }

  async seedAdmin() {
    const adminEmail = getAdminEmail();
    if (!adminEmail) {
      this.logger.log('ADMIN_EMAIL not set, skipping admin seed');
      return;
    }

    // #77: 完全一致で引く（AuthService の isAdminEmail と同じ判定）。
    // 大文字小文字を無視すると、第三者が ADMIN_EMAIL の大文字小文字違いで
    // サインアップしておくだけで、再起動時に管理者へ昇格させられてしまう。
    const user = await this.prisma.user.findUnique({
      where: { email: adminEmail },
    });

    if (!user) {
      // #77: サインアップ時にも付与するようになったため、この文言どおりに動く
      this.logger.log(
        `ADMIN_EMAIL=${adminEmail} not found in database. Admin will be set when this user signs up.`,
      );
      return;
    }

    if (!user.isAdmin) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { isAdmin: true },
      });
      this.logger.log(`Admin role granted to ${adminEmail}`);
    } else {
      this.logger.log(`${adminEmail} is already admin`);
    }
  }
}

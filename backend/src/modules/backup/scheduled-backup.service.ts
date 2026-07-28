import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import archiver from 'archiver';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import * as unzipper from 'unzipper';
import { PrismaService } from '../../prisma.service';
import { AdminService } from '../admin/admin.service';
import { resolveWithinDir } from './backup-path.util';

const execFileAsync = promisify(execFile);

/**
 * #79: pg_dump / pg_restore が使えないときのエラーを分かりやすくする。
 *
 * これらはコンテナには同梱されている（Dockerfile で postgresql-client を導入）が、
 * ホスト上で `npm run start:dev` する開発環境には入っていないことが多い。
 * 素の Node.js は `spawn pg_dump EACCES` / `ENOENT` としか言わないため、
 * 原因（何を入れればよいか）にたどり着けない。
 */
export const PG_TOOL_UNAVAILABLE = 'PG_TOOL_UNAVAILABLE';

function describeMissingPgTool(tool: string, cause: unknown): Error {
  const code = (cause as NodeJS.ErrnoException)?.code;
  const error = new Error(
    `${PG_TOOL_UNAVAILABLE}: ${tool} を実行できません（${code ?? 'unknown'}）。\n` +
      `バックアップ／リストアは PostgreSQL クライアントツールを使用します。\n` +
      `  - Docker で運用している場合: イメージに同梱済みのため、通常このエラーは出ません\n` +
      `  - ホスト上で開発している場合: postgresql-client をインストールしてください\n` +
      `    （サーバーと同じメジャーバージョンが必要です。詳細: docs/development.md）`,
  );
  error.name = PG_TOOL_UNAVAILABLE;
  return error;
}

/** #79: pg_dump / pg_restore を実行し、実行できない場合は原因の分かるエラーに変換する。 */
async function execPgTool(
  tool: 'pg_dump' | 'pg_restore',
  args: string[],
  options?: Parameters<typeof execFileAsync>[2],
) {
  try {
    return await execFileAsync(tool, args, options);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    // 実行ファイルが無い / 実行権限が無い場合だけ、案内付きのエラーに置き換える。
    // （SQL エラーなど pg_dump 自身の失敗はそのまま伝える）
    if (code === 'ENOENT' || code === 'EACCES') {
      throw describeMissingPgTool(tool, err);
    }
    throw err;
  }
}

const BACKUP_DIR =
  process.env.BACKUP_STORAGE_PATH || path.join(process.cwd(), 'data', 'backups');

const BLOB_DIR = process.env.BLOB_STORAGE_PATH || './data/blobs';

/**
 * #34: バックアップ/リストアは DB 全体（public + 同居する他スキーマ）を
 * pg_dump で読み、pg_restore で DDL（drop/create）する。最小権限化で
 * runtime の DATABASE_URL を非superuser（ofuro_app）に絞ると、他スキーマへの
 * アクセス権が無く `permission denied for schema ...` で失敗するため、
 * DDL/全読み取り権限を持つ接続を使う。
 * 優先順: BACKUP_DATABASE_URL > MIGRATE_DATABASE_URL(=ofuro) > DATABASE_URL(後方互換)。
 *
 * セキュリティ(CWE-532): パスワード付き URI をコマンドライン引数に渡すと、
 * pg_dump/pg_restore 失敗時に execFile のエラー（err.message/cmd）へ生パスワードが
 * 載り、logger.error でログに漏洩する。そのため URL からパスワードを分離し、
 * 引数にはパスワードを除いた URL、認証は環境変数 PGPASSWORD で渡す。
 */
function getAdminDbUrl(): { url: string; password?: string } {
  const rawUrl =
    process.env.BACKUP_DATABASE_URL ||
    process.env.MIGRATE_DATABASE_URL ||
    process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error('DATABASE_URL is not set');
  }
  try {
    const parsed = new URL(rawUrl);
    const password = parsed.password || undefined;
    parsed.password = '';
    return { url: parsed.toString(), password };
  } catch {
    // URL としてパースできない形式はそのまま返す（後方互換）。
    return { url: rawUrl };
  }
}

@Injectable()
export class ScheduledBackupService {
  private readonly logger = new Logger(ScheduledBackupService.name);

  constructor(
    private prisma: PrismaService,
    private adminService: AdminService,
  ) {
    // Ensure backup directory exists
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleScheduledBackup() {
    const enabled = await this.adminService.getSettingValue('backup_enabled');
    if (enabled !== 'true') {
      return;
    }

    const schedule =
      (await this.adminService.getSettingValue('backup_schedule')) || 'daily';

    // Check if we should run based on schedule
    const lastBackup = await this.prisma.backupRecord.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    if (lastBackup) {
      const hoursSinceLastBackup =
        (Date.now() - lastBackup.createdAt.getTime()) / (1000 * 60 * 60);

      if (schedule === 'weekly' && hoursSinceLastBackup < 168) return;
      if (schedule === 'monthly' && hoursSinceLastBackup < 720) return;
      // 'daily' runs every time the cron fires
    }

    this.logger.log('Starting scheduled backup...');
    try {
      await this.createFullBackup();
      await this.pruneOldBackups();
    } catch (err) {
      this.logger.error('Scheduled backup failed', err);
    }
  }

  async createFullBackup(userId?: string): Promise<{
    id: string;
    filename: string;
    size: bigint;
    workspaceCount: number;
    docCount: number;
    blobCount: number;
    status: string;
    createdAt: Date;
  }> {
    this.logger.log('Creating full backup (pg_dump + blobs)...');

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19);

    // Work in a temporary directory, then ZIP into a single file
    const tmpDir = path.join(BACKUP_DIR, `.tmp-backup-${timestamp}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      // 1. pg_dump
      const dumpPath = path.join(tmpDir, 'db.dump');
      // #34: 全スキーマを読むため DDL/全読み取り権限を持つ接続を使う（ofuro_app 不可）。
      // CWE-532: パスワードは引数ではなく PGPASSWORD で渡す（失敗時のログ漏洩防止）。
      const { url: dbUrl, password: dbPassword } = getAdminDbUrl();

      await execPgTool(
        'pg_dump',
        ['--format=custom', '--file', dumpPath, dbUrl],
        dbPassword
          ? { env: { ...process.env, PGPASSWORD: dbPassword } }
          : undefined,
      );
      this.logger.log('pg_dump completed');

      // 2. Copy blobs directory
      const blobsAbsPath = path.resolve(BLOB_DIR);
      const blobsDestPath = path.join(tmpDir, 'blobs');
      if (fs.existsSync(blobsAbsPath)) {
        await execFileAsync('cp', ['-r', blobsAbsPath, blobsDestPath]);
        this.logger.log('Blobs copied');
      } else {
        fs.mkdirSync(blobsDestPath, { recursive: true });
        this.logger.log('No blobs directory found, created empty blobs/');
      }

      // 3. Count stats from DB
      const [workspaceCount, docCount, blobCount] = await Promise.all([
        this.prisma.workspace.count(),
        this.prisma.docMeta.count(),
        this.prisma.blob.count({ where: { deleted: false } }),
      ]);

      // 4. Write manifest
      const manifestPath = path.join(tmpDir, 'backup-manifest.json');
      fs.writeFileSync(
        manifestPath,
        JSON.stringify(
          {
            version: 2,
            format: 'ofuro-full-backup-v2',
            createdAt: new Date().toISOString(),
            workspaceCount,
            docCount,
            blobCount,
          },
          null,
          2,
        ),
      );

      // 5. ZIP the temporary directory into a single file
      const zipFilename = `backup-${timestamp}.zip`;
      const zipPath = path.join(BACKUP_DIR, zipFilename);
      await this.zipDirectory(tmpDir, zipPath);
      this.logger.log('ZIP archive created');

      // 6. Get ZIP file size
      const zipSize = BigInt(fs.statSync(zipPath).size);

      // 7. Record in DB
      const record = await this.prisma.backupRecord.create({
        data: {
          filename: zipFilename,
          size: zipSize,
          workspaceCount,
          docCount,
          blobCount,
          status: 'completed',
          createdBy: userId ?? null,
        },
      });

      this.logger.log(
        `Full backup completed: ${workspaceCount} workspaces, ${docCount} docs, ${blobCount} blobs (${(Number(zipSize) / 1024 / 1024).toFixed(1)} MB)`,
      );

      return record;
    } finally {
      // Clean up temporary directory
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  async listBackups(skip = 0, take = 20) {
    const [items, totalCount] = await Promise.all([
      this.prisma.backupRecord.findMany({
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.backupRecord.count(),
    ]);
    return { items, totalCount };
  }

  async deleteBackup(backupId: string): Promise<boolean> {
    const record = await this.prisma.backupRecord.findUnique({
      where: { id: backupId },
    });
    if (!record) return false;

    // Delete ZIP file
    const backupPath = path.join(BACKUP_DIR, record.filename);
    if (fs.existsSync(backupPath)) {
      fs.rmSync(backupPath, { force: true });
    }

    await this.prisma.backupRecord.delete({ where: { id: backupId } });
    this.logger.log(`Deleted backup ${backupId}`);
    return true;
  }

  async getBackupPath(backupId: string): Promise<string | null> {
    const record = await this.prisma.backupRecord.findUnique({
      where: { id: backupId },
    });
    if (!record) return null;

    const backupPath = path.join(BACKUP_DIR, record.filename);
    if (!fs.existsSync(backupPath)) return null;

    return backupPath;
  }

  async restoreFromBackup(filePath: string): Promise<void> {
    this.logger.log('Starting restore from backup...');

    const tmpDir = path.join(os.tmpdir(), `ofuro-restore-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      // 1. Extract ZIP（L-4: unzipper.Extract はエントリ名を検証せず zip-slip に
      //    脆弱なため、各エントリの展開先が tmpDir 配下に収まることを検証して展開する）
      await this.safeExtractZip(filePath, tmpDir);
      this.logger.log('ZIP extracted');

      // 2. Validate manifest
      const manifestPath = path.join(tmpDir, 'backup-manifest.json');
      if (!fs.existsSync(manifestPath)) {
        throw new Error('Invalid backup: backup-manifest.json not found');
      }
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      if (manifest.format !== 'ofuro-full-backup-v2') {
        throw new Error(
          `Unsupported backup format: ${manifest.format}. Expected ofuro-full-backup-v2`,
        );
      }
      this.logger.log(
        `Manifest validated: ${manifest.workspaceCount} workspaces, ${manifest.docCount} docs`,
      );

      // 3. Restore DB via pg_restore
      const dumpPath = path.join(tmpDir, 'db.dump');
      if (!fs.existsSync(dumpPath)) {
        throw new Error('Invalid backup: db.dump not found');
      }

      // #34: リストアは DDL(drop/create)するため DDL 権限を持つ接続を使う（ofuro_app 不可）。
      // CWE-532: パスワードは引数ではなく PGPASSWORD で渡す（失敗時のログ漏洩防止）。
      const { url: dbUrl, password: dbPassword } = getAdminDbUrl();

      await execPgTool(
        'pg_restore',
        ['--format=custom', '--clean', '--if-exists', `--dbname=${dbUrl}`, dumpPath],
        dbPassword
          ? { env: { ...process.env, PGPASSWORD: dbPassword } }
          : undefined,
      );
      this.logger.log('Database restored via pg_restore');

      // 4. Restore blobs
      const blobsAbsPath = path.resolve(BLOB_DIR);
      const blobsSrcPath = path.join(tmpDir, 'blobs');

      if (fs.existsSync(blobsSrcPath)) {
        // Clear existing blobs (contents only, keep the directory itself for volume mounts)
        if (fs.existsSync(blobsAbsPath)) {
          const entries = fs.readdirSync(blobsAbsPath);
          for (const entry of entries) {
            fs.rmSync(path.join(blobsAbsPath, entry), { recursive: true, force: true });
          }
        } else {
          fs.mkdirSync(blobsAbsPath, { recursive: true });
        }
        // Copy extracted blobs contents into the directory
        await execFileAsync('cp', ['-rT', blobsSrcPath, blobsAbsPath]);
        this.logger.log('Blobs restored');
      }

      this.logger.log('Restore completed successfully');
    } finally {
      // Clean up
      fs.rmSync(tmpDir, { recursive: true, force: true });
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
      }
    }
  }

  /**
   * ZIP を安全に展開する（L-4 zip-slip 対策）。各エントリの展開先が destDir
   * 配下に収まることを検証し、外へ出るエントリがあれば例外で中断する。
   */
  private async safeExtractZip(zipPath: string, destDir: string): Promise<void> {
    const directory = await unzipper.Open.file(zipPath);
    for (const entry of directory.files) {
      // resolveWithinDir が destDir を抜けるパスを例外にする
      const target = resolveWithinDir(destDir, entry.path);
      if (entry.type === 'Directory') {
        await fs.promises.mkdir(target, { recursive: true });
        continue;
      }
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      // OOM 回避: buffer() で全読み込みせず stream でディスクへ流す。
      await new Promise<void>((resolve, reject) => {
        const writeStream = fs.createWriteStream(target);
        entry
          .stream()
          .on('error', reject)
          .pipe(writeStream)
          .on('finish', resolve)
          .on('error', reject);
      });
    }
  }

  private zipDirectory(sourceDir: string, outPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outPath);
      // store mode (no compression) — db.dump is already compressed by pg_dump
      const archive = archiver('zip', { store: true });

      output.on('close', () => resolve());
      archive.on('error', (err) => reject(err));

      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize();
    });
  }

  private async pruneOldBackups() {
    const retentionDays = parseInt(
      (await this.adminService.getSettingValue('backup_retention_days')) || '30',
      10,
    );

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const oldRecords = await this.prisma.backupRecord.findMany({
      where: { createdAt: { lt: cutoff } },
    });

    for (const record of oldRecords) {
      await this.deleteBackup(record.id);
    }

    if (oldRecords.length > 0) {
      this.logger.log(
        `Pruned ${oldRecords.length} backups older than ${retentionDays} days`,
      );
    }
  }
}

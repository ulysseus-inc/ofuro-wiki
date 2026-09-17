import { ConflictException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
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

/**
 * `pg_restore` の失敗を「無視してよいもの」と判定する。
 *
 * ⚠️ **データ本体が入らなかった場合は必ず失敗にすること。**
 * 「復元できていないのに成功と報告する」ほうが、逆より危険である
 * （障害対応中に、退路が無いことに気づけない）。
 *
 * ## ⚠️ 実際の出力を見て作ること
 *
 * 二度誤った。**どちらもテストは緑だった。**
 *
 * 1. 「4つの悪い語句が無ければ成功」という**除外リスト**にしていた。
 *    `pg_restore` はデータ投入の失敗でも `errors ignored on restore` を出す。
 * 2. `Command was:` ブロックだけを見る形にした。しかし
 *    **COPY の失敗には `Command was:` が付かない**（下記）。
 *    索引の失敗だけが `Command was:` を持てば、
 *    **データが入っていなくても「成功」**になっていた。
 *
 * 2 を見逃したのは、テストのヘルパーが**出力形式を捏造していた**ため。
 * 実出力は `test/modules/backup/fixtures/` に置いてある。**それで検査すること。**
 *
 * ## 実際の形
 *
 * 無視してよいもの（`Command was:` がある）:
 * ```
 * pg_restore: error: could not execute query: ERROR:  relation "i1" already exists
 * Command was: CREATE INDEX i1 ON public.t1 USING btree (v);
 * ```
 *
 * ⚠️ 無視できないもの（`Command was:` が**無い**）:
 * ```
 * pg_restore: error: COPY failed for table "t1": ERROR:  duplicate key ...
 * DETAIL:  Key (id)=(1) already exists.
 * CONTEXT:  COPY t1, line 1
 * ```
 *
 * **エラー1件ずつに分けて、すべてが無視してよいものであることを確かめる。**
 */
export function isIgnorableRestoreError(stderr: string): boolean {
  if (!stderr) return false;
  // 続行できずに終わった場合は、この行が出ない
  if (!/errors ignored on restore/i.test(stderr)) return false;

  // `pg_restore: error:` ごとに区切る（次のエラー、または警告行まで）
  const blocks = stderr
    .split(/^pg_restore: error:/m)
    .slice(1) // 先頭は最初のエラーより前の部分
    .map((b) => b.split(/^pg_restore: warning:/m)[0]);

  // ⚠️ 何が失敗したのか分からないなら、無視してよいとは言えない
  if (blocks.length === 0) return false;

  return blocks.every((block) => {
    // ⚠️ `Command was:` が無いエラー（COPY 失敗等）は無視できない。
    // 何の SQL が失敗したのか分からず、データ投入の可能性がある
    const m = /Command was:\s*([\s\S]*)$/.exec(block);
    if (!m) return false;
    return IGNORABLE_COMMAND.test(m[1].trim());
  });
}

/**
 * 作成に失敗しても**データ本体には影響しない** SQL。
 *
 * ⚠️ ここに `COPY` / `INSERT` / `CREATE TABLE` を足さないこと。
 * それらが失敗している＝**データが入っていない**ということである。
 *
 * 索引・制約が欠けたままでも、データは読める（検索が遅くなる等の影響は
 * 残るため、呼び出し側で必ずログに出すこと）。
 */
const IGNORABLE_COMMAND =
  /^\s*(CREATE\s+(UNIQUE\s+)?INDEX|ALTER\s+TABLE\s+[\s\S]*?ADD\s+CONSTRAINT|CREATE\s+TRIGGER|COMMENT\s+ON)\b/i;

const BACKUP_DIR =
  process.env.BACKUP_STORAGE_PATH || path.join(process.cwd(), 'data', 'backups');

const BLOB_DIR = process.env.BLOB_STORAGE_PATH || './data/blobs';

/**
 * #212: `pg_dump` の引数。
 *
 * ⚠️ **`backup_records`（バックアップの一覧）はダンプに入れない。** 一覧は業務データ
 * ではなく、ディスク上の ZIP の目録。入れると復元で一覧が取得時点に巻き戻り、
 * 使ったバックアップの記録が消える（同期のころ）か、`running` のまま消せなくなる
 * （非同期にしてから）。docs/backup.md 3b章
 */
export function pgDumpArgs(dumpPath: string, dbUrl: string): string[] {
  return [
    '--format=custom',
    '--exclude-table=public.backup_records',
    '--file',
    dumpPath,
    dbUrl,
  ];
}

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


/**
 * #212: バックアップ／リストアが既に動いているときのエラー名。
 * ⚠️ 大文字スネークにすること（formatError が extensions.name に載せ、画面が翻訳する）
 */
export const BACKUP_IN_PROGRESS = 'BACKUP_IN_PROGRESS';

/** #212: バックアップの状態（docs/backup.md 1章） */
export const BACKUP_STATUS = {
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

/** #212: 同時に1つだけ動かせる作業の種類（docs/backup.md 3章） */
type BackupJobKind = 'backup' | 'restore';

type BackupArchive = {
  size: bigint;
  workspaceCount: number;
  docCount: number;
  blobCount: number;
};

@Injectable()
export class ScheduledBackupService implements OnModuleInit {
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

  /**
   * #212: いま動いている作業（バックアップ／リストア）。
   *
   * ⚠️ **メモリ上に持つ。バックエンドが1プロセスで動いていることが前提**
   * （#151 の変更通知と同じ前提）。複数インスタンスにするなら DB の鍵に置き換える。
   */
  private activeJob: BackupJobKind | null = null;

  /**
   * #212: 実行中に落ちた記録を failed にする。
   * ⚠️ プロセスが無い以上その作業は二度と終わらず、running のままだと
   * **削除もできない**（実行中は削除を拒否するため）。
   */
  async onModuleInit() {
    const { count } = await this.prisma.backupRecord.updateMany({
      where: { status: BACKUP_STATUS.RUNNING },
      data: { status: BACKUP_STATUS.FAILED },
    });
    if (count > 0) {
      this.logger.warn(`Marked ${count} interrupted backup(s) as failed`);
    }
  }

  /** #212: 鍵を取る。⚠️ 取れなければ BACKUP_IN_PROGRESS（重ねない・待たない） */
  private acquireJob(kind: BackupJobKind) {
    if (this.activeJob) {
      throw new ConflictException(BACKUP_IN_PROGRESS);
    }
    this.activeJob = kind;
  }

  private releaseJob() {
    this.activeJob = null;
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
      const result = await this.createFullBackup();
      // #212: ⚠️ **成功したときだけ古いものを消す。** runBackupJob は失敗を failed に
      // 変えて正常に返す（投げない）。確かめずに消すと、失敗した日にも保持期間切れの
      // **正常なバックアップが消え、補充されないまま減っていく**（失敗が続けば0になる）
      if (result?.status !== BACKUP_STATUS.COMPLETED) {
        this.logger.error(
          `Scheduled backup did not complete (status: ${result?.status ?? 'unknown'}); skip pruning old backups`,
        );
        return;
      }
      await this.pruneOldBackups();
    } catch (err) {
      // #212: 手動のバックアップやリストアが動いていれば、その回は見送る
      if (err instanceof ConflictException) {
        this.logger.warn('Scheduled backup skipped: another backup/restore is running');
        return;
      }
      this.logger.error('Scheduled backup failed', err);
    }
  }

  /**
   * #212: バックアップを**始めるだけ**で、完了を待たずに返す（管理画面の作成ボタン）。
   *
   * ⚠️ 同期で待つと、ブラウザの既定のタイムアウト（15秒）と本番 nginx の
   * proxy_read_timeout（60秒）に当たる。画面は「失敗」と出るのにサーバーは成功していた。
   * 完了は一覧の status（running → completed / failed）で知る。docs/backup.md 1章
   */
  async startBackup(userId?: string) {
    const record = await this.beginBackup(userId);
    // ⚠️ 待たない。鍵はジョブが終わったら（成否を問わず）返す
    void this.runBackupJob(record.id, record.filename).finally(() =>
      this.releaseJob(),
    );
    return record;
  }

  /**
   * バックアップを作って完了まで待つ（定期実行が使う）。
   * ⚠️ 鍵は同じ。手動のバックアップやリストアと重ならない
   */
  async createFullBackup(userId?: string) {
    const record = await this.beginBackup(userId);
    try {
      return await this.runBackupJob(record.id, record.filename);
    } finally {
      this.releaseJob();
    }
  }

  /** 鍵を取り、running の記録を先に作る。⚠️ 作れなければ鍵を返す */
  private async beginBackup(userId?: string) {
    this.acquireJob('backup');
    try {
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .slice(0, 19);
      return await this.prisma.backupRecord.create({
        data: {
          filename: `backup-${timestamp}.zip`,
          size: BigInt(0),
          workspaceCount: 0,
          docCount: 0,
          blobCount: 0,
          status: BACKUP_STATUS.RUNNING,
          createdBy: userId ?? null,
        },
      });
    } catch (err) {
      this.releaseJob();
      throw err;
    }
  }

  /**
   * ZIP を作り、記録を completed / failed に更新する。
   * ⚠️ **投げない。** 呼び出し側が待たない（startBackup）ため、投げると誰にも拾われない
   */
  private async runBackupJob(id: string, zipFilename: string) {
    try {
      const archive = await this.buildBackupArchive(zipFilename);
      return await this.prisma.backupRecord.update({
        where: { id },
        data: { ...archive, status: BACKUP_STATUS.COMPLETED },
      });
    } catch (err) {
      this.logger.error(`Backup ${id} failed`, err);
      // 作りかけの ZIP を残さない。
      // ⚠️ ここで投げさせないこと。投げると failed への更新に届かず、記録が
      // **running のまま残る**（画面は取り直しを続け、削除も拒否され続ける）
      try {
        fs.rmSync(path.join(BACKUP_DIR, zipFilename), { force: true });
      } catch (rmErr) {
        this.logger.error(`Failed to remove partial backup ${zipFilename}`, rmErr);
      }
      return await this.prisma.backupRecord
        .update({ where: { id }, data: { status: BACKUP_STATUS.FAILED } })
        .catch((updateErr) => {
          this.logger.error(`Failed to mark backup ${id} as failed`, updateErr);
          return null;
        });
    }
  }

  /** pg_dump + ブロブを ZIP にまとめる（記録は書かない） */
  private async buildBackupArchive(zipFilename: string): Promise<BackupArchive> {
    this.logger.log('Creating full backup (pg_dump + blobs)...');

    // Work in a temporary directory, then ZIP into a single file
    const tmpDir = path.join(
      BACKUP_DIR,
      `.tmp-${zipFilename.replace(/\.zip$/, '')}`,
    );
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      // 1. pg_dump
      const dumpPath = path.join(tmpDir, 'db.dump');
      // #34: 全スキーマを読むため DDL/全読み取り権限を持つ接続を使う（ofuro_app 不可）。
      // CWE-532: パスワードは引数ではなく PGPASSWORD で渡す（失敗時のログ漏洩防止）。
      const { url: dbUrl, password: dbPassword } = getAdminDbUrl();

      await execPgTool(
        'pg_dump',
        pgDumpArgs(dumpPath, dbUrl),
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
      const zipPath = path.join(BACKUP_DIR, zipFilename);
      await this.zipDirectory(tmpDir, zipPath);
      this.logger.log('ZIP archive created');

      // 6. Get ZIP file size
      const zipSize = BigInt(fs.statSync(zipPath).size);

      this.logger.log(
        `Full backup completed: ${workspaceCount} workspaces, ${docCount} docs, ${blobCount} blobs (${(Number(zipSize) / 1024 / 1024).toFixed(1)} MB)`,
      );

      return { size: zipSize, workspaceCount, docCount, blobCount };
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

    // #212: ⚠️ 実行中は拒否する。記録だけ消えるとジョブは走り続け、
    // 最後に消えた記録を更新しようとして失敗し、**ZIP だけが残る**
    if (record.status === BACKUP_STATUS.RUNNING) {
      throw new ConflictException(BACKUP_IN_PROGRESS);
    }

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

  /**
   * バックアップから復元する。
   * #212: ⚠️ バックアップと同じ鍵を取る。pg_dump が書き換え途中の DB を読むと、
   * どちらの結果も信用できない（docs/backup.md 3章）
   */
  async restoreFromBackup(filePath: string): Promise<void> {
    this.acquireJob('restore');
    try {
      await this.restoreFromBackupUnlocked(filePath);
    } finally {
      this.releaseJob();
    }
  }

  private async restoreFromBackupUnlocked(filePath: string): Promise<void> {
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

      // ⚠️ **pg_restore は一部の失敗を「無視して続行」する。**
      // その場合もデータ本体は復元されているが、終了コードは非ゼロになる。
      // 素直に失敗として扱うと、**復元できているのに「失敗」と報告**され、
      // 障害対応中に再実行や別手段の模索を招く（実際に開発環境で発生。
      // pgvector の ivfflat 索引が maintenance_work_mem 不足で作れなかった）。
      //
      // 「無視された」とだけ言っている場合は**警告として通す**。
      try {
        await execPgTool(
          'pg_restore',
          ['--format=custom', '--clean', '--if-exists', `--dbname=${dbUrl}`, dumpPath],
          dbPassword
            ? { env: { ...process.env, PGPASSWORD: dbPassword } }
            : undefined,
        );
        this.logger.log('Database restored via pg_restore');
      } catch (err) {
        const stderr = String((err as { stderr?: string })?.stderr ?? '');
        if (!isIgnorableRestoreError(stderr)) throw err;

        // ⚠️ 握りつぶさない。**何が作られなかったか**を残す。
        // 索引が欠けると検索が遅くなるなど、後から効いてくる
        this.logger.warn(
          'Database restored, but pg_restore reported ignorable errors. ' +
            'Some indexes or constraints may not have been recreated ' +
            '(the data itself was restored):\n' +
            stderr.trim(),
        );
      }

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
      // #212: 実行中は消さない（deleteBackup も拒否する）
      where: { createdAt: { lt: cutoff }, status: { not: BACKUP_STATUS.RUNNING } },
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

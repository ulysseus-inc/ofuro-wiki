import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma.service';
import { BackupService } from '../backup/backup.service';
import { ManualWorkspaceService } from './manual-workspace.service';

/**
 * #72 マニュアル専用ワークスペースの起動時シード。
 *
 * BackupService（import）に依存するため、遅延参加を担う {@link ManualWorkspaceService}
 * とは分離している（WorkspaceModule が BackupModule を間接 import して循環するのを避ける）。
 * bootstrap（main.ts）からのみ呼ばれる。
 */
@Injectable()
export class ManualSeedService {
  private readonly logger = new Logger(ManualSeedService.name);

  /** シード版を記録する ServerSetting キー。 */
  private static readonly SEED_VERSION_KEY = 'manual_seed_version';
  /** バンドルされたマニュアル本文 zip とその版ファイルのパス。 */
  private readonly seedZipPath = join(process.cwd(), 'seed', 'manual.zip');
  private readonly seedVersionPath = join(
    process.cwd(),
    'seed',
    'manual.version'
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly backupService: BackupService,
    private readonly manualWorkspaceService: ManualWorkspaceService
  ) {}

  private readBundledVersion(): string | null {
    if (!existsSync(this.seedVersionPath)) return null;
    return readFileSync(this.seedVersionPath, 'utf-8').trim() || null;
  }

  private async getStoredVersion(): Promise<string | null> {
    const row = await this.prisma.serverSetting.findUnique({
      where: { key: ManualSeedService.SEED_VERSION_KEY },
    });
    return row?.value ?? null;
  }

  private async setStoredVersion(version: string) {
    await this.prisma.serverSetting.upsert({
      where: { key: ManualSeedService.SEED_VERSION_KEY },
      create: { key: ManualSeedService.SEED_VERSION_KEY, value: version },
      update: { value: version },
    });
  }

  /**
   * 起動時シード。冪等。
   * - シード zip が無ければ何もしない（本文未整備の段階では無効化される）。
   * - 版が未 import / 上がっていれば、既存マニュアルWSを削除して再 import。
   */
  async seedManualWorkspace() {
    if (!existsSync(this.seedZipPath)) {
      this.logger.log(
        `manual seed zip not found (${this.seedZipPath}); skipping manual workspace seed`
      );
      return;
    }
    const bundledVersion = this.readBundledVersion() ?? 'unversioned';
    const storedVersion = await this.getStoredVersion();
    const existing = await this.manualWorkspaceService.findManualWorkspace();

    if (existing && storedVersion === bundledVersion) {
      this.logger.log(
        `manual workspace up to date (version=${bundledVersion}); skipping`
      );
      return;
    }

    const system = await this.manualWorkspaceService.ensureSystemUser();

    // 再作成前に、システムアカウントが所有する全WSを削除（cascade）。
    // 固定ID化以前の旧ランダムID版が残っていても確実に掃除する（二重表示防止）。
    const removed = await this.prisma.workspace.deleteMany({
      where: { ownerId: system.id },
    });
    if (removed.count > 0) {
      this.logger.log(`removed ${removed.count} old manual workspace(s)`);
    }

    const zip = readFileSync(this.seedZipPath);
    // 名前上書き（DB＋Yjs 両方を「📖 マニュアル」に）＋バージョン由来ID上書き。
    // ID 先頭は all-f で常に最下部、末尾はバージョンハッシュで内容が変わると ID も
    // 変わる → クライアントは更新時に別WSとして空から再同期し残骸マージを防ぐ。
    const workspaceId =
      ManualWorkspaceService.workspaceIdForVersion(bundledVersion);
    const result = await this.backupService.importWorkspace(
      system.id,
      zip,
      ManualWorkspaceService.WORKSPACE_NAME,
      workspaceId
    );

    await this.setStoredVersion(bundledVersion);
    this.logger.log(
      `manual workspace seeded (id=${result.workspaceId}, version=${bundledVersion}, docs=${result.docCount})`
    );
  }
}

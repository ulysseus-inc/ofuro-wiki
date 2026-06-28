import {
  Controller,
  Post,
  Get,
  Param,
  Req,
  Res,
  UseInterceptors,
  UseGuards,
  UploadedFile,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import * as fs from 'fs';
import * as os from 'os';
import { diskStorage } from 'multer';
import { PrismaService } from '../../prisma.service';
import { BackupService } from './backup.service';
import { ScheduledBackupService } from './scheduled-backup.service';
import { AdminGuard } from '../../common/guards/admin.guard';
import { SyncGateway } from '../sync/sync.gateway';

@Controller('api')
export class BackupController {
  private readonly logger = new Logger(BackupController.name);

  constructor(
    private backupService: BackupService,
    private scheduledBackupService: ScheduledBackupService,
    private prisma: PrismaService,
    private syncGateway: SyncGateway,
  ) {}

  @Post('workspaces/:workspaceId/export')
  async exportWorkspace(
    @Param('workspaceId') workspaceId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const userId = (req as any).user?.id;
    if (!userId) {
      throw new ForbiddenException('Authentication required');
    }

    // Check workspace ownership
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) {
      throw new BadRequestException('Workspace not found');
    }
    if (workspace.ownerId !== userId) {
      throw new ForbiddenException('Only workspace owner can export');
    }

    const zipBuffer = await this.backupService.exportWorkspace(workspaceId);

    const filename = `${workspace.name || 'workspace'}.ofuro-backup.zip`;
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Content-Length': zipBuffer.length.toString(),
    });
    res.send(zipBuffer);
  }

  @Post('workspaces/import')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
    }),
  )
  async importWorkspace(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const userId = (req as any).user?.id;
    if (!userId) {
      throw new ForbiddenException('Authentication required');
    }

    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (!file.originalname.endsWith('.zip')) {
      throw new BadRequestException('File must be a .zip archive');
    }

    const result = await this.backupService.importWorkspace(
      userId,
      file.buffer,
    );

    res.json(result);
  }

  @Post('admin/restore')
  @UseGuards(AdminGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({ destination: os.tmpdir() }),
      limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10GB
    }),
  )
  async restoreBackup(
    @UploadedFile() file: Express.Multer.File,
    @Res() res: Response,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    if (!file.originalname.endsWith('.zip')) {
      throw new BadRequestException('File must be a .zip archive');
    }

    this.logger.log(`Restore requested: ${file.originalname} (${file.size} bytes)`);

    try {
      // Enter restore mode: disconnect all clients and reject new connections/pushes
      await this.syncGateway.enterRestoreMode();

      await this.scheduledBackupService.restoreFromBackup(file.path);

      res.json({ success: true, message: 'Restore completed successfully' });
    } catch (e: any) {
      this.logger.error('Restore failed', e);
      // Clean up uploaded file on error
      if (fs.existsSync(file.path)) {
        fs.rmSync(file.path, { force: true });
      }
      throw new BadRequestException(`Restore failed: ${e.message}`);
    } finally {
      // Exit restore mode after a short delay to let clients finish disconnecting
      setTimeout(() => this.syncGateway.exitRestoreMode(), 3000);
    }
  }

  @Get('admin/backups/:backupId/download')
  @UseGuards(AdminGuard)
  async downloadBackup(
    @Param('backupId') backupId: string,
    @Res() res: Response,
  ) {
    const backupPath =
      await this.scheduledBackupService.getBackupPath(backupId);
    if (!backupPath) {
      throw new NotFoundException('Backup not found');
    }

    const record = await this.prisma.backupRecord.findUnique({
      where: { id: backupId },
    });
    if (!record) {
      throw new NotFoundException('Backup record not found');
    }

    // Stream the ZIP file directly
    const stat = fs.statSync(backupPath);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(record.filename)}"`,
      'Content-Length': stat.size.toString(),
    });

    fs.createReadStream(backupPath).pipe(res);
  }
}

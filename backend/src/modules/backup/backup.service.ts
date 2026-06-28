import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import archiver from 'archiver';
import * as unzipper from 'unzipper';
import { PrismaService } from '../../prisma.service';
import { BlobService } from '../blob/blob.service';
import { mergeUpdates } from '../sync/yjs.utils';

interface ManifestJson {
  version: 1;
  format: 'ofuro-backup';
  workspaceName: string | null;
  workspaceId: string;
  exportedAt: string;
  docCount: number;
  blobCount: number;
}

interface DocMetaJson {
  docId: string;
  title: string | null;
  mode: string;
  public: boolean;
  defaultRole: string;
  createdAt: string;
  updatedAt: string;
}

interface BlobMetaJson {
  key: string;
  mime: string | null;
  size: string; // BigInt as string
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private prisma: PrismaService,
    private blobService: BlobService,
  ) {}

  async exportWorkspace(workspaceId: string): Promise<Buffer> {
    this.logger.log(`Exporting workspace ${workspaceId}`);

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) {
      throw new BadRequestException('Workspace not found');
    }

    // 1. Get all doc metadata
    const docMetas = await this.prisma.docMeta.findMany({
      where: { workspaceId },
    });

    const docsMetaJson: DocMetaJson[] = docMetas.map((d) => ({
      docId: d.docId,
      title: d.title,
      mode: d.mode,
      public: d.public,
      defaultRole: d.defaultRole,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    }));

    // 2. Collect all unique doc IDs from snapshots and updates
    const snapshotDocIds = await this.prisma.docSnapshot.findMany({
      where: { workspaceId },
      select: { docId: true },
    });
    const updateDocIds = await this.prisma.docUpdate.groupBy({
      by: ['docId'],
      where: { workspaceId },
    });
    const allDocIds = new Set([
      ...snapshotDocIds.map((s) => s.docId),
      ...updateDocIds.map((u) => u.docId),
    ]);

    // 3. Build merged Yjs binary for each doc
    const docBuffers: Map<string, Buffer> = new Map();
    for (const docId of allDocIds) {
      const snapshot = await this.prisma.docSnapshot.findUnique({
        where: { workspaceId_docId: { workspaceId, docId } },
      });
      const updates = await this.prisma.docUpdate.findMany({
        where: { workspaceId, docId },
        orderBy: { timestamp: 'asc' },
      });

      const allUpdates: Uint8Array[] = [];
      if (snapshot) {
        allUpdates.push(new Uint8Array(snapshot.blob));
      }
      for (const u of updates) {
        allUpdates.push(new Uint8Array(u.blob));
      }

      if (allUpdates.length > 0) {
        const merged = mergeUpdates(allUpdates);
        docBuffers.set(docId, Buffer.from(merged));
      }
    }

    // 4. Get all blobs
    const blobs = await this.prisma.blob.findMany({
      where: { workspaceId, deleted: false },
    });

    const blobsMetaJson: BlobMetaJson[] = blobs.map((b) => ({
      key: b.key,
      mime: b.mime,
      size: b.size?.toString() ?? '0',
    }));

    // 5. Build ZIP
    const manifest: ManifestJson = {
      version: 1,
      format: 'ofuro-backup',
      workspaceName: workspace.name,
      workspaceId: workspace.id,
      exportedAt: new Date().toISOString(),
      docCount: docBuffers.size,
      blobCount: blobs.length,
    };

    return new Promise<Buffer>((resolve, reject) => {
      const archive = archiver('zip', { zlib: { level: 6 } });
      const chunks: Buffer[] = [];

      archive.on('data', (chunk: Buffer) => chunks.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', (err) => reject(err));

      // manifest.json
      archive.append(JSON.stringify(manifest, null, 2), {
        name: 'manifest.json',
      });

      // docs-meta.json
      archive.append(JSON.stringify(docsMetaJson, null, 2), {
        name: 'docs-meta.json',
      });

      // docs/{docId}.yjs
      for (const [docId, buf] of docBuffers) {
        archive.append(buf, { name: `docs/${docId}.yjs` });
      }

      // blobs-meta.json
      archive.append(JSON.stringify(blobsMetaJson, null, 2), {
        name: 'blobs-meta.json',
      });

      // blobs/{key} — read from storage
      const blobPromises = blobs.map(async (blob) => {
        const data = await this.blobService.getBlob(workspaceId, blob.key);
        if (data) {
          archive.append(data.data, { name: `blobs/${blob.key}` });
        }
      });

      Promise.all(blobPromises)
        .then(() => archive.finalize())
        .catch((err) => reject(err));
    });
  }

  async importWorkspace(
    userId: string,
    zipBuffer: Buffer,
  ): Promise<{
    workspaceId: string;
    name: string | null;
    docCount: number;
    blobCount: number;
  }> {
    this.logger.log(`Importing workspace for user ${userId}`);

    // 1. Parse ZIP
    const directory = await unzipper.Open.buffer(zipBuffer);

    // 2. Read and validate manifest
    const manifestFile = directory.files.find(
      (f) => f.path === 'manifest.json',
    );
    if (!manifestFile) {
      throw new BadRequestException('Invalid backup: missing manifest.json');
    }
    const manifestBuf = await manifestFile.buffer();
    const manifest: ManifestJson = JSON.parse(manifestBuf.toString('utf-8'));

    if (manifest.format !== 'ofuro-backup' || manifest.version !== 1) {
      throw new BadRequestException(
        'Invalid backup: unsupported format or version',
      );
    }

    // 3. Read docs-meta.json
    const docsMetaFile = directory.files.find(
      (f) => f.path === 'docs-meta.json',
    );
    const docsMeta: DocMetaJson[] = docsMetaFile
      ? JSON.parse((await docsMetaFile.buffer()).toString('utf-8'))
      : [];

    // 4. Read blobs-meta.json
    const blobsMetaFile = directory.files.find(
      (f) => f.path === 'blobs-meta.json',
    );
    const blobsMeta: BlobMetaJson[] = blobsMetaFile
      ? JSON.parse((await blobsMetaFile.buffer()).toString('utf-8'))
      : [];

    // 5. Create new workspace
    const workspace = await this.prisma.workspace.create({
      data: {
        name: manifest.workspaceName
          ? `${manifest.workspaceName} (imported)`
          : 'Imported Workspace',
        ownerId: userId,
      },
    });

    // Also create workspace membership for the owner
    await this.prisma.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId,
        role: 'owner',
        status: 'accepted',
      },
    });

    // Also create UserSpace entry
    await this.prisma.userSpace.create({
      data: {
        userId,
        workspaceId: workspace.id,
      },
    });

    const workspaceId = workspace.id;
    const originalWorkspaceId = manifest.workspaceId;
    let docCount = 0;
    let blobCount = 0;

    // 6. Import docs
    const docFiles = directory.files.filter(
      (f) => f.path.startsWith('docs/') && f.path.endsWith('.yjs'),
    );

    for (const docFile of docFiles) {
      let docId = docFile.path.replace('docs/', '').replace('.yjs', '');
      const blob = await docFile.buffer();

      // Remap root doc: the root doc's docId must match the new workspaceId
      let finalBlob = blob;
      if (docId === originalWorkspaceId) {
        docId = workspaceId;
        // Update workspace name inside Yjs root doc
        finalBlob = await this.updateWorkspaceNameInYjs(blob, workspace.name);
      }

      // Create DocSnapshot
      await this.prisma.docSnapshot.create({
        data: {
          workspaceId,
          docId,
          blob: new Uint8Array(finalBlob),
          editorId: userId,
        },
      });

      // Create DocMeta if available (search by original docId from export)
      const originalDocId = docFile.path.replace('docs/', '').replace('.yjs', '');
      const meta = docsMeta.find((m) => m.docId === originalDocId);
      await this.prisma.docMeta.create({
        data: {
          workspaceId,
          docId,
          title: meta?.title ?? null,
          mode: meta?.mode ?? 'page',
          public: meta?.public ?? false,
          defaultRole: meta?.defaultRole ?? 'reader',
          createdById: userId,
          updatedById: userId,
        },
      });

      docCount++;
    }

    // 7. Import blobs
    const blobFiles = directory.files.filter((f) =>
      f.path.startsWith('blobs/'),
    );

    for (const blobFile of blobFiles) {
      const key = blobFile.path.replace('blobs/', '');
      const data = await blobFile.buffer();
      const meta = blobsMeta.find((m) => m.key === key);

      await this.blobService.setBlob(workspaceId, data, meta?.mime ?? undefined, key);
      blobCount++;
    }

    this.logger.log(
      `Imported workspace ${workspaceId}: ${docCount} docs, ${blobCount} blobs`,
    );

    return {
      workspaceId,
      name: workspace.name,
      docCount,
      blobCount,
    };
  }

  /**
   * Update the workspace name stored inside a Yjs root document binary.
   * The workspace name is stored in the 'meta' YMap under the key 'name'.
   */
  private async updateWorkspaceNameInYjs(
    blob: Buffer,
    newName: string | null,
  ): Promise<Buffer> {
    try {
      const Y = await import('yjs');
      const { applyUpdate, encodeStateAsUpdate } = Y;
      const doc = new Y.Doc();
      applyUpdate(doc, new Uint8Array(blob));

      const meta = doc.getMap('meta');
      if (meta && newName) {
        meta.set('name', newName);
        this.logger.log(`Updated Yjs workspace name to: ${newName}`);
      }

      const updated = encodeStateAsUpdate(doc);
      doc.destroy();
      return Buffer.from(updated);
    } catch (e) {
      this.logger.warn(`Failed to update workspace name in Yjs: ${e}`);
      return blob; // Return original if update fails
    }
  }
}

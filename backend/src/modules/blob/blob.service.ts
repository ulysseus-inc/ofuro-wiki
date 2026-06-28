import { Injectable, Inject } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma.service';
import type { BlobStorageProvider } from './storage/storage.interface';

/** base64url (RFC 4648 §5) SHA256 を生成する */
function sha256base64url(data: Buffer): string {
  return crypto
    .createHash('sha256')
    .update(data)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

@Injectable()
export class BlobService {
  constructor(
    private prisma: PrismaService,
    @Inject('BLOB_STORAGE') private storage: BlobStorageProvider,
  ) {}

  async setBlob(
    workspaceId: string,
    data: Buffer,
    mime?: string,
    keyHint?: string,
  ): Promise<string> {
    // キーはフロントエンドが生成する base64url (RFC 4648 §5) SHA256 を使用。
    // keyHint が無い場合（コメント添付等）はサーバー側で同フォーマットのキーを生成する。
    const key = keyHint || sha256base64url(data);

    // Check if already exists
    const existing = await this.prisma.blob.findUnique({
      where: { workspaceId_key: { workspaceId, key } },
    });
    if (existing && !existing.deleted) {
      return key;
    }

    const storagePath = await this.storage.put(
      `${workspaceId}/${key}`,
      data,
      mime,
    );

    await this.prisma.blob.upsert({
      where: { workspaceId_key: { workspaceId, key } },
      create: {
        workspaceId,
        key,
        mime,
        size: BigInt(data.length),
        storagePath,
        deleted: false,
      },
      update: {
        deleted: false,
        storagePath,
        mime,
        size: BigInt(data.length),
      },
    });

    return key;
  }

  async getBlob(workspaceId: string, key: string) {
    const blob = await this.prisma.blob.findUnique({
      where: { workspaceId_key: { workspaceId, key } },
    });

    if (!blob || blob.deleted) return null;

    const data = await this.storage.get(`${workspaceId}/${blob.key}`);
    return data ? { data, mime: blob.mime, size: blob.size } : null;
  }

  async deleteBlob(workspaceId: string, key: string): Promise<boolean> {
    await this.prisma.blob.updateMany({
      where: { workspaceId, key },
      data: { deleted: true },
    });
    return true;
  }

  async deleteBlobPermanently(
    workspaceId: string,
    key: string,
  ): Promise<boolean> {
    // Delete physical file from storage
    await this.storage.delete(`${workspaceId}/${key}`);

    // Delete DB record
    await this.prisma.blob.deleteMany({
      where: { workspaceId, key },
    });
    return true;
  }

  async releaseDeletedBlobs(workspaceId: string): Promise<boolean> {
    // Find all soft-deleted blobs
    const deletedBlobs = await this.prisma.blob.findMany({
      where: { workspaceId, deleted: true },
      select: { key: true },
    });

    // Delete physical files and DB records
    for (const blob of deletedBlobs) {
      await this.storage.delete(`${workspaceId}/${blob.key}`);
    }
    await this.prisma.blob.deleteMany({
      where: { workspaceId, deleted: true },
    });

    return true;
  }

  async listBlobs(workspaceId: string) {
    return this.prisma.blob.findMany({
      where: { workspaceId, deleted: false },
      select: { key: true, mime: true, size: true, createdAt: true },
    });
  }
}

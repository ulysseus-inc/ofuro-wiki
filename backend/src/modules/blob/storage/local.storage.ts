import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { BlobStorageProvider } from './storage.interface';

@Injectable()
export class LocalStorage implements BlobStorageProvider {
  private basePath: string;

  constructor() {
    this.basePath = process.env.BLOB_STORAGE_PATH || './data/blobs';
  }

  async put(key: string, data: Buffer): Promise<string> {
    const filePath = this.getFilePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
    return filePath;
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const filePath = this.getFilePath(key);
      return await fs.readFile(filePath);
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const filePath = this.getFilePath(key);
      await fs.unlink(filePath);
    } catch {
      // File may not exist
    }
  }

  private getFilePath(key: string): string {
    // Use first 2 chars of key as subdirectory to avoid too many files in one dir
    const subdir = key.substring(0, 2);
    const filePath = path.join(this.basePath, subdir, key);

    // 多層防御(L-4): 万一 key に traversal が含まれても basePath 外へ出さない。
    const baseResolved = path.resolve(this.basePath);
    const resolved = path.resolve(filePath);
    const safePrefix = baseResolved.endsWith(path.sep)
      ? baseResolved
      : baseResolved + path.sep;
    if (resolved !== baseResolved && !resolved.startsWith(safePrefix)) {
      throw new Error(`Blob key escapes storage base path: ${key}`);
    }
    return filePath;
  }
}

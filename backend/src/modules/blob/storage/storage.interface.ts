export interface BlobStorageProvider {
  put(key: string, data: Buffer, mime?: string): Promise<string>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

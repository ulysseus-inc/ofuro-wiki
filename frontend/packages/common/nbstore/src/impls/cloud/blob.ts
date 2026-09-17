import { UserFriendlyError } from '@ofuro/error';
import {
  BlobUploadMethod,
  createBlobUploadMutation,
  deleteBlobMutation,
  listBlobsQuery,
  releaseDeletedBlobsMutation,
  setBlobMutation,
  workspaceBlobQuotaQuery,
} from '@ofuro/graphql';

import {
  type BlobRecord,
  BlobStorageBase,
  OverCapacityError,
  OverSizeError,
} from '../../storage';
import { HttpConnection } from './http';

interface CloudBlobStorageOptions {
  serverBaseUrl: string;
  id: string;
}

const SHOULD_MANUAL_REDIRECT =
  BUILD_CONFIG.isAndroid || BUILD_CONFIG.isIOS || BUILD_CONFIG.isElectron;
const UPLOAD_REQUEST_TIMEOUT = 0;

export class CloudBlobStorage extends BlobStorageBase {
  static readonly identifier = 'CloudBlobStorage';
  override readonly isReadonly = false;

  constructor(private readonly options: CloudBlobStorageOptions) {
    super();
  }

  readonly connection = new HttpConnection(this.options.serverBaseUrl);

  override async get(key: string, signal?: AbortSignal) {
    const res = await this.connection.fetch(
      '/api/workspaces/' +
        this.options.id +
        '/blobs/' +
        key +
        (SHOULD_MANUAL_REDIRECT ? '?redirect=manual' : ''),
      {
        cache: 'default',
        headers: {
          'x-affine-version': BUILD_CONFIG.appVersion,
        },
        signal,
      }
    );

    if (res.status === 404) {
      return null;
    }

    try {
      const contentType = res.headers.get('content-type');

      let blob;

      if (
        SHOULD_MANUAL_REDIRECT &&
        contentType?.startsWith('application/json')
      ) {
        const json = await res.json();
        if ('url' in json && typeof json.url === 'string') {
          const res = await this.connection.fetch(json.url, {
            cache: 'default',
            headers: {
              'x-affine-version': BUILD_CONFIG.appVersion,
            },
            signal,
          });

          blob = await res.blob();
        } else {
          throw new Error('Invalid blob response');
        }
      } else {
        blob = await res.blob();
      }

      return {
        key,
        data: new Uint8Array(await blob.arrayBuffer()),
        mime: blob.type,
        size: blob.size,
        createdAt: new Date(res.headers.get('last-modified') || Date.now()),
      };
    } catch (err) {
      throw new Error('blob download error: ' + err);
    }
  }

  override async set(blob: BlobRecord, signal?: AbortSignal) {
    try {
      const blobSizeLimit = await this.getBlobSizeLimit();
      if (blob.data.byteLength > blobSizeLimit) {
        throw new OverSizeError(this.humanReadableBlobSizeLimitCache);
      }

      const init = await this.connection.gql({
        query: createBlobUploadMutation,
        variables: {
          workspaceId: this.options.id,
          key: blob.key,
          size: blob.data.byteLength,
          mime: blob.mime,
        },
        context: { signal },
      });

      const upload = init.createBlobUpload;
      if (upload.alreadyUploaded) {
        return;
      }
      // ⚠️ #204: バックエンドは常に GRAPHQL を返す（PRESIGNED / MULTIPART は
      // AFFiNE 由来で、ofuro-wiki のバックエンドには実装が無い）
      if (upload.method !== BlobUploadMethod.GRAPHQL) {
        throw new Error(`Unsupported blob upload method: ${upload.method}`);
      }

      await this.uploadViaGraphql(blob, signal);
    } catch (err) {
      const userFriendlyError = UserFriendlyError.fromAny(err);
      if (userFriendlyError.is('STORAGE_QUOTA_EXCEEDED')) {
        throw new OverCapacityError();
      }
      if (userFriendlyError.is('BLOB_QUOTA_EXCEEDED')) {
        throw new OverSizeError(this.humanReadableBlobSizeLimitCache);
      }
      if (userFriendlyError.is('CONTENT_TOO_LARGE')) {
        throw new OverSizeError(
          null,
          'Upload stopped by network proxy: file size exceeds the set limit.'
        );
      }
      throw err;
    }
  }

  override async delete(key: string, permanently: boolean) {
    await this.connection.gql({
      query: deleteBlobMutation,
      variables: { workspaceId: this.options.id, key, permanently },
    });
  }

  override async release() {
    await this.connection.gql({
      query: releaseDeletedBlobsMutation,
      variables: { workspaceId: this.options.id },
    });
  }

  override async list() {
    const res = await this.connection.gql({
      query: listBlobsQuery,
      variables: { workspaceId: this.options.id },
    });

    return res.workspace.blobs.map(blob => ({
      ...blob,
      createdAt: new Date(blob.createdAt),
    }));
  }

  private async uploadViaGraphql(blob: BlobRecord, signal?: AbortSignal) {
    await this.connection.gql({
      query: setBlobMutation,
      variables: {
        workspaceId: this.options.id,
        blob: new File([blob.data], blob.key, { type: blob.mime }),
      },
      context: { signal },
      timeout: UPLOAD_REQUEST_TIMEOUT,
    });
  }

  private humanReadableBlobSizeLimitCache: string | null = null;
  private blobSizeLimitCache: number | null = null;
  private blobSizeLimitCacheTime = 0;
  private async getBlobSizeLimit() {
    // If cache time is less than 120 seconds, return the cached value directly
    if (
      this.blobSizeLimitCache !== null &&
      Date.now() - this.blobSizeLimitCacheTime < 120 * 1000
    ) {
      return this.blobSizeLimitCache;
    }
    try {
      const res = await this.connection.gql({
        query: workspaceBlobQuotaQuery,
        variables: { id: this.options.id },
      });

      // #210: スキーマでは quota は null を許す。上限が分からないときはクライアントで止めない
      // （上限はサーバーでも検査する）
      const quota = res.workspace.quota;
      if (!quota) {
        return Number.POSITIVE_INFINITY;
      }
      this.humanReadableBlobSizeLimitCache = quota.humanReadable.blobLimit;
      this.blobSizeLimitCache = quota.blobLimit;
      this.blobSizeLimitCacheTime = Date.now();
      return this.blobSizeLimitCache;
    } catch (err) {
      throw UserFriendlyError.fromAny(err);
    }
  }
}

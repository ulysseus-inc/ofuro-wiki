import {
  Resolver,
  Mutation,
  Query,
  Args,
  ObjectType,
  Field,
  Int,
  registerEnumType,
} from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { BlobService } from './blob.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import GraphQLJSON from 'graphql-type-json';
import GraphQLUpload from 'graphql-upload/GraphQLUpload.mjs';

interface FileUpload {
  filename: string;
  mimetype: string;
  encoding: string;
  createReadStream: () => NodeJS.ReadableStream;
}

@ObjectType()
export class ListedBlob {
  @Field()
  key: string;

  @Field()
  mime: string;

  @Field(() => Int)
  size: number;

  @Field()
  createdAt: string;
}

enum BlobUploadMethod {
  GRAPHQL = 'GRAPHQL',
  PRESIGNED = 'PRESIGNED',
  MULTIPART = 'MULTIPART',
}

registerEnumType(BlobUploadMethod, { name: 'BlobUploadMethod' });

@ObjectType()
class BlobUploadedPart {
  @Field(() => Int)
  partNumber: number;

  @Field()
  etag: string;
}

@ObjectType()
class BlobUploadInit {
  @Field(() => BlobUploadMethod)
  method: BlobUploadMethod;

  @Field()
  blobKey: string;

  @Field({ nullable: true })
  alreadyUploaded?: boolean;

  @Field({ nullable: true })
  uploadUrl?: string;

  @Field(() => GraphQLJSON, { nullable: true })
  headers?: Record<string, string>;

  @Field({ nullable: true })
  expiresAt?: Date;

  @Field({ nullable: true })
  uploadId?: string;

  @Field(() => Int, { nullable: true })
  partSize?: number;

  @Field(() => [BlobUploadedPart], { nullable: true })
  uploadedParts?: BlobUploadedPart[];
}

@Resolver()
@UseGuards(JwtAuthGuard)
export class BlobResolver {
  constructor(private blobService: BlobService) {}

  @Query(() => [ListedBlob])
  async listBlobs(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
  ) {
    const blobs = await this.blobService.listBlobs(workspaceId);
    return blobs.map((b) => ({
      key: b.key,
      mime: b.mime || 'application/octet-stream',
      size: b.size ? Number(b.size) : 0,
      createdAt: b.createdAt.toISOString(),
    }));
  }

  @Mutation(() => BlobUploadInit)
  async createBlobUpload(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @Args('key') key: string,
    @Args('size', { type: () => Int }) size: number,
    @Args('mime') mime: string,
  ): Promise<BlobUploadInit> {
    // Check if blob already exists
    const existing = await this.blobService.getBlob(workspaceId, key);
    if (existing) {
      return {
        method: BlobUploadMethod.GRAPHQL,
        blobKey: key,
        alreadyUploaded: true,
      };
    }

    // For selfhost, use GRAPHQL method (direct setBlob mutation)
    return {
      method: BlobUploadMethod.GRAPHQL,
      blobKey: key,
      alreadyUploaded: false,
    };
  }

  @Mutation(() => Boolean)
  async completeBlobUpload(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @Args('key') key: string,
  ): Promise<boolean> {
    // No-op for GRAPHQL upload method - blob is already saved by setBlob
    return true;
  }

  @Mutation(() => String)
  async setBlob(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @Args('blob', { type: () => GraphQLUpload }) blob: FileUpload,
  ): Promise<string> {
    const { filename, createReadStream, mimetype } = blob;
    const chunks: Buffer[] = [];
    const stream = createReadStream();
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const data = Buffer.concat(chunks);
    // filename はフロントエンドが設定した blob key（例: base64 SHA256）を使用
    return this.blobService.setBlob(workspaceId, data, mimetype, filename || undefined);
  }

  @Mutation(() => Boolean)
  async deleteBlob(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @Args('key') key: string,
    @Args('permanently', { type: () => Boolean, nullable: true }) permanently?: boolean,
  ) {
    if (permanently) {
      return this.blobService.deleteBlobPermanently(workspaceId, key);
    }
    return this.blobService.deleteBlob(workspaceId, key);
  }

  @Mutation(() => Boolean)
  async releaseDeletedBlobs(
    @Args('workspaceId', { type: () => String }) workspaceId: string,
  ): Promise<boolean> {
    return this.blobService.releaseDeletedBlobs(workspaceId);
  }
}

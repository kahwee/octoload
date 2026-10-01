import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  StorageAdapter,
  S3ClientConfig,
  HeadObjectCommandOutput,
} from '../types/index.js';

export class S3StorageAdapter {
  private client: S3Client;
  private bucket: string;
  private region: string;
  private isR2: boolean;
  private publicBaseUrl?: string;

  constructor(config: StorageAdapter) {
    // Validate configuration
    if (!config.bucket) {
      throw new Error('Bucket name is required');
    }
    if (!config.region) {
      throw new Error('Region is required');
    }
    if (!config.credentials?.accessKeyId) {
      throw new Error('Access Key ID is required');
    }
    if (!config.credentials?.secretAccessKey) {
      throw new Error('Secret Access Key is required');
    }

    // Use AWS SDK configuration directly
    const clientConfig: S3ClientConfig = {
      region: config.region,
      credentials: config.credentials,
      // Presigning has no body to checksum. SDK automatic CRC32 would sign the
      // empty-body checksum and reject the browser's actual file contents.
      requestChecksumCalculation: 'WHEN_REQUIRED',
    };

    // R2 uses an S3-compatible API endpoint, separate from its public domain.
    if (config.adapter === 'r2' && !config.endpoint) {
      throw new Error('R2 endpoint is required');
    }
    if (config.adapter === 'r2') {
      clientConfig.endpoint = config.endpoint;
      this.isR2 = true;
    } else {
      this.isR2 = false;
    }

    this.client = new S3Client(clientConfig);
    this.bucket = config.bucket;
    this.region = config.region;
    if (config.publicBaseUrl) {
      let base: URL;
      try {
        base = new URL(config.publicBaseUrl);
      } catch {
        throw new Error('publicBaseUrl must be an absolute HTTP URL');
      }
      if (
        !['http:', 'https:'].includes(base.protocol) ||
        base.username ||
        base.password ||
        base.search ||
        base.hash
      ) {
        throw new Error('publicBaseUrl must be an absolute HTTP URL');
      }
      this.publicBaseUrl = base.href.replace(/\/+$/, '');
    }
  }

  async getPresignedPutUrl(
    key: string,
    contentType: string,
    expiresIn: number = 3600,
    byteSize?: number
  ): Promise<{ url: string; fields?: Record<string, string> }> {
    if (
      byteSize !== undefined &&
      (!Number.isSafeInteger(byteSize) || byteSize <= 0)
    ) {
      throw new Error('Byte size must be a positive safe integer');
    }
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: byteSize,
      // Require an absent key atomically; URL replay cannot replace uploaded bytes.
      IfNoneMatch: '*',
    });

    const signableHeaders = new Set(['if-none-match', 'content-type']);
    if (byteSize !== undefined) signableHeaders.add('content-length');
    const url = await getSignedUrl(this.client, command, {
      expiresIn,
      signableHeaders,
    });

    // Browser upload clients must send these headers. Content-Length is derived
    // automatically from the File body by the browser, so it is not returned.
    return {
      url,
      fields: { 'If-None-Match': '*', 'Content-Type': contentType },
    };
  }

  async getMultipartUpload(
    key: string,
    contentType: string,
    partCount: number,
    expiresIn: number = 3600
  ): Promise<{
    uploadId: string;
    parts: { partNumber: number; uploadUrl: string }[];
  }> {
    // Validate part count (S3 limits: 1-10,000 parts)
    if (partCount < 1 || partCount > 10000) {
      throw new Error('Part count must be between 1 and 10000');
    }

    // Initialize multipart upload
    const createCommand = new CreateMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    const createResponse = await this.client.send(createCommand);
    const uploadId = createResponse.UploadId!;

    // Generate presigned URLs for each part
    const parts = await Promise.all(
      Array.from({ length: partCount }, async (_, i) => {
        const partNumber = i + 1;
        const partCommand = new UploadPartCommand({
          Bucket: this.bucket,
          Key: key,
          PartNumber: partNumber,
          UploadId: uploadId,
        });

        const uploadUrl = await getSignedUrl(this.client, partCommand, {
          expiresIn,
        });

        return { partNumber, uploadUrl };
      })
    );

    return { uploadId, parts };
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: { partNumber: number; etag: string }[]
  ): Promise<void> {
    // Validate parts array
    if (!parts || parts.length === 0) {
      throw new Error('Parts array cannot be empty');
    }

    // Sort parts by part number for S3 compatibility
    const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);

    const command = new CompleteMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: sortedParts.map((part) => ({
          ETag: part.etag,
          PartNumber: part.partNumber,
        })),
      },
    });

    await this.client.send(command);
  }

  getPublicUrl(key: string): string {
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    if (this.publicBaseUrl) {
      return `${this.publicBaseUrl}/${encodedKey}`;
    }
    if (this.isR2) {
      throw new Error('Public R2 uploads require storage.publicBaseUrl');
    }

    // S3 public URL format - use region-specific endpoint
    if (this.region === 'us-east-1') {
      return `https://${this.bucket}.s3.amazonaws.com/${encodedKey}`;
    }
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${encodedKey}`;
  }

  async getPrivateUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return await getSignedUrl(this.client, command, { expiresIn });
  }

  async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    await this.client.send(command);
  }

  async headObject(
    key: string
  ): Promise<
    Pick<HeadObjectCommandOutput, 'ContentLength' | 'ETag' | 'ContentType'>
  > {
    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const response = await this.client.send(command);

    return {
      ContentLength: response.ContentLength,
      ETag: response.ETag,
      ContentType: response.ContentType,
    };
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.client.send(command);
      return true;
    } catch (error) {
      // If object doesn't exist, S3 returns 404
      if (
        error &&
        typeof error === 'object' &&
        'name' in error &&
        error.name === 'NotFound'
      ) {
        return false;
      }
      // Re-throw other errors (permissions, network, etc.)
      throw error;
    }
  }
}

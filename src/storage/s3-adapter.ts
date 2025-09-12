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
  StorageAdapterInterface,
} from '../types/index.js';

export class S3StorageAdapter implements StorageAdapterInterface {
  private client: S3Client;
  private bucket: string;
  private isR2: boolean;

  constructor(config: StorageAdapter) {
    // Validate configuration
    if (!config.bucket) {
      throw new Error('Bucket name is required');
    }
    if (!config.region) {
      throw new Error('Region is required');
    }
    if (!config.credentials.accessKeyId) {
      throw new Error('Access Key ID is required');
    }
    if (!config.credentials.secretAccessKey) {
      throw new Error('Secret Access Key is required');
    }

    const clientConfig: {
      region: string;
      credentials: { accessKeyId: string; secretAccessKey: string };
      endpoint?: string;
    } = {
      region: config.region,
      credentials: config.credentials,
    };

    // R2 configuration
    if (config.adapter === 'r2' && config.endpoint) {
      clientConfig.endpoint = config.endpoint;
      this.isR2 = true;
    } else {
      this.isR2 = false;
    }

    this.client = new S3Client(clientConfig);
    this.bucket = config.bucket;
  }

  async getPresignedPutUrl(
    key: string,
    contentType: string,
    expiresIn: number = 3600
  ): Promise<{ url: string; fields?: Record<string, string> }> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    const url = await getSignedUrl(this.client, command, { expiresIn });

    return { url };
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
    if (this.isR2) {
      // R2 public URL format - use custom domain if available
      const endpoint = this.client.config.endpoint;
      if (typeof endpoint === 'string') {
        return `${endpoint}/${this.bucket}/${key}`;
      }
    }

    // S3 public URL format - use region-specific endpoint
    const region = this.client.config.region;
    if (region === 'us-east-1') {
      return `https://${this.bucket}.s3.amazonaws.com/${key}`;
    }
    return `https://${this.bucket}.s3.${region}.amazonaws.com/${key}`;
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

  async headObject(key: string): Promise<{
    contentLength: number;
    etag: string;
    contentType: string;
  }> {
    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const response = await this.client.send(command);

    return {
      contentLength: response.ContentLength || 0,
      etag: response.ETag?.replace(/"/g, '') || '',
      contentType: response.ContentType || '',
    };
  }
}

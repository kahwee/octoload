import { beforeEach, describe, expect, it, vi } from 'vitest';
import { S3StorageAdapter } from '../storage/s3-adapter.js';

// Mock the AWS SDK
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function S3ClientMock() {
    return {
      send: vi.fn(),
      config: {
        region: 'us-east-1',
      },
    };
  }),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
  HeadObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
  CreateMultipartUploadCommand: vi.fn(),
  CompleteMultipartUploadCommand: vi.fn(),
  UploadPartCommand: vi.fn(),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://example.com/presigned-url'),
}));

describe('S3StorageAdapter', () => {
  let adapter: S3StorageAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new S3StorageAdapter({
      adapter: 's3',
      bucket: 'test-bucket',
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
      },
    });
  });

  describe('getPresignedPutUrl', () => {
    it('should generate presigned URL for single upload', async () => {
      const result = await adapter.getPresignedPutUrl(
        'test-key',
        'image/jpeg',
        3600
      );

      expect(result.url).toBe('https://example.com/presigned-url');
      expect(result.fields).toEqual({
        'If-None-Match': '*',
        'Content-Type': 'image/jpeg',
      });
    });

    it('should handle different content types', async () => {
      await adapter.getPresignedPutUrl('test-key', 'image/png', 3600);
      await adapter.getPresignedPutUrl('test-key', 'image/webp', 3600);
      await adapter.getPresignedPutUrl('test-key', 'image/gif', 3600);

      // Should not throw errors for valid image types
      expect(true).toBe(true);
    });
  });

  describe('getMultipartUpload', () => {
    it('should initialize multipart upload', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        UploadId: 'test-upload-id',
      });

      // Mock S3Client send method
      adapter['client'].send = mockSend;

      const result = await adapter.getMultipartUpload(
        'large-file-key',
        'video/mp4',
        3,
        3600
      );

      expect(result.uploadId).toBe('test-upload-id');
      expect(result.parts).toHaveLength(3);
      expect(result.parts[0]).toEqual({
        partNumber: 1,
        uploadUrl: 'https://example.com/presigned-url',
      });
    });

    it('should validate part count limits', async () => {
      await expect(
        adapter.getMultipartUpload('key', 'image/jpeg', 0, 3600)
      ).rejects.toThrow('Part count must be an integer between 1 and 10000');

      await expect(
        adapter.getMultipartUpload('key', 'image/jpeg', 10001, 3600)
      ).rejects.toThrow('Part count must be an integer between 1 and 10000');
    });
  });

  describe('completeMultipartUpload', () => {
    it('should complete multipart upload with parts', async () => {
      const mockSend = vi.fn().mockResolvedValue({});
      adapter['client'].send = mockSend;

      const parts = [
        { partNumber: 1, etag: 'etag1' },
        { partNumber: 2, etag: 'etag2' },
      ];

      await adapter.completeMultipartUpload('test-key', 'upload-id', parts);

      expect(mockSend).toHaveBeenCalledOnce();
    });

    it('should validate parts are provided', async () => {
      await expect(
        adapter.completeMultipartUpload('key', 'upload-id', [])
      ).rejects.toThrow('Parts array cannot be empty');
    });
  });

  describe('URL generation', () => {
    it('should generate public URL correctly', () => {
      const url = adapter.getPublicUrl('test-file.jpg');
      expect(url).toBe('https://test-bucket.s3.amazonaws.com/test-file.jpg');
    });

    it('uses the configured region and encodes object keys', () => {
      const regional = new S3StorageAdapter({
        adapter: 's3',
        bucket: 'test-bucket',
        region: 'us-west-2',
        credentials: { accessKeyId: 'key', secretAccessKey: 'secret' },
      });
      expect(regional.getPublicUrl('photos/my image.jpg')).toBe(
        'https://test-bucket.s3.us-west-2.amazonaws.com/photos/my%20image.jpg'
      );
    });

    it('should generate private URL', async () => {
      const url = await adapter.getPrivateUrl('private-file.jpg', 1800);
      expect(url).toBe('https://example.com/presigned-url');
    });
  });

  describe('object operations', () => {
    it('should head object and return metadata', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        ContentLength: 1024,
        ETag: '"abc123"',
        ContentType: 'image/jpeg',
      });

      adapter['client'].send = mockSend;

      const result = await adapter.headObject('test-file.jpg');

      expect(result).toEqual({
        ContentLength: 1024,
        ETag: '"abc123"',
        ContentType: 'image/jpeg',
      });
    });

    it('should delete object', async () => {
      const mockSend = vi.fn().mockResolvedValue({});
      adapter['client'].send = mockSend;

      await adapter.deleteObject('file-to-delete.jpg');

      expect(mockSend).toHaveBeenCalledOnce();
    });
  });

  describe('error handling', () => {
    it('should handle S3 service errors gracefully', async () => {
      const mockError = new Error('S3 Service Error');
      const mockSend = vi.fn().mockRejectedValue(mockError);
      adapter['client'].send = mockSend;

      await expect(adapter.headObject('nonexistent-file.jpg')).rejects.toThrow(
        'S3 Service Error'
      );
    });

    it('should validate configuration on creation', () => {
      expect(
        () =>
          new S3StorageAdapter({
            adapter: 's3',
            bucket: '',
            region: 'us-east-1',
            credentials: {
              accessKeyId: 'key',
              secretAccessKey: 'secret',
            },
          })
      ).toThrow('Bucket name is required');

      expect(
        () =>
          new S3StorageAdapter({
            adapter: 's3',
            bucket: 'test-bucket',
            region: '',
            credentials: {
              accessKeyId: 'key',
              secretAccessKey: 'secret',
            },
          })
      ).toThrow('Region is required');
    });
  });
});

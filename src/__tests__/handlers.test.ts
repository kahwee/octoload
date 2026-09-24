import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandlerOptions } from '../handlers/index.js';
import {
  createDeleteImageHandler,
  createFinalizeHandler,
  createGetImageHandler,
  createGetImagesForEntityHandler,
  createPresignHandler,
} from '../handlers/index.js';

// Create mock core methods
const mockCore = {
  presign: vi.fn(),
  finalize: vi.fn(),
  getImage: vi.fn(),
  deleteImage: vi.fn(),
  getImagesForEntity: vi.fn(),
};

// Mock the core implementation
vi.mock('../handlers/core.js', () => ({
  OctoloadCore: vi.fn(function OctoloadCoreMock() {
    return mockCore;
  }),
}));

// Mock storage adapter
const mockStorageAdapter = {
  getPresignedPutUrl: vi.fn(),
  getMultipartUpload: vi.fn(),
  completeMultipartUpload: vi.fn(),
  getPublicUrl: vi.fn(),
  getPrivateUrl: vi.fn(),
  headObject: vi.fn(),
  deleteObject: vi.fn(),
};

// Mock database
const mockDb = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(),
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  query: {},
};

// Mock schema
const mockSchema = {
  images: {
    id: 'id',
    ownerId: 'ownerId',
    filename: 'filename',
    contentType: 'contentType',
    byteSize: 'byteSize',
    status: 'status',
    storageKey: 'storageKey',
    publicUrl: 'publicUrl',
    isPublic: 'isPublic',
  },
  uploadSessions: {},
  assetVariants: {},
  imageTags: {},
  imageStatusEnum: {},
  assetVariantEnum: {},
  tableNames: {},
};

describe('Handlers', () => {
  let handlerOptions: HandlerOptions;

  beforeEach(() => {
    vi.clearAllMocks();

    // Clear mock core methods
    mockCore.presign.mockClear();
    mockCore.finalize.mockClear();
    mockCore.getImage.mockClear();
    mockCore.deleteImage.mockClear();

    handlerOptions = {
      storage: mockStorageAdapter,
      db: mockDb,
      schema: mockSchema,
      config: {
        adapter: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
      },
    };
  });

  describe('createPresignHandler', () => {
    it('should handle valid presign request', async () => {
      const handler = createPresignHandler(handlerOptions);

      // Mock the core presign method
      mockCore.presign.mockResolvedValue({
        uploadUrl: 'https://s3.amazonaws.com/presigned-url',
        storageKey: 'uploads/2025/test.jpg',
        expiresAt: new Date(Date.now() + 3600000),
      });

      const request = new Request('http://localhost/api/uploads/presign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filename: 'test.jpg',
          contentType: 'image/jpeg',
          byteSize: 1024,
          isPublic: true,
        }),
      });

      const context = {
        request,
        user: { id: 'user-123' },
        params: {},
      };

      const response = await handler(request, context);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.uploadUrl).toBe('https://s3.amazonaws.com/presigned-url');
      expect(data.storageKey).toBe('uploads/2025/test.jpg');

      // Verify the presign method was called with correct data
      expect(mockCore.presign).toHaveBeenCalledWith({
        filename: 'test.jpg',
        contentType: 'image/jpeg',
        byteSize: 1024,
        isPublic: true,
        ownerId: 'user-123',
      });
    });

    it('should reject invalid content types', async () => {
      const handler = createPresignHandler(handlerOptions);

      // Mock the core to throw an error for invalid content type
      mockCore.presign.mockRejectedValue(new Error('Invalid content type'));

      const request = new Request('http://localhost/api/uploads/presign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filename: 'document.pdf',
          contentType: 'application/pdf',
          byteSize: 1024,
        }),
      });

      const context = {
        request,
        user: { id: 'user-123' },
        params: {},
      };

      const response = await handler(request, context);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBe('Invalid content type');
    });

    it('should require user authentication when configured', async () => {
      const secureOptions = {
        ...handlerOptions,
        requireAuth: true,
      };
      const handler = createPresignHandler(secureOptions);

      const request = new Request('http://localhost/api/uploads/presign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filename: 'test.jpg',
          contentType: 'image/jpeg',
          byteSize: 1024,
        }),
      });

      const context = {
        request,
        user: undefined,
        params: {},
      };

      const response = await handler(request, context);
      expect(response.status).toBe(401);

      const data = await response.json();
      expect(data.error).toBe('Authentication required');

      // Verify core method was not called
      expect(mockCore.presign).not.toHaveBeenCalled();
    });

    it('ignores an owner ID supplied by an unauthenticated client', async () => {
      const handler = createPresignHandler(handlerOptions);
      mockCore.presign.mockResolvedValue({ storageKey: 'uploads/test.jpg' });
      const request = new Request('http://localhost/api/uploads/presign', {
        method: 'POST',
        body: JSON.stringify({
          filename: 'test.jpg',
          contentType: 'image/jpeg',
          byteSize: 1,
          isPublic: true,
          ownerId: 'someone-else',
        }),
      });

      await handler(request);
      expect(mockCore.presign).toHaveBeenCalledWith(
        expect.objectContaining({ ownerId: undefined })
      );
    });

    it('rejects an anonymous private upload before signing', async () => {
      const handler = createPresignHandler(handlerOptions);
      const request = new Request('http://localhost/api/uploads/presign', {
        method: 'POST',
        body: JSON.stringify({
          filename: 'secret.jpg',
          contentType: 'image/jpeg',
          byteSize: 1,
        }),
      });
      const response = await handler(request);
      expect(response.status).toBe(401);
      expect(mockCore.presign).not.toHaveBeenCalled();
    });

    it('should handle multipart uploads for large files', async () => {
      const handler = createPresignHandler(handlerOptions);

      const largeFileSize = 100 * 1024 * 1024; // 100MB

      // Mock the core presign method to return multipart response
      mockCore.presign.mockResolvedValue({
        storageKey: 'uploads/2025/large-file.jpg',
        multipart: {
          uploadId: 'multipart-123',
          parts: [
            { partNumber: 1, uploadUrl: 'https://s3.amazonaws.com/part1' },
            { partNumber: 2, uploadUrl: 'https://s3.amazonaws.com/part2' },
          ],
        },
        expiresAt: new Date(Date.now() + 3600000),
      });

      const request = new Request('http://localhost/api/uploads/presign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filename: 'large-file.jpg',
          contentType: 'image/jpeg',
          byteSize: largeFileSize,
          isPublic: false,
        }),
      });

      const context = {
        request,
        user: { id: 'user-123' },
        params: {},
      };

      const response = await handler(request, context);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.multipart).toBeDefined();
      expect(data.multipart.uploadId).toBe('multipart-123');
      expect(data.multipart.parts).toHaveLength(2);

      // Verify the presign method was called with correct data
      expect(mockCore.presign).toHaveBeenCalledWith({
        filename: 'large-file.jpg',
        contentType: 'image/jpeg',
        byteSize: largeFileSize,
        isPublic: false,
        ownerId: 'user-123',
      });
    });
  });

  describe('createFinalizeHandler', () => {
    it('should finalize single file upload', async () => {
      const handler = createFinalizeHandler(handlerOptions);

      // Mock the core finalize method
      mockCore.finalize.mockResolvedValue({
        id: 'img-123',
        filename: 'test.jpg',
        contentType: 'image/jpeg',
        status: 'ready',
        publicUrl: 'https://cdn.example.com/test.jpg',
        ownerId: 'user-123',
        byteSize: 1024,
        storageKey: 'uploads/2025/test.jpg',
        isPublic: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const request = new Request('http://localhost/api/uploads/finalize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          storageKey: 'uploads/2025/test.jpg',
        }),
      });

      const response = await handler(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.status).toBe('ready');
      expect(data.publicUrl).toBe('https://cdn.example.com/test.jpg');

      // Verify the finalize method was called with correct data
      expect(mockCore.finalize).toHaveBeenCalledWith(
        { storageKey: 'uploads/2025/test.jpg' },
        undefined
      );
    });

    it('should handle multipart upload completion', async () => {
      const handler = createFinalizeHandler(handlerOptions);

      // Mock the core finalize method
      mockCore.finalize.mockResolvedValue({
        id: 'img-456',
        filename: 'large-file.jpg',
        contentType: 'image/jpeg',
        status: 'ready',
        publicUrl: null,
        ownerId: 'user-123',
        byteSize: 100 * 1024 * 1024,
        storageKey: 'uploads/2025/large-file.jpg',
        isPublic: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const request = new Request('http://localhost/api/uploads/finalize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          storageKey: 'uploads/2025/large-file.jpg',
          uploadId: 'multipart-123',
          parts: [
            { partNumber: 1, etag: 'part1-etag' },
            { partNumber: 2, etag: 'part2-etag' },
          ],
        }),
      });

      const response = await handler(request);
      expect(response.status).toBe(200);

      // Verify the finalize method was called with correct data
      expect(mockCore.finalize).toHaveBeenCalledWith(
        {
          storageKey: 'uploads/2025/large-file.jpg',
          uploadId: 'multipart-123',
          parts: [
            { partNumber: 1, etag: 'part1-etag' },
            { partNumber: 2, etag: 'part2-etag' },
          ],
        },
        undefined
      );
    });

    it('should handle file verification failure', async () => {
      const handler = createFinalizeHandler(handlerOptions);

      // Mock the core finalize method to throw an error
      mockCore.finalize.mockRejectedValue(new Error('File not found'));

      const request = new Request('http://localhost/api/uploads/finalize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          storageKey: 'uploads/2025/missing.jpg',
        }),
      });

      const response = await handler(request);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBe('File not found');
    });
  });

  describe('createGetImageHandler', () => {
    it('returns 401 when a private image requires authentication', async () => {
      const handler = createGetImageHandler(handlerOptions);
      mockCore.getImage.mockRejectedValue(new Error('Authentication required'));
      const request = new Request('http://localhost/api/images/img-456');

      const response = await handler(request, 'img-456');
      expect(response.status).toBe(401);
      expect(mockCore.getImage).toHaveBeenCalledWith('img-456', undefined);
    });
    it('should return public image', async () => {
      const handler = createGetImageHandler(handlerOptions);

      // Mock the core getImage method
      mockCore.getImage.mockResolvedValue({
        image: {
          id: 'img-123',
          filename: 'test.jpg',
          isPublic: true,
          status: 'ready',
          storageKey: 'uploads/2025/test.jpg',
          ownerId: 'user-123',
          contentType: 'image/jpeg',
          byteSize: 1024,
          publicUrl: 'https://cdn.example.com/test.jpg',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        url: 'https://cdn.example.com/test.jpg',
      });

      const request = new Request('http://localhost/api/images/img-123');
      const context = {
        request,
        user: { id: 'user-123' },
        params: { imageId: 'img-123' },
      };

      const response = await handler(request, 'img-123', context);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.image.id).toBe('img-123');
      expect(data.url).toBe('https://cdn.example.com/test.jpg');

      // Verify the getImage method was called with correct data
      expect(mockCore.getImage).toHaveBeenCalledWith('img-123', 'user-123');
    });

    it('should return private image with signed URL for owner', async () => {
      const handler = createGetImageHandler(handlerOptions);

      // Mock the core getImage method
      mockCore.getImage.mockResolvedValue({
        image: {
          id: 'img-456',
          filename: 'private.jpg',
          isPublic: false,
          ownerId: 'user-123',
          status: 'ready',
          storageKey: 'uploads/2025/private.jpg',
          contentType: 'image/jpeg',
          byteSize: 1024,
          publicUrl: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        url: 'https://s3.amazonaws.com/signed-url',
      });

      const request = new Request('http://localhost/api/images/img-456');
      const context = {
        request,
        user: { id: 'user-123' },
        params: { imageId: 'img-456' },
      };

      const response = await handler(request, 'img-456', context);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.url).toBe('https://s3.amazonaws.com/signed-url');

      // Verify the getImage method was called with correct data
      expect(mockCore.getImage).toHaveBeenCalledWith('img-456', 'user-123');
    });

    it('should deny access to private image for non-owner', async () => {
      const handler = createGetImageHandler(handlerOptions);

      // Mock the core getImage method to throw access denied error
      mockCore.getImage.mockRejectedValue(new Error('Access denied'));

      const request = new Request('http://localhost/api/images/img-456');
      const context = {
        request,
        user: { id: 'user-123' },
        params: { imageId: 'img-456' },
      };

      const response = await handler(request, 'img-456', context);
      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error).toBe('Access denied');
    });

    it('should return 404 for non-existent image', async () => {
      const handler = createGetImageHandler(handlerOptions);

      // Mock the core getImage method to throw image not found error
      mockCore.getImage.mockRejectedValue(new Error('Image not found'));

      const request = new Request('http://localhost/api/images/non-existent');
      const context = {
        request,
        user: { id: 'user-123' },
        params: { imageId: 'non-existent' },
      };

      const response = await handler(request, 'non-existent', context);
      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error).toBe('Image not found');
    });
  });

  describe('createGetImagesForEntityHandler', () => {
    it('requires a user before listing entity images', async () => {
      const handler = createGetImagesForEntityHandler(handlerOptions);
      const request = new Request('http://localhost/api/images');
      const response = await handler(request, 'post', 'post-1');
      expect(response.status).toBe(401);
      expect(mockCore.getImagesForEntity).not.toHaveBeenCalled();
    });
  });

  describe('createDeleteImageHandler', () => {
    it('should delete image when user is owner', async () => {
      const handler = createDeleteImageHandler(handlerOptions);

      // Mock the core deleteImage method
      mockCore.deleteImage.mockResolvedValue(undefined);

      const request = new Request('http://localhost/api/images/img-123', {
        method: 'DELETE',
      });
      const context = {
        request,
        user: { id: 'user-123' },
        params: { imageId: 'img-123' },
      };

      const response = await handler(request, 'img-123', context);
      expect(response.status).toBe(204);

      // Verify the deleteImage method was called with correct data
      expect(mockCore.deleteImage).toHaveBeenCalledWith('img-123', 'user-123');
    });

    it('should deny deletion for non-owner', async () => {
      const handler = createDeleteImageHandler(handlerOptions);

      // Mock the core deleteImage method to throw access denied error
      mockCore.deleteImage.mockRejectedValue(new Error('Access denied'));

      const request = new Request('http://localhost/api/images/img-123', {
        method: 'DELETE',
      });
      const context = {
        request,
        user: { id: 'user-123' },
        params: { imageId: 'img-123' },
      };

      const response = await handler(request, 'img-123', context);
      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error).toBe('Access denied');
    });

    it('should require authentication', async () => {
      const secureOptions = {
        ...handlerOptions,
        requireAuth: true,
      };
      const handler = createDeleteImageHandler(secureOptions);

      const request = new Request('http://localhost/api/images/img-123', {
        method: 'DELETE',
      });
      const context = {
        request,
        user: undefined,
        params: { imageId: 'img-123' },
      };

      const response = await handler(request, 'img-123', context);
      expect(response.status).toBe(401);

      const data = await response.json();
      expect(data.error).toBe('Authentication required');

      // Verify core method was not called
      expect(mockCore.deleteImage).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should handle database errors gracefully', async () => {
      const handler = createPresignHandler(handlerOptions);

      // Mock the core presign method to throw a database error
      mockCore.presign.mockRejectedValue(
        new Error('Database connection failed')
      );

      const request = new Request('http://localhost/api/uploads/presign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filename: 'test.jpg',
          contentType: 'image/jpeg',
          byteSize: 1024,
        }),
      });

      const context = {
        request,
        user: { id: 'user-123' },
        params: {},
      };

      const response = await handler(request, context);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBe('Database connection failed');
    });

    it('should handle storage adapter errors', async () => {
      const handler = createPresignHandler(handlerOptions);

      // Mock the core presign method to throw a storage error
      mockCore.presign.mockRejectedValue(new Error('S3 error'));

      const request = new Request('http://localhost/api/uploads/presign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filename: 'test.jpg',
          contentType: 'image/jpeg',
          byteSize: 1024,
        }),
      });

      const context = {
        request,
        user: { id: 'user-123' },
        params: {},
      };

      const response = await handler(request, context);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBe('S3 error');
    });
  });
});

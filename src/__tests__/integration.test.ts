import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OctoloadClient } from '../client/index.js';

// Mock XMLHttpRequest for client uploads
class MockXMLHttpRequest {
  upload: { addEventListener: typeof vi.fn } = { addEventListener: vi.fn() };
  addEventListener = vi.fn();
  open = vi.fn();
  send = vi.fn();
  setRequestHeader = vi.fn();
  status = 200;
  statusText = 'OK';
  response: unknown = null;
  responseText = '';

  constructor() {
    setTimeout(() => {
      const loadHandler = this.addEventListener.mock.calls.find(
        (call) => call[0] === 'load'
      )?.[1];
      if (loadHandler) loadHandler();
    }, 10);
  }
}

// @ts-expect-error - Replace global XMLHttpRequest
global.XMLHttpRequest = MockXMLHttpRequest as unknown;

// Mock crypto for checksum calculation
Object.defineProperty(global, 'crypto', {
  value: {
    subtle: {
      digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
    },
  },
});

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Integration Tests', () => {
  let client: OctoloadClient;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup client
    client = new OctoloadClient({
      baseUrl: 'https://api.example.com',
      headers: { Authorization: 'Bearer test-token' },
    });
  });

  describe('Client upload workflow', () => {
    it('should complete full upload cycle: presign -> upload -> finalize', async () => {
      // Step 1: Mock presign response
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            storageKey: 'uploads/2025/integration-test.jpg',
            uploadUrl: 'https://s3.amazonaws.com/presigned-upload-url',
            expiresAt: new Date(Date.now() + 3600000),
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'img-integration-123',
            filename: 'integration-test.jpg',
            contentType: 'image/jpeg',
            status: 'ready',
            publicUrl: 'https://cdn.example.com/integration-test.jpg',
          }),
        });

      // Execute full upload
      const mockFile = new File(['test content'], 'integration-test.jpg', {
        type: 'image/jpeg',
      });

      const result = await client.uploadFile(mockFile, {
        isPublic: true,
        alt: 'Integration test image',
        tags: ['test', 'integration'],
      });

      // Verify the complete workflow
      expect(result.image.id).toBe('img-integration-123');
      expect(result.image.status).toBe('ready');
      expect(result.image.publicUrl).toBe(
        'https://cdn.example.com/integration-test.jpg'
      );

      // Verify API calls were made
      expect(mockFetch).toHaveBeenCalledTimes(2); // presign + finalize
    }, 15000);

    it('should handle multipart upload workflow', async () => {
      // The mocked presign response chooses multipart; no large allocation is needed.
      const mockLargeFile = new File(
        ['part-one', 'part-two'],
        'large-file.mp4',
        {
          type: 'video/mp4',
        }
      );

      // Mock multipart upload response
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            storageKey: 'uploads/2025/large-file.mp4',
            multipart: {
              uploadId: 'multipart-123',
              parts: [
                { partNumber: 1, uploadUrl: 'https://s3.amazonaws.com/part1' },
                { partNumber: 2, uploadUrl: 'https://s3.amazonaws.com/part2' },
              ],
            },
            expiresAt: new Date(Date.now() + 3600000),
          }),
        })
        // Mock part upload responses with ETag headers
        .mockResolvedValueOnce({
          ok: true,
          headers: new Map([['ETag', '"etag-part1"']]),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Map([['ETag', '"etag-part2"']]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'img-large-123',
            filename: 'large-file.mp4',
            status: 'ready',
          }),
        });

      const result = await client.uploadFile(mockLargeFile, {
        isPublic: false,
      });

      expect(result.image.id).toBe('img-large-123');
      expect(mockFetch).toHaveBeenCalledTimes(4); // presign + 2 parts + finalize
    }, 15000);
  });

  describe('Image retrieval workflow', () => {
    it('should retrieve public image successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          image: {
            id: 'img-public-123',
            filename: 'public-image.jpg',
            isPublic: true,
          },
          url: 'https://cdn.example.com/public-image.jpg',
        }),
      });

      const result = await client.getImage('img-public-123');

      expect(result.image.id).toBe('img-public-123');
      expect(result.url).toBe('https://cdn.example.com/public-image.jpg');
    });

    it('should retrieve private image with signed URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          image: {
            id: 'img-private-456',
            filename: 'private-image.jpg',
            isPublic: false,
          },
          url: 'https://s3.amazonaws.com/signed-url',
        }),
      });

      const result = await client.getImage('img-private-456');

      expect(result.image.id).toBe('img-private-456');
      expect(result.url).toBe('https://s3.amazonaws.com/signed-url');
    });
  });

  describe('Image deletion workflow', () => {
    it('should delete image successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await expect(client.deleteImage('img-delete-789')).resolves.not.toThrow();
    });
  });

  describe('Error handling integration', () => {
    it('should handle client-side upload failures', async () => {
      const mockFile = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
      });

      await expect(client.uploadFile(mockFile)).rejects.toThrow(
        'Presign failed: Internal Server Error'
      );
    });

    it('should handle finalize failures', async () => {
      const mockFile = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            storageKey: 'uploads/2025/test.jpg',
            uploadUrl: 'https://s3.amazonaws.com/presigned-url',
            expiresAt: new Date(Date.now() + 3600000),
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          statusText: 'Internal Server Error',
        });

      await expect(client.uploadFile(mockFile)).rejects.toThrow(
        'Finalize failed: Internal Server Error'
      );
    });

    it('should handle network errors', async () => {
      const mockFile = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.uploadFile(mockFile)).rejects.toThrow(
        'Network error'
      );
    });
  });

  describe('Performance and concurrency', () => {
    it('should handle concurrent uploads', async () => {
      const files = Array.from(
        { length: 3 },
        (_, i) =>
          new File([`content-${i}`], `concurrent-${i}.jpg`, {
            type: 'image/jpeg',
          })
      );

      // Mock successful responses for all uploads
      // Need to set up all mocks at once for concurrent operations
      mockFetch
        // Presign responses
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            storageKey: 'uploads/2025/concurrent-0.jpg',
            uploadUrl: 'https://s3.amazonaws.com/presigned-url-0',
            expiresAt: new Date(Date.now() + 3600000),
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            storageKey: 'uploads/2025/concurrent-1.jpg',
            uploadUrl: 'https://s3.amazonaws.com/presigned-url-1',
            expiresAt: new Date(Date.now() + 3600000),
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            storageKey: 'uploads/2025/concurrent-2.jpg',
            uploadUrl: 'https://s3.amazonaws.com/presigned-url-2',
            expiresAt: new Date(Date.now() + 3600000),
          }),
        })
        // Finalize responses
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'img-concurrent-0',
            filename: 'concurrent-0.jpg',
            status: 'ready',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'img-concurrent-1',
            filename: 'concurrent-1.jpg',
            status: 'ready',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'img-concurrent-2',
            filename: 'concurrent-2.jpg',
            status: 'ready',
          }),
        });

      const uploadPromises = files.map((file) => client.uploadFile(file));
      const results = await Promise.all(uploadPromises);

      expect(results).toHaveLength(3);
      results.forEach((result, index) => {
        expect(result.image.id).toBe(`img-concurrent-${index}`);
        expect(result.image.status).toBe('ready');
      });
    }, 20000);
  });
});

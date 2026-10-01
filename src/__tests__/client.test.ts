import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OctoloadClient,
  OctoloadError,
  validateFile,
} from '../client/index.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock crypto.subtle for web crypto API
Object.defineProperty(global, 'crypto', {
  value: {
    subtle: {
      digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
    },
  },
});

// Mock XMLHttpRequest
class MockXMLHttpRequest {
  static instances: MockXMLHttpRequest[] = [];
  upload: { addEventListener: typeof vi.fn } = { addEventListener: vi.fn() };
  addEventListener = vi.fn();
  open = vi.fn();
  send = vi.fn();
  setRequestHeader = vi.fn();
  status = 200;
  statusText = 'OK';

  constructor() {
    MockXMLHttpRequest.instances.push(this);
    // Simulate successful upload
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

describe('OctoloadClient', () => {
  let client: OctoloadClient;

  beforeEach(() => {
    vi.clearAllMocks();
    MockXMLHttpRequest.instances = [];
    client = new OctoloadClient({
      baseUrl: 'https://test.com',
      headers: { 'x-test': 'true' },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('uploadFile', () => {
    it('should handle successful single file upload', async () => {
      const mockFile = new File(['test content'], 'test.jpg', {
        type: 'image/jpeg',
      });

      // Mock presign response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          storageKey: 'uploads/2025/test.jpg',
          uploadUrl: 'https://s3.amazonaws.com/presigned-url',
          headers: { 'If-None-Match': '*', 'Content-Type': 'image/jpeg' },
          expiresAt: new Date(),
        }),
      });

      // Mock finalize response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'image-123',
          filename: 'test.jpg',
          contentType: 'image/jpeg',
          status: 'ready',
        }),
      });

      const result = await client.uploadFile(mockFile, {
        isPublic: true,
        alt: 'Test image',
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.image.filename).toBe('test.jpg');
      const xhr = MockXMLHttpRequest.instances[0];
      expect(xhr.setRequestHeader).toHaveBeenCalledWith('If-None-Match', '*');
      expect(xhr.setRequestHeader).toHaveBeenCalledWith(
        'Content-Type',
        'image/jpeg'
      );
      expect(xhr.setRequestHeader).not.toHaveBeenCalledWith(
        'Content-Length',
        expect.anything()
      );
      expect(xhr.send).toHaveBeenCalledWith(mockFile);
    }, 10000); // Increase timeout

    it('should handle presign request correctly', async () => {
      const mockFile = new File(['test content'], 'test.jpg', {
        type: 'image/jpeg',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          storageKey: 'uploads/2025/test.jpg',
          uploadUrl: 'https://s3.amazonaws.com/presigned-url',
          expiresAt: new Date(),
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'image-123',
          filename: 'test.jpg',
          status: 'ready',
        }),
      });

      await client.uploadFile(mockFile, {
        isPublic: true,
        alt: 'Test image',
        tags: ['test', 'upload'],
      });

      // Check presign request
      const presignCall = mockFetch.mock.calls[0];
      expect(presignCall[0]).toBe('https://test.com/api/uploads/presign');
      expect(presignCall[1].method).toBe('POST');

      const presignBody = JSON.parse(presignCall[1].body);
      expect(presignBody).toEqual({
        filename: 'test.jpg',
        contentType: 'image/jpeg',
        byteSize: 12, // 'test content'.length
        isPublic: true,
        alt: 'Test image',
        tags: ['test', 'upload'],
      });
    }, 10000);

    it('should handle API errors', async () => {
      const mockFile = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Unauthorized',
      });

      await expect(client.uploadFile(mockFile)).rejects.toThrow(
        'Presign failed: Unauthorized'
      );
    });
  });

  describe('getImage', () => {
    it('should retrieve image successfully', async () => {
      const mockImageResponse = {
        image: { id: 'img-123', filename: 'test.jpg' },
        url: 'https://cdn.example.com/img-123.jpg',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockImageResponse,
      });

      const result = await client.getImage('img-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.com/api/images/img-123',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'x-test': 'true',
          }),
        })
      );

      expect(result).toEqual(mockImageResponse);
    });
  });

  describe('deleteImage', () => {
    it('should delete image successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      await client.deleteImage('img-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.com/api/images/img-123',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });

    it('should handle delete errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
      });

      await expect(client.deleteImage('img-123')).rejects.toThrow(
        'Failed to delete image: Not Found'
      );
    });

    it('preserves structured API error details', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({
          error: 'Image belongs to another user',
          code: 'ACCESS_DENIED',
          details: { imageId: 'img-123' },
        }),
      });

      await expect(client.deleteImage('img-123')).rejects.toMatchObject({
        name: 'OctoloadError',
        message: 'Image belongs to another user',
        code: 'ACCESS_DENIED',
        statusCode: 403,
        details: { imageId: 'img-123' },
      } satisfies Partial<OctoloadError>);
    });
  });
});

describe('validateFile', () => {
  it('should validate a valid file', () => {
    const file = new File(['content'], 'test.jpg', { type: 'image/jpeg' });

    const result = validateFile(file, {
      maxSize: 1024 * 1024,
      allowedTypes: ['image/*'],
    });

    expect(result).toBeNull();
  });

  it('should reject oversized files', () => {
    const largeContent = 'x'.repeat(2 * 1024 * 1024); // 2MB
    const file = new File([largeContent], 'large.jpg', {
      type: 'image/jpeg',
    });

    const result = validateFile(file, {
      maxSize: 1024 * 1024, // 1MB limit
      allowedTypes: ['image/*'],
    });

    expect(result).toContain('File size 2MB exceeds limit of 1MB');
  });

  it('should reject disallowed file types', () => {
    const file = new File(['content'], 'document.pdf', {
      type: 'application/pdf',
    });

    const result = validateFile(file, {
      allowedTypes: ['image/*'],
    });

    expect(result).toContain('File type application/pdf is not allowed');
  });

  it('should handle specific type allowlist', () => {
    const jpegFile = new File(['content'], 'test.jpg', {
      type: 'image/jpeg',
    });

    const pngFile = new File(['content'], 'test.png', { type: 'image/png' });

    const result1 = validateFile(jpegFile, {
      allowedTypes: ['image/jpeg', 'image/png'],
    });

    const result2 = validateFile(pngFile, {
      allowedTypes: ['image/jpeg', 'image/png'],
    });

    expect(result1).toBeNull();
    expect(result2).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { finalizeRequestSchema, presignRequestSchema } from '../types/index.js';

describe('Validation Schemas', () => {
  describe('presignRequestSchema', () => {
    it('should validate a valid presign request', () => {
      const validRequest = {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
        byteSize: 1024,
      };

      const result = presignRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.strategy).toBe('single'); // default value
        expect(result.data.isPublic).toBe(false); // default value
      }
    });

    it('should reject invalid content types', () => {
      const invalidRequest = {
        filename: 'test.txt',
        contentType: 'text/plain',
        byteSize: 1024,
      };

      const result = presignRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should reject empty filename', () => {
      const invalidRequest = {
        filename: '',
        contentType: 'image/jpeg',
        byteSize: 1024,
      };

      const result = presignRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should reject zero byte size', () => {
      const invalidRequest = {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
        byteSize: 0,
      };

      const result = presignRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should accept optional fields', () => {
      const requestWithOptionals = {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
        byteSize: 1024,
        strategy: 'multipart' as const,
        ownerId: '123e4567-e89b-12d3-a456-426614174000',
        orgId: '123e4567-e89b-12d3-a456-426614174001',
        isPublic: true,
        alt: 'Test image',
        title: 'My Test Image',
        tags: ['test', 'image'],
      };

      const result = presignRequestSchema.safeParse(requestWithOptionals);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.strategy).toBe('multipart');
        expect(result.data.isPublic).toBe(true);
        expect(result.data.tags).toEqual(['test', 'image']);
      }
    });
  });

  describe('finalizeRequestSchema', () => {
    it('should validate a valid finalize request', () => {
      const validRequest = {
        storageKey: 'uploads/2025/test-image.jpg',
      };

      const result = finalizeRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should validate with checksum', () => {
      const requestWithChecksum = {
        storageKey: 'uploads/2025/test-image.jpg',
        checksum: 'a'.repeat(64), // Valid SHA-256 hex string
      };

      const result = finalizeRequestSchema.safeParse(requestWithChecksum);
      expect(result.success).toBe(true);
    });

    it('should validate with multipart parts', () => {
      const requestWithParts = {
        storageKey: 'uploads/2025/test-image.jpg',
        parts: [
          { partNumber: 1, etag: 'abc123' },
          { partNumber: 2, etag: 'def456' },
        ],
      };

      const result = finalizeRequestSchema.safeParse(requestWithParts);
      expect(result.success).toBe(true);
    });

    it('should reject empty storage key', () => {
      const invalidRequest = {
        storageKey: '',
      };

      const result = finalizeRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should reject invalid checksum format', () => {
      const invalidRequest = {
        storageKey: 'uploads/2025/test-image.jpg',
        checksum: 'invalid-checksum',
      };

      const result = finalizeRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });
  });
});

import { describe, expect, it } from 'vitest';
import { presignRequestSchema, finalizeRequestSchema } from '../types/index.js';

describe('Zod Schema Validation', () => {
  describe('presignRequestSchema', () => {
    it('should validate correct presign request', () => {
      const validRequest = {
        filename: 'test-image.jpg',
        contentType: 'image/jpeg',
        byteSize: 1024000,
        strategy: 'single' as const,
        isPublic: false,
      };

      const result = presignRequestSchema.parse(validRequest);
      expect(result.filename).toBe('test-image.jpg');
      expect(result.strategy).toBe('single');
      expect(result.isPublic).toBe(false);
    });

    it('should apply default values', () => {
      const minimalRequest = {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
        byteSize: 1024,
      };

      const result = presignRequestSchema.parse(minimalRequest);
      expect(result.strategy).toBe('single');
      expect(result.isPublic).toBe(false);
    });

    it('should validate UUID fields', () => {
      const requestWithUUIDs = {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
        byteSize: 1024,
        ownerId: '123e4567-e89b-12d3-a456-426614174000',
        orgId: '987fcdeb-51d2-43a1-9876-543210987654',
      };

      const result = presignRequestSchema.parse(requestWithUUIDs);
      expect(result.ownerId).toBeDefined();
      expect(result.orgId).toBeDefined();
    });

    it('should reject invalid content types', () => {
      const invalidRequest = {
        filename: 'test.txt',
        contentType: 'text/plain',
        byteSize: 1024,
      };

      expect(() => presignRequestSchema.parse(invalidRequest)).toThrow(
        /Invalid content type/
      );
    });

    it('should reject invalid file sizes', () => {
      const zeroSizeRequest = {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
        byteSize: 0,
      };

      expect(() => presignRequestSchema.parse(zeroSizeRequest)).toThrow();

      const negativeSizeRequest = {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
        byteSize: -1,
      };

      expect(() => presignRequestSchema.parse(negativeSizeRequest)).toThrow();
    });

    it('should validate filename length limits', () => {
      const longFilenameRequest = {
        filename: 'a'.repeat(256),
        contentType: 'image/jpeg',
        byteSize: 1024,
      };

      expect(() => presignRequestSchema.parse(longFilenameRequest)).toThrow();
    });

    it('should validate tags array', () => {
      const requestWithTags = {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
        byteSize: 1024,
        tags: ['nature', 'landscape', 'photography'],
      };

      const result = presignRequestSchema.parse(requestWithTags);
      expect(result.tags).toEqual(['nature', 'landscape', 'photography']);
    });

    it('should reject too many tags', () => {
      const requestWithManyTags = {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
        byteSize: 1024,
        tags: Array(11).fill('tag'),
      };

      expect(() => presignRequestSchema.parse(requestWithManyTags)).toThrow();
    });

    it('should validate alt text length', () => {
      const requestWithLongAlt = {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
        byteSize: 1024,
        alt: 'a'.repeat(501),
      };

      expect(() => presignRequestSchema.parse(requestWithLongAlt)).toThrow();
    });
  });

  describe('finalizeRequestSchema', () => {
    it('should validate correct finalize request', () => {
      const validRequest = {
        storageKey: 'uploads/test-file.jpg',
        checksum: 'a'.repeat(64),
      };

      const result = finalizeRequestSchema.parse(validRequest);
      expect(result.storageKey).toBe('uploads/test-file.jpg');
      expect(result.checksum).toBe('a'.repeat(64));
    });

    it('should validate without checksum', () => {
      const minimalRequest = {
        storageKey: 'uploads/test-file.jpg',
      };

      const result = finalizeRequestSchema.parse(minimalRequest);
      expect(result.storageKey).toBe('uploads/test-file.jpg');
      expect(result.checksum).toBeUndefined();
    });

    it('should validate multipart upload parts', () => {
      const multipartRequest = {
        storageKey: 'uploads/large-file.mp4',
        parts: [
          { partNumber: 1, etag: 'etag1' },
          { partNumber: 2, etag: 'etag2' },
          { partNumber: 3, etag: 'etag3' },
        ],
      };

      const result = finalizeRequestSchema.parse(multipartRequest);
      expect(result.parts).toHaveLength(3);
      expect(result.parts?.[0].partNumber).toBe(1);
    });

    it('should reject invalid checksum format', () => {
      const invalidChecksumRequest = {
        storageKey: 'uploads/test.jpg',
        checksum: 'invalid-checksum',
      };

      expect(() =>
        finalizeRequestSchema.parse(invalidChecksumRequest)
      ).toThrow();
    });

    it('should reject empty storage key', () => {
      const emptyKeyRequest = {
        storageKey: '',
      };

      expect(() => finalizeRequestSchema.parse(emptyKeyRequest)).toThrow();
    });

    it('should validate part numbers', () => {
      const invalidPartRequest = {
        storageKey: 'uploads/test.jpg',
        parts: [
          { partNumber: 0, etag: 'etag1' }, // Invalid part number
        ],
      };

      expect(() => finalizeRequestSchema.parse(invalidPartRequest)).toThrow();
    });
  });

  describe('Content Type Validation', () => {
    const validContentTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
      'image/bmp',
      'image/tiff',
    ];

    const invalidContentTypes = [
      'text/plain',
      'application/pdf',
      'video/mp4',
      'audio/mpeg',
      'image', // Missing subtype
      'image/', // Missing subtype
    ];

    validContentTypes.forEach((contentType) => {
      it(`should accept valid content type: ${contentType}`, () => {
        const request = {
          filename: 'test.jpg',
          contentType,
          byteSize: 1024,
        };

        expect(() => presignRequestSchema.parse(request)).not.toThrow();
      });
    });

    invalidContentTypes.forEach((contentType) => {
      it(`should reject invalid content type: ${contentType}`, () => {
        const request = {
          filename: 'test.jpg',
          contentType,
          byteSize: 1024,
        };

        expect(() => presignRequestSchema.parse(request)).toThrow();
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle unicode filenames', () => {
      const unicodeRequest = {
        filename: '测试图片.jpg',
        contentType: 'image/jpeg',
        byteSize: 1024,
      };

      const result = presignRequestSchema.parse(unicodeRequest);
      expect(result.filename).toBe('测试图片.jpg');
    });

    it('should handle special characters in tags', () => {
      const specialTagsRequest = {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
        byteSize: 1024,
        tags: ['tag-with-dash', 'tag_with_underscore', 'tag.with.dot'],
      };

      const result = presignRequestSchema.parse(specialTagsRequest);
      expect(result.tags).toHaveLength(3);
    });

    it('should handle maximum allowed values', () => {
      const maxRequest = {
        filename: 'a'.repeat(255),
        contentType: 'image/jpeg',
        byteSize: Number.MAX_SAFE_INTEGER,
        alt: 'a'.repeat(500),
        title: 'a'.repeat(255),
        tags: Array(10).fill('tag'),
      };

      expect(() => presignRequestSchema.parse(maxRequest)).not.toThrow();
    });
  });
});

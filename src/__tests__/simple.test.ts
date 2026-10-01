import { describe, expect, it } from 'vitest';
import { finalizeRequestSchema, presignRequestSchema } from '../types/index.js';

describe('Basic Functionality', () => {
  it('should validate presign request schema', () => {
    const valid = {
      filename: 'test.jpg',
      contentType: 'image/jpeg',
      byteSize: 1024,
    };

    const result = presignRequestSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('should validate finalize request schema', () => {
    const valid = {
      storageKey: 'uploads/2025/test.jpg',
    };

    const result = finalizeRequestSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('should reject invalid content type', () => {
    const invalid = {
      filename: 'test.txt',
      contentType: 'text/plain',
      byteSize: 1024,
    };

    const result = presignRequestSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

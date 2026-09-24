import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OctoloadCore,
  type DrizzleDB,
  type DrizzleSchema,
} from '../handlers/core.js';
import { S3StorageAdapter } from '../storage/s3-adapter.js';
import { generateServerUUID } from '../utils/uuid.js';

vi.mock('../storage/s3-adapter.js', () => ({
  S3StorageAdapter: vi.fn(function StorageAdapterMock() {
    return {
      getPresignedPutUrl: vi
        .fn()
        .mockResolvedValue({ url: 'https://storage.test/upload' }),
    };
  }),
}));

vi.mock('../utils/uuid.js', () => ({ generateServerUUID: vi.fn() }));

describe('OctoloadCore.presign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('gives simultaneous uploads with identical metadata distinct storage keys', async () => {
    vi.mocked(generateServerUUID)
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002');

    const inserted: Record<string, unknown>[] = [];
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn((value: Record<string, unknown>) => ({
          returning: vi.fn(async () => {
            inserted.push(value);
            return [value];
          }),
        })),
      })),
    } as unknown as DrizzleDB;
    const schema = { images: {} } as unknown as DrizzleSchema;
    const core = new OctoloadCore(
      {
        adapter: 's3',
        bucket: 'images',
        region: 'us-east-1',
        credentials: { accessKeyId: 'key', secretAccessKey: 'secret' },
      },
      db,
      schema
    );
    const request = {
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      byteSize: 100,
    };

    const first = await core.presign(request);
    const second = await core.presign(request);

    expect(first.storageKey).not.toBe(second.storageKey);
    expect(first.storageKey).toMatch(/^uploads\/[a-f0-9]{16}\.jpg$/);
    expect(second.storageKey).toMatch(/^uploads\/[a-f0-9]{16}\.jpg$/);
    expect(inserted.map((image) => image.storageKey)).toEqual([
      first.storageKey,
      second.storageKey,
    ]);
    expect(inserted.map((image) => image.id)).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ]);
    expect(
      vi.mocked(S3StorageAdapter).mock.results[0].value.getPresignedPutUrl
    ).toHaveBeenCalledTimes(2);
  });
});

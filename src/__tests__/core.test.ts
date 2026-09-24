import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type DrizzleDB,
  type DrizzleSchema,
  OctoloadCore,
} from '../handlers/core.js';
import { S3StorageAdapter } from '../storage/s3-adapter.js';
import { generateServerUUID } from '../utils/uuid.js';

vi.mock('../storage/s3-adapter.js', () => ({
  S3StorageAdapter: vi.fn(function StorageAdapterMock() {
    return {
      getPresignedPutUrl: vi
        .fn()
        .mockResolvedValue({ url: 'https://storage.test/upload' }),
      getPrivateUrl: vi.fn().mockResolvedValue('https://storage.test/private'),
      objectExists: vi.fn().mockResolvedValue(true),
      deleteObject: vi.fn(),
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
      isPublic: true,
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

describe('OctoloadCore image access', () => {
  const image = {
    id: 'image-1',
    ownerId: 'owner-1',
    isPublic: false,
    storageKey: 'uploads/image-1.jpg',
  };

  function makeCore(record = image) {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [record] }),
        }),
      }),
    } as unknown as DrizzleDB;
    const schema = {
      images: { id: 'id', ownerId: 'ownerId' },
    } as unknown as DrizzleSchema;
    return new OctoloadCore(
      {
        adapter: 's3',
        bucket: 'images',
        region: 'us-east-1',
        credentials: { accessKeyId: 'key', secretAccessKey: 'secret' },
      },
      db,
      schema
    );
  }

  it('requires an owner before signing a private read', async () => {
    const core = makeCore();
    await expect(core.getImage(image.id)).rejects.toThrow(
      'Authentication required'
    );
    await expect(core.getImage(image.id, 'other-user')).rejects.toThrow(
      'Access denied'
    );
    await expect(core.getImage(image.id, image.ownerId)).resolves.toMatchObject(
      {
        url: 'https://storage.test/private',
      }
    );
  });

  it('allows anonymous reads of public images', async () => {
    const core = makeCore({ ...image, isPublic: true });
    await expect(core.getImage(image.id)).resolves.toMatchObject({
      image: { id: image.id },
    });
  });

  it('requires an owner before deleting an image', async () => {
    const core = makeCore();
    await expect(core.deleteImage(image.id)).rejects.toThrow(
      'Authentication required'
    );
    await expect(core.deleteImage(image.id, 'other-user')).rejects.toThrow(
      'Access denied'
    );
  });

  it('requires the upload owner before finalizing', async () => {
    const core = makeCore();
    await expect(
      core.finalize({ storageKey: image.storageKey })
    ).rejects.toThrow('Authentication required');
    await expect(
      core.finalize({ storageKey: image.storageKey }, 'other-user')
    ).rejects.toThrow('Access denied');
  });

  it('requires the owner before changing metadata', async () => {
    const core = makeCore();
    await expect(
      core.updateImageMetadata(image.id, { alt: 'new' })
    ).rejects.toThrow('Authentication required');
    await expect(
      core.updateImageMetadata(image.id, { alt: 'new' }, 'other-user')
    ).rejects.toThrow('Access denied');
  });
});

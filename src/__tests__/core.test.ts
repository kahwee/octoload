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
      getPublicUrl: vi.fn().mockReturnValue('https://cdn.test/public'),
      headObject: vi.fn().mockResolvedValue({
        ContentLength: 10,
        ContentType: 'image/jpeg',
      }),
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
    expect(
      vi.mocked(S3StorageAdapter).mock.results[0].value.getPresignedPutUrl
    ).toHaveBeenNthCalledWith(
      1,
      first.storageKey,
      request.contentType,
      3600,
      request.byteSize
    );
  });

  it('rejects missing public delivery configuration before creating a row', async () => {
    vi.mocked(S3StorageAdapter).mockImplementationOnce(
      function MissingPublicUrlMock() {
        return {
          getPublicUrl: () => {
            throw new Error('Public R2 uploads require storage.publicBaseUrl');
          },
        } as unknown as S3StorageAdapter;
      }
    );
    const insert = vi.fn();
    const core = new OctoloadCore(
      {
        adapter: 'r2',
        bucket: 'images',
        region: 'auto',
        endpoint: 'https://account.r2.cloudflarestorage.com',
        credentials: { accessKeyId: 'key', secretAccessKey: 'secret' },
      },
      { insert } as unknown as DrizzleDB,
      { images: {} } as unknown as DrizzleSchema
    );

    await expect(
      core.presign({
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
        byteSize: 10,
        isPublic: true,
      })
    ).rejects.toThrow('Public R2 uploads require storage.publicBaseUrl');
    expect(insert).not.toHaveBeenCalled();
  });

  it('enforces configured size and MIME limits before creating a row', async () => {
    const insert = vi.fn(() => ({
      values: () => ({ returning: async () => [{}] }),
    }));
    const core = new OctoloadCore(
      {
        storage: {
          adapter: 's3',
          bucket: 'images',
          region: 'us-east-1',
          credentials: { accessKeyId: 'key', secretAccessKey: 'secret' },
        },
        limits: {
          maxFileSize: 100,
          allowedTypes: ['image/jpeg'],
          maxVariants: 0,
        },
      },
      { insert } as unknown as DrizzleDB,
      { images: {} } as unknown as DrizzleSchema
    );
    const request = {
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      byteSize: 100,
      ownerId: 'user_1',
    };

    await expect(core.presign({ ...request, byteSize: 101 })).rejects.toThrow(
      'File exceeds the configured size limit'
    );
    await expect(
      core.presign({ ...request, contentType: 'image/png' })
    ).rejects.toThrow('File type is not allowed');
    await expect(core.presign({ ...request, byteSize: 1.5 })).rejects.toThrow();
    expect(insert).not.toHaveBeenCalled();

    await expect(core.presign(request)).resolves.toHaveProperty('uploadUrl');
    expect(insert).toHaveBeenCalledOnce();
  });
});

describe('OctoloadCore image access', () => {
  const image = {
    id: 'image-1',
    status: 'ready',
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

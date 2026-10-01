import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DrizzleDB, OctoloadCore } from '../handlers/core.js';
import { S3StorageAdapter } from '../storage/s3-adapter.js';
import { uploadSchema } from '../templates/upload-schema.js';
import type { ImageRecord } from '../types/index.js';

const storage = vi.hoisted(() => ({
  deleteObject: vi.fn(async () => undefined),
  headObject: vi.fn(async () => ({
    ContentLength: 10,
    ContentType: 'image/jpeg',
  })),
}));

vi.mock('../storage/s3-adapter.js', () => ({
  S3StorageAdapter: vi.fn(function StorageAdapterMock() {
    return storage;
  }),
}));

const oldDate = new Date('2020-01-01T00:00:00.000Z');

function image(status: ImageRecord['status'] = 'processing'): ImageRecord {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    ownerId: 'user_aB7x2',
    filename: 'photo.jpg',
    contentType: 'image/jpeg',
    byteSize: 10,
    status,
    storageKey: 'uploads/photo.jpg',
    isPublic: false,
    createdAt: oldDate,
    updatedAt: oldDate,
  };
}

function makeCore(
  provider: 's3' | 'r2',
  row: ImageRecord,
  options: { loseClaim?: boolean } = {}
) {
  const rows = [row];
  const remove = vi.fn(async () => {
    rows.splice(0, 1);
  });
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => [...rows] }),
          limit: async () => [...rows],
        }),
      }),
    }),
    update: () => ({
      set: (values: Partial<ImageRecord>) => ({
        where: () => ({
          returning: async () => {
            if (options.loseClaim || rows[0]?.status !== 'processing')
              return [];
            Object.assign(rows[0], values);
            return [rows[0]];
          },
        }),
      }),
    }),
    delete: () => ({ where: remove }),
  } as unknown as DrizzleDB;
  const core = new OctoloadCore(
    {
      adapter: provider,
      bucket: 'photos',
      region: provider === 'r2' ? 'auto' : 'us-east-1',
      endpoint:
        provider === 'r2'
          ? 'https://account.r2.cloudflarestorage.com'
          : undefined,
      credentials: { accessKeyId: 'key', secretAccessKey: 'secret' },
    },
    db,
    uploadSchema
  );
  return { core, rows, remove };
}

describe.each(['s3', 'r2'] as const)(
  '%s abandoned upload cleanup',
  (provider) => {
    beforeEach(() => vi.clearAllMocks());

    it('removes stale objects and their rows', async () => {
      const { core, rows, remove } = makeCore(provider, image());
      await expect(core.cleanupAbandonedUploads()).resolves.toEqual({
        scanned: 1,
        cleaned: 1,
        skipped: 0,
        errors: [],
      });
      expect(storage.deleteObject).toHaveBeenCalledWith('uploads/photo.jpg');
      expect(remove).toHaveBeenCalledOnce();
      expect(rows).toHaveLength(0);
      expect(vi.mocked(S3StorageAdapter)).toHaveBeenCalledWith(
        expect.objectContaining({ adapter: provider })
      );
    });

    it('keeps a failed row for retry when storage deletion fails', async () => {
      const { core, rows, remove } = makeCore(provider, image());
      storage.deleteObject.mockRejectedValueOnce(
        new Error('storage unavailable')
      );
      expect(await core.cleanupAbandonedUploads()).toMatchObject({
        scanned: 1,
        cleaned: 0,
        errors: [{ message: 'storage unavailable' }],
      });
      expect(rows[0]?.status).toBe('failed');
      expect(remove).not.toHaveBeenCalled();
      expect(await core.cleanupAbandonedUploads()).toMatchObject({
        scanned: 1,
        cleaned: 1,
        errors: [],
      });
    });

    it('skips a row if finalize wins the status claim', async () => {
      const { core, remove } = makeCore(provider, image(), { loseClaim: true });
      await expect(core.cleanupAbandonedUploads()).resolves.toMatchObject({
        cleaned: 0,
        skipped: 1,
      });
      expect(storage.deleteObject).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    });

    it('rejects finalization after cleanup claimed the row', async () => {
      const row = image('failed');
      const { core } = makeCore(provider, row);
      await expect(
        core.finalize({ storageKey: row.storageKey }, row.ownerId ?? undefined)
      ).rejects.toThrow('Upload is no longer processing');
      expect(storage.headObject).not.toHaveBeenCalled();
    });

    it('rejects finalization if cleanup wins after object verification', async () => {
      const row = image();
      const { core } = makeCore(provider, row, { loseClaim: true });
      await expect(
        core.finalize({ storageKey: row.storageKey }, row.ownerId ?? undefined)
      ).rejects.toThrow('Upload is no longer processing');
      expect(storage.headObject).toHaveBeenCalledWith(row.storageKey);
    });

    it('does not store a public URL for a private image', async () => {
      const row = image();
      const { core } = makeCore(provider, row);
      const finalized = await core.finalize(
        { storageKey: row.storageKey },
        row.ownerId ?? undefined
      );
      expect(finalized.status).toBe('ready');
      expect(finalized.publicUrl).toBeNull();
    });

    it('rejects an object whose stored size or content type differs', async () => {
      const row = image();
      const { core, rows } = makeCore(provider, row);
      storage.headObject.mockResolvedValueOnce({
        ContentLength: 11,
        ContentType: 'image/jpeg',
      });
      await expect(
        core.finalize({ storageKey: row.storageKey }, row.ownerId ?? undefined)
      ).rejects.toThrow('file size does not match');
      storage.headObject.mockResolvedValueOnce({
        ContentLength: 10,
        ContentType: 'image/png',
      });
      await expect(
        core.finalize({ storageKey: row.storageKey }, row.ownerId ?? undefined)
      ).rejects.toThrow('content type does not match');
      expect(rows[0]?.status).toBe('processing');
    });

    it('reports a missing object without marking the row ready', async () => {
      const row = image();
      const { core, rows } = makeCore(provider, row);
      storage.headObject.mockRejectedValueOnce(
        Object.assign(new Error('Not Found'), {
          name: 'NotFound',
          $metadata: { httpStatusCode: 404 },
        })
      );
      await expect(
        core.finalize({ storageKey: row.storageKey }, row.ownerId ?? undefined)
      ).rejects.toThrow('file not found in storage');
      expect(rows[0]?.status).toBe('processing');
    });
  }
);

it('validates cleanup safety bounds and rejects unsupported multipart before writing', async () => {
  const { core } = makeCore('s3', image());
  await expect(
    core.cleanupAbandonedUploads({ olderThanMs: 1 })
  ).rejects.toThrow('olderThanMs must be at least one hour');
  await expect(core.cleanupAbandonedUploads({ limit: 1001 })).rejects.toThrow(
    'limit must be an integer between 1 and 1000'
  );
  await expect(
    core.presign({
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      byteSize: 10,
      ownerId: 'user_aB7x2',
      strategy: 'multipart',
    })
  ).rejects.toThrow('Multipart uploads are not supported');
  await expect(
    core.finalize({ storageKey: 'uploads/photo.jpg', parts: [] }, 'user_aB7x2')
  ).rejects.toThrow('Multipart uploads are not supported');
});

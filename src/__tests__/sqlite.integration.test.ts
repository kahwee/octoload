import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq } from 'drizzle-orm';
import {
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
} from 'drizzle-kit/api';
import { OctoloadCore } from '../handlers/core.js';
import * as schema from '../templates/upload-schema-sqlite.js';
import { S3StorageAdapter } from '../storage/s3-adapter.js';
import { createPresignHandler } from '../handlers/index.js';
import type { PresignContext } from '../types/index.js';

vi.mock('../storage/s3-adapter.js', () => ({
  S3StorageAdapter: vi.fn(function StorageMock() {
    return {
      getPresignedPutUrl: vi
        .fn()
        .mockResolvedValue({ url: 'https://storage.test/put' }),
      headObject: vi
        .fn()
        .mockResolvedValue({ ContentLength: 68, ContentType: 'image/png' }),
      getPrivateUrl: vi.fn().mockResolvedValue('https://storage.test/private'),
      getPublicUrl: vi.fn().mockReturnValue('https://storage.test/public'),
      deleteObject: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

const config = {
  adapter: 's3',
  bucket: 'test',
  region: 'us-east-1',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
};
const request = {
  filename: 'pixel.png',
  contentType: 'image/png',
  byteSize: 68,
  ownerId: 'owner',
};

let client: Client;
let db: ReturnType<typeof drizzle<typeof schema>>;
let core: OctoloadCore;

beforeEach(async () => {
  vi.clearAllMocks();
  client = createClient({ url: ':memory:' });
  await client.execute('PRAGMA foreign_keys = ON');
  // Generate the actual migration from the shipped schema, rather than a SQL fixture.
  const empty = await generateSQLiteDrizzleJson({});
  const current = await generateSQLiteDrizzleJson(schema);
  for (const statement of await generateSQLiteMigration(empty, current)) {
    await client.execute(statement);
  }
  db = drizzle(client, { schema });
  core = new OctoloadCore(config, db, schema.uploadSchema);
});
afterEach(() => client?.close());

async function presign() {
  const result = await core.presign(request);
  const [image] = await db
    .select()
    .from(schema.images)
    .where(eq(schema.images.storageKey, result.storageKey));
  return { ...result, image };
}

describe('SQLite metadata with real libSQL and generated migrations', () => {
  it('awaits policy hooks, revalidates metadata, and preserves the trusted owner', async () => {
    const beforePresign = vi.fn(async (context: PresignContext) => ({
      ...context,
      ownerId: 'other-owner',
      alt: 'Approved caption',
    }));
    core = new OctoloadCore(
      { ...config, hooks: { beforePresign } },
      db,
      schema.uploadSchema
    );
    const { image } = await presign();
    expect(beforePresign).toHaveBeenCalledWith(
      expect.objectContaining({ user: { id: 'owner' } })
    );
    expect(image).toMatchObject({ ownerId: 'owner', alt: 'Approved caption' });
    beforePresign.mockResolvedValueOnce({ ...request, byteSize: -1, alt: '' });
    await expect(core.presign(request)).rejects.toThrow();
    expect(await db.select().from(schema.images)).toHaveLength(1);
  });

  it('a denied policy produces no row or signed URL and does not leak its error', async () => {
    const beforePresign = vi.fn(async () => {
      throw new Error('Access denied');
    });
    const handler = createPresignHandler({
      config: { ...config, hooks: { beforePresign } },
      db,
      schema: schema.uploadSchema,
    });
    const httpRequest = new Request('https://app.test/presign', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    const response = await handler(httpRequest, {
      request: httpRequest,
      user: { id: 'owner' },
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error' });
    expect(await db.select().from(schema.images)).toEqual([]);
    const storage = vi.mocked(S3StorageAdapter).mock.results.at(-1)?.value;
    expect(storage.getPresignedPutUrl).not.toHaveBeenCalled();
  });

  it('runs finalize hooks after commit, surfaces failures, and does not replay on reconciliation', async () => {
    const afterFinalize = vi.fn(async () => {
      throw new Error('downstream unavailable');
    });
    core = new OctoloadCore(
      { ...config, hooks: { afterFinalize } },
      db,
      schema.uploadSchema
    );
    const { storageKey, image } = await presign();
    await expect(core.finalize({ storageKey }, 'owner')).rejects.toThrow(
      'Upload hook afterFinalize failed'
    );
    expect(afterFinalize).toHaveBeenCalledWith(
      expect.objectContaining({ id: image.id, status: 'ready' })
    );
    await expect(
      core.finalize({ storageKey, reconcile: true }, 'owner')
    ).resolves.toMatchObject({ status: 'ready' });
    expect(afterFinalize).toHaveBeenCalledOnce();
  });

  it('runs deletion policy only for the owner and leaves vetoed rows and objects intact', async () => {
    const onDelete = vi.fn(async (): Promise<void> => {
      throw new Error('retention policy');
    });
    core = new OctoloadCore(
      { ...config, hooks: { onDelete } },
      db,
      schema.uploadSchema
    );
    const { image } = await presign();
    await expect(core.deleteImage(image.id, 'stranger')).rejects.toThrow(
      'Access denied'
    );
    expect(onDelete).not.toHaveBeenCalled();
    await expect(core.deleteImage(image.id, 'owner')).rejects.toThrow(
      'Upload hook onDelete failed'
    );
    expect(await db.select().from(schema.images)).toHaveLength(1);
    const storage = vi.mocked(S3StorageAdapter).mock.results.at(-1)?.value;
    expect(storage.deleteObject).not.toHaveBeenCalled();
    onDelete.mockResolvedValueOnce(undefined);
    await core.deleteImage(image.id, 'owner');
    expect(await db.select().from(schema.images)).toEqual([]);
    expect(storage.deleteObject).toHaveBeenCalledOnce();
  });

  it('rejects unsupported variant hooks instead of silently ignoring them', () => {
    expect(
      () =>
        new OctoloadCore(
          { ...config, hooks: { onProcessVariant: async () => {} } },
          db,
          schema.uploadSchema
        )
    ).toThrow('onProcessVariant is not supported');
  });

  it('runs the complete private lifecycle with Date and boolean row values', async () => {
    const { image, storageKey } = await presign();
    expect(image.createdAt).toBeInstanceOf(Date);
    expect(image.isPublic).toBe(false);
    expect(image.publicUrl).toBeNull();
    await expect(core.getImage(image.id, 'owner')).rejects.toThrow(
      'Image not found'
    );
    const ready = await core.finalize({ storageKey }, 'owner');
    expect(ready.status).toBe('ready');
    expect(ready.updatedAt).toBeInstanceOf(Date);
    expect((await core.getImage(image.id, 'owner')).url).toContain('/private');
    await core.updateImageMetadata(
      image.id,
      { alt: 'A pixel', title: 'SQLite' },
      'owner'
    );
    expect((await core.getImagesForUser('owner'))[0].alt).toBe('A pixel');
    await core.deleteImage(image.id, 'owner');
    expect(await db.select().from(schema.images)).toEqual([]);
  });

  it('denies foreign owner reads, finalization, changes and deletion without modifying the row', async () => {
    const { image, storageKey } = await presign();
    await expect(core.finalize({ storageKey }, 'attacker')).rejects.toThrow(
      'Access denied'
    );
    await expect(core.getImage(image.id, 'attacker')).rejects.toThrow(
      'Access denied'
    );
    await expect(
      core.updateImageMetadata(image.id, { title: 'changed' }, 'attacker')
    ).rejects.toThrow('Access denied');
    await expect(core.deleteImage(image.id, 'attacker')).rejects.toThrow(
      'Access denied'
    );
    expect((await db.select().from(schema.images))[0]).toEqual(image);
  });

  it('rejects metadata privilege escalation and repeated finalization', async () => {
    const { image, storageKey } = await presign();
    await expect(
      core.updateImageMetadata(
        image.id,
        { isPublic: true } as { title?: string },
        'owner'
      )
    ).rejects.toThrow();
    await core.finalize({ storageKey }, 'owner');
    await expect(core.finalize({ storageKey }, 'owner')).rejects.toThrow(
      'no longer processing'
    );
    expect((await db.select().from(schema.images))[0].isPublic).toBe(false);
  });

  it('cleans abandoned uploads using real timestamp comparisons and retains ready rows', async () => {
    const abandoned = await presign();
    const ready = await presign();
    await core.finalize({ storageKey: ready.storageKey }, 'owner');
    await db
      .update(schema.images)
      .set({ createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) });
    expect(await core.cleanupAbandonedUploads()).toMatchObject({
      scanned: 1,
      cleaned: 1,
      errors: [],
    });
    const rows = await db.select().from(schema.images);
    expect(rows.map((row) => row.id)).toEqual([ready.image.id]);
    expect(rows.some((row) => row.id === abandoned.image.id)).toBe(false);
  });

  it('allows only one winner when finalize requests race', async () => {
    const { image, storageKey } = await presign();
    const results = await Promise.allSettled([
      core.finalize({ storageKey }, 'owner'),
      core.finalize({ storageKey }, 'owner'),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected')
    ).toHaveLength(1);
    expect(
      (
        await db
          .select()
          .from(schema.images)
          .where(eq(schema.images.id, image.id))
      )[0].status
    ).toBe('ready');
  });

  it('retains failed cleanup rows for retry after a storage outage', async () => {
    const { image } = await presign();
    await db
      .update(schema.images)
      .set({ createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) });
    const storage = vi.mocked(S3StorageAdapter).mock.results.at(-1)?.value;
    storage.deleteObject.mockRejectedValueOnce(new Error('storage offline'));
    const failed = await core.cleanupAbandonedUploads();
    expect(failed.cleaned).toBe(0);
    expect(failed.errors).toEqual([
      { imageId: image.id, message: 'storage offline' },
    ]);
    expect((await db.select().from(schema.images))[0].status).toBe('failed');
    expect(await core.cleanupAbandonedUploads()).toMatchObject({
      cleaned: 1,
      errors: [],
    });
    expect(await db.select().from(schema.images)).toEqual([]);
  });

  it('enforces enum and boolean SQL checks even when the ORM is bypassed', async () => {
    const { image } = await presign();
    await expect(
      client.execute({
        sql: 'UPDATE images SET status = ? WHERE id = ?',
        args: ['hacked', image.id],
      })
    ).rejects.toThrow();
    await expect(
      client.execute({
        sql: 'UPDATE images SET is_public = ? WHERE id = ?',
        args: [2, image.id],
      })
    ).rejects.toThrow();
    expect((await db.select().from(schema.images))[0].status).toBe(
      'processing'
    );
  });

  it('enforces foreign keys and cascades deletion through all child tables', async () => {
    const { image } = await presign();
    await db
      .insert(schema.imageTags)
      .values({ imageId: image.id, tag: 'pixel' });
    await db.insert(schema.assetVariants).values({
      imageId: image.id,
      variant: 'thumb',
      byteSize: 10,
      storageKey: 'thumb',
    });
    await db
      .insert(schema.uploadSessions)
      .values({ imageId: image.id, expiresAt: new Date() });
    await expect(
      db.insert(schema.imageTags).values({ imageId: 'missing', tag: 'bad' })
    ).rejects.toThrow();
    await core.deleteImage(image.id, 'owner');
    expect(await db.select().from(schema.imageTags)).toEqual([]);
    expect(await db.select().from(schema.assetVariants)).toEqual([]);
    expect(await db.select().from(schema.uploadSessions)).toEqual([]);
  });

  it('retains processing state after a storage verification failure', async () => {
    const { image, storageKey } = await presign();
    const storage = vi.mocked(S3StorageAdapter).mock.results.at(-1)?.value;
    storage.headObject.mockResolvedValue({
      ContentLength: 69,
      ContentType: 'image/png',
    });
    await expect(core.finalize({ storageKey }, 'owner')).rejects.toThrow(
      'size does not match'
    );
    expect(
      (
        await db
          .select()
          .from(schema.images)
          .where(eq(schema.images.id, image.id))
      )[0].status
    ).toBe('processing');
  });
});

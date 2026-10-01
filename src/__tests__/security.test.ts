import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DrizzleDB, OctoloadCore } from '../handlers/core.js';
import { uploadSchema } from '../templates/upload-schema.js';

const storage = vi.hoisted(() => ({
  getPublicUrl: vi.fn(() => 'https://cdn.test/image'),
  getPrivateUrl: vi.fn(async () => 'https://storage.test/signed'),
}));

vi.mock('../storage/s3-adapter.js', () => ({
  S3StorageAdapter: vi.fn(function SecurityStorageMock() {
    return storage;
  }),
}));

// Exercise runtime validation with real Drizzle columns. Database execution and
// storage are mocked; this suite does not prove PostgreSQL or bucket behavior.
function fixture(status = 'ready', isPublic = false) {
  const row = {
    id: '00000000-0000-4000-8000-000000000001',
    ownerId: 'owner',
    status,
    isPublic,
    storageKey: 'uploads/image.jpg',
    alt: null,
    title: null,
  };
  const set = vi.fn((fields: Record<string, unknown>) => ({
    where: vi.fn(() => ({
      returning: vi.fn(async () => [{ ...row, ...fields }]),
    })),
  }));
  const update = vi.fn(() => ({ set }));
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => [row]) })),
      })),
    })),
    update,
  } as unknown as DrizzleDB;
  const core = new OctoloadCore(
    {
      adapter: 's3',
      bucket: 'test',
      region: 'us-east-1',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    },
    db,
    uploadSchema
  );
  return { core, row, update, set };
}

describe('core security boundaries', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['ownerId', 'attacker'],
    ['isPublic', true],
    ['storageKey', 'other-owner/secret.jpg'],
    ['status', 'ready'],
    ['publicUrl', 'https://attacker.test'],
  ])(
    'rejects metadata injection of %s before writing',
    async (field, value) => {
      const { core, row, update } = fixture();
      const metadata = JSON.parse(
        JSON.stringify({ alt: 'safe', [field]: value })
      );
      await expect(
        core.updateImageMetadata(row.id, metadata, 'owner')
      ).rejects.toThrow();
      expect(update).not.toHaveBeenCalled();
    }
  );

  it.each([
    { alt: 1 },
    { title: false },
    { alt: null },
    { title: ['title'] },
    { alt: 'a'.repeat(501) },
    { title: 't'.repeat(256) },
  ])('rejects invalid metadata %j', async (metadata) => {
    const { core, row, update } = fixture();
    await expect(
      core.updateImageMetadata(
        row.id,
        JSON.parse(JSON.stringify(metadata)),
        'owner'
      )
    ).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    { alt: 'Accessible image', title: 'Title' },
    { alt: '', title: '' },
    { alt: 'a'.repeat(500), title: 't'.repeat(255) },
    { alt: 'Only alt' },
    { title: 'Only title' },
  ])('persists allowed metadata %j', async (metadata) => {
    const { core, row, set, update } = fixture();
    const result = await core.updateImageMetadata(row.id, metadata, 'owner');
    expect(update).toHaveBeenCalledWith(uploadSchema.images);
    expect(set).toHaveBeenCalledWith({
      ...metadata,
      updatedAt: expect.any(Date),
    });
    expect(result).toMatchObject(metadata);
  });

  it.each([
    [undefined, 'Authentication required'],
    ['attacker', 'Access denied'],
  ])('rejects metadata updates by %s', async (userId, message) => {
    const { core, row, update } = fixture();
    await expect(
      core.updateImageMetadata(row.id, { alt: 'Changed' }, userId)
    ).rejects.toThrow(message);
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ['processing', true],
    ['failed', true],
    ['processing', false],
    ['failed', false],
  ])(
    'does not issue a URL for %s uploads (public=%s)',
    async (status, isPublic) => {
      const { core, row } = fixture(status as string, isPublic as boolean);
      await expect(core.getImage(row.id, 'owner')).rejects.toThrow(
        'Image not found'
      );
      expect(storage.getPublicUrl).not.toHaveBeenCalled();
      expect(storage.getPrivateUrl).not.toHaveBeenCalled();
    }
  );

  it.each([undefined, 'attacker'])(
    'allows public ready reads by %s',
    async (userId) => {
      const { core, row } = fixture('ready', true);
      await expect(core.getImage(row.id, userId)).resolves.toMatchObject({
        url: 'https://cdn.test/image',
      });
      expect(storage.getPublicUrl).toHaveBeenCalledWith(row.storageKey);
      expect(storage.getPrivateUrl).not.toHaveBeenCalled();
    }
  );

  it('allows the owner to read a ready private upload', async () => {
    const { core, row } = fixture();
    await expect(core.getImage(row.id, 'owner')).resolves.toMatchObject({
      url: 'https://storage.test/signed',
    });
    expect(storage.getPrivateUrl).toHaveBeenCalledWith(row.storageKey, 3600);
    expect(storage.getPublicUrl).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, 'Authentication required'],
    ['attacker', 'Access denied'],
  ])('rejects private ready reads by %s', async (userId, message) => {
    const { core, row } = fixture();
    await expect(core.getImage(row.id, userId)).rejects.toThrow(message);
    expect(storage.getPublicUrl).not.toHaveBeenCalled();
    expect(storage.getPrivateUrl).not.toHaveBeenCalled();
  });
});

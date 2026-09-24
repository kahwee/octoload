import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DrizzleDB } from '../handlers/core.js';
import {
  createDeleteImageHandler,
  createGetImageHandler,
} from '../handlers/index.js';
import { uploadSchema } from '../templates/upload-schema.js';
import type { ImageRecord } from '../types/index.js';

const storage = vi.hoisted(() => ({
  getPrivateUrl: vi.fn(async () => 'https://storage.test/signed-read'),
  deleteObject: vi.fn(async () => undefined),
}));

vi.mock('../storage/s3-adapter.js', () => ({
  S3StorageAdapter: vi.fn(function StorageAdapterMock() {
    return storage;
  }),
}));

const config = {
  adapter: 's3',
  bucket: 'photos',
  region: 'us-east-1',
  credentials: { accessKeyId: 'key', secretAccessKey: 'secret' },
};

const privateImage: ImageRecord = {
  id: 'image-1',
  ownerId: 'owner-1',
  filename: 'private.jpg',
  contentType: 'image/jpeg',
  byteSize: 10,
  status: 'ready',
  storageKey: 'uploads/private.jpg',
  isPublic: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeHandlers(image: ImageRecord) {
  const deleteRow = vi.fn(async () => undefined);
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [image] }),
      }),
    }),
    delete: () => ({ where: deleteRow }),
  } as unknown as DrizzleDB;
  const options = {
    config,
    db,
    schema: uploadSchema,
    getUser: async ({ request }: { request: Request }) => {
      const id = request.headers.get('x-test-user');
      return id ? { id } : null;
    },
  };
  return {
    get: createGetImageHandler(options),
    remove: createDeleteImageHandler(options),
    deleteRow,
  };
}

function request(user?: string, method = 'GET') {
  return new Request('https://app.test/api/images/image-1', {
    method,
    headers: user ? { 'x-test-user': user } : {},
  });
}

describe('image access through handlers and core', () => {
  beforeEach(() => vi.clearAllMocks());

  it('signs private reads only for the owner', async () => {
    const { get } = makeHandlers(privateImage);
    const guest = request();
    const stranger = request('other-user');
    const owner = request('owner-1');

    expect((await get(guest, privateImage.id, { request: guest })).status).toBe(
      401
    );
    expect(
      (await get(stranger, privateImage.id, { request: stranger })).status
    ).toBe(404);
    expect(storage.getPrivateUrl).not.toHaveBeenCalled();

    const response = await get(owner, privateImage.id, { request: owner });
    expect(response.status).toBe(200);
    expect((await response.json()).url).toBe(
      'https://storage.test/signed-read'
    );
    expect(storage.getPrivateUrl).toHaveBeenCalledOnce();
  });

  it('allows public reads but protects deletion for every image', async () => {
    const { get, remove, deleteRow } = makeHandlers({
      ...privateImage,
      isPublic: true,
    });
    const guest = request();
    expect((await get(guest, privateImage.id, { request: guest })).status).toBe(
      200
    );
    expect(storage.getPrivateUrl).not.toHaveBeenCalled();

    const guestDelete = request(undefined, 'DELETE');
    const strangerDelete = request('other-user', 'DELETE');
    expect(
      (await remove(guestDelete, privateImage.id, { request: guestDelete }))
        .status
    ).toBe(401);
    expect(
      (
        await remove(strangerDelete, privateImage.id, {
          request: strangerDelete,
        })
      ).status
    ).toBe(404);
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(deleteRow).not.toHaveBeenCalled();
  });
});

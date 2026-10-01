import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createClient } from '@libsql/client';
import { drizzle as pgDrizzle } from 'drizzle-orm/pglite';
import { drizzle as sqliteDrizzle } from 'drizzle-orm/libsql';
import {
  generateDrizzleJson,
  generateMigration,
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
} from 'drizzle-kit/api';
import { OctoloadCore } from '../handlers/core.js';
import * as pgSchema from '../templates/upload-schema.js';
import * as sqliteSchema from '../templates/upload-schema-sqlite.js';

const config = {
  adapter: 's3',
  bucket: 'offline-db-adversary',
  region: 'us-east-1',
  credentials: { accessKeyId: 'test-only', secretAccessKey: 'test-only' },
};

function storageFixture(core: OctoloadCore) {
  const objects = new Set<string>();
  const storage = {
    objects,
    getPresignedPutUrl: vi.fn(async () => ({
      url: 'https://example.invalid/upload',
    })),
    headObject: vi.fn(async (key: string) => {
      if (!objects.has(key))
        throw Object.assign(new Error('missing'), { name: 'NotFound' });
      return { ContentLength: 68, ContentType: 'image/png' };
    }),
    getPrivateUrl: vi.fn(async () => 'https://example.invalid/private'),
    deleteObject: vi.fn(async (key: string) => {
      objects.delete(key);
    }),
  };
  Object.defineProperty(core, 'storage', {
    value: storage,
    configurable: true,
  });
  return storage;
}

async function postgresFixture() {
  const client = new PGlite();
  for (const statement of await generateMigration(
    generateDrizzleJson({}),
    generateDrizzleJson(pgSchema)
  )) {
    await client.exec(statement);
  }
  const db = pgDrizzle(client, { schema: pgSchema });
  const core = new OctoloadCore(config, db, pgSchema.uploadSchema);
  return {
    core,
    rows: () => db.select().from(pgSchema.images),
    execute: (sql: string) => client.exec(sql),
    close: () => client.close(),
  };
}

async function sqliteFixture() {
  const client = createClient({ url: ':memory:' });
  await client.execute('PRAGMA foreign_keys = ON');
  for (const statement of await generateSQLiteMigration(
    await generateSQLiteDrizzleJson({}),
    await generateSQLiteDrizzleJson(sqliteSchema)
  ))
    await client.execute(statement);
  const db = sqliteDrizzle(client, { schema: sqliteSchema });
  const core = new OctoloadCore(config, db, sqliteSchema.uploadSchema);
  return {
    core,
    rows: () => db.select().from(sqliteSchema.images),
    execute: (sql: string) => client.executeMultiple(sql),
    close: async () => {
      client.close();
    },
  };
}

function gate() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

for (const dialect of ['postgres', 'sqlite'] as const) {
  describe(`${dialect}: actual SQL failures and lifecycle races`, () => {
    let fixture:
      | Awaited<ReturnType<typeof postgresFixture>>
      | Awaited<ReturnType<typeof sqliteFixture>>;
    let storage: ReturnType<typeof storageFixture>;
    beforeAll(async () => {
      fixture =
        dialect === 'postgres'
          ? await postgresFixture()
          : await sqliteFixture();
    }, 20_000);
    afterAll(async () => {
      await fixture?.close();
    });
    beforeEach(async () => {
      await fixture.execute('DELETE FROM images');
      storage = storageFixture(fixture.core);
    });
    const processing = async () => {
      const upload = await fixture.core.presign({
        filename: 'pixel.png',
        contentType: 'image/png',
        byteSize: 68,
        ownerId: 'owner',
      });
      const row = (await fixture.rows()).find(
        (image) => image.storageKey === upload.storageKey
      );
      if (!row) throw new Error('fixture insert failed');
      storage.objects.add(row.storageKey);
      return row;
    };
    const ready = async () => {
      const row = await processing();
      await fixture.core.finalize({ storageKey: row.storageKey }, 'owner');
      return row;
    };

    it('hides a ready row after storage deletion succeeds but SQL deletion fails, then permits retry', async () => {
      const row = await ready();
      await fixture.execute(
        dialect === 'sqlite'
          ? "CREATE TRIGGER fail_delete BEFORE DELETE ON images BEGIN SELECT RAISE(ABORT, 'injected SQL deletion failure'); END"
          : `CREATE FUNCTION fail_delete() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION 'injected SQL deletion failure'; END $$;
          CREATE TRIGGER fail_delete BEFORE DELETE ON images FOR EACH ROW EXECUTE FUNCTION fail_delete();`
      );
      try {
        await expect(
          fixture.core.deleteImage(row.id, 'owner')
        ).rejects.toThrow();
        expect(storage.objects.has(row.storageKey)).toBe(false);
        expect((await fixture.rows())[0].status).toBe('failed');
        await expect(fixture.core.getImage(row.id, 'owner')).rejects.toThrow(
          'Image not found'
        );
        expect(storage.getPrivateUrl).not.toHaveBeenCalled();
      } finally {
        await fixture.execute(
          dialect === 'sqlite'
            ? 'DROP TRIGGER fail_delete'
            : 'DROP TRIGGER fail_delete ON images; DROP FUNCTION fail_delete();'
        );
      }
      await fixture.core.deleteImage(row.id, 'owner');
      expect(await fixture.rows()).toEqual([]);
    });

    it('hides a row during a storage outage and permits the owner to retry deletion', async () => {
      const row = await ready();
      storage.deleteObject.mockRejectedValueOnce(
        new Error('injected storage outage')
      );
      await expect(fixture.core.deleteImage(row.id, 'owner')).rejects.toThrow(
        'storage outage'
      );
      expect((await fixture.rows())[0].status).toBe('failed');
      expect(storage.objects.has(row.storageKey)).toBe(true);
      await expect(fixture.core.getImage(row.id, 'owner')).rejects.toThrow(
        'Image not found'
      );
      await fixture.core.deleteImage(row.id, 'owner');
      expect(await fixture.rows()).toEqual([]);
      expect(storage.objects.has(row.storageKey)).toBe(false);
    });

    it('prevents finalize from making a row ready while owner deletion is in progress', async () => {
      const row = await processing();
      const enteredHead = gate();
      const releaseHead = gate();
      const enteredDelete = gate();
      const releaseDelete = gate();
      storage.headObject.mockImplementationOnce(async () => {
        enteredHead.resolve();
        await releaseHead.promise;
        return { ContentLength: 68, ContentType: 'image/png' };
      });
      storage.deleteObject.mockImplementationOnce(async (key) => {
        storage.objects.delete(key);
        enteredDelete.resolve();
        await releaseDelete.promise;
      });
      const finalizing = fixture.core.finalize(
        { storageKey: row.storageKey },
        'owner'
      );
      const observedFinalize = Promise.allSettled([finalizing]);
      await enteredHead.promise;
      const deleting = fixture.core.deleteImage(row.id, 'owner');
      try {
        await enteredDelete.promise;
        releaseHead.resolve();
        const [result] = await observedFinalize;
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected')
          expect(result.reason.message).toContain('no longer processing');
        await expect(fixture.core.getImage(row.id, 'owner')).rejects.toThrow(
          'Image not found'
        );
        expect(storage.getPrivateUrl).not.toHaveBeenCalled();
      } finally {
        releaseHead.resolve();
        releaseDelete.resolve();
        await deleting;
      }
      expect(await fixture.rows()).toEqual([]);
    });

    it('throws a controlled not-found error when a metadata update loses its row', async () => {
      const row = await ready();
      await fixture.execute(
        dialect === 'sqlite'
          ? `CREATE TRIGGER disappear_update BEFORE UPDATE ON images BEGIN
          DELETE FROM images WHERE id = OLD.id; SELECT RAISE(IGNORE); END`
          : `CREATE FUNCTION disappear_update() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN DELETE FROM images WHERE id = OLD.id; RETURN NULL; END $$;
          CREATE TRIGGER disappear_update BEFORE UPDATE ON images FOR EACH ROW EXECUTE FUNCTION disappear_update();`
      );
      try {
        await expect(
          fixture.core.updateImageMetadata(row.id, { title: 'new' }, 'owner')
        ).rejects.toThrow('Image not found');
        expect(await fixture.rows()).toEqual([]);
      } finally {
        await fixture.execute(
          dialect === 'sqlite'
            ? 'DROP TRIGGER disappear_update'
            : 'DROP TRIGGER disappear_update ON images; DROP FUNCTION disappear_update();'
        );
      }
    });

    it('does not touch storage when the SQL claim fails', async () => {
      const row = await ready();
      await fixture.execute(
        dialect === 'sqlite'
          ? "CREATE TRIGGER fail_claim BEFORE UPDATE ON images BEGIN SELECT RAISE(ABORT, 'injected claim failure'); END"
          : `CREATE FUNCTION fail_claim() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION 'injected claim failure'; END $$;
          CREATE TRIGGER fail_claim BEFORE UPDATE ON images FOR EACH ROW EXECUTE FUNCTION fail_claim();`
      );
      try {
        await expect(
          fixture.core.deleteImage(row.id, 'owner')
        ).rejects.toThrow();
        expect(storage.deleteObject).not.toHaveBeenCalled();
        expect(storage.objects.has(row.storageKey)).toBe(true);
        expect((await fixture.rows())[0].status).toBe('ready');
      } finally {
        await fixture.execute(
          dialect === 'sqlite'
            ? 'DROP TRIGGER fail_claim'
            : 'DROP TRIGGER fail_claim ON images; DROP FUNCTION fail_claim();'
        );
      }
    });
  });
}

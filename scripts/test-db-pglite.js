// Disposable PostgreSQL engine tests. Requires a build and @electric-sql/pglite.
// Storage is deliberately stubbed here; the separate live R2 harness checks S3.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { OctoloadCore } from '../dist/handlers/core.js';
import * as schema from '../dist/templates/upload-schema.js';

async function installSchema(client) {
  const statements = await generateMigration(
    generateDrizzleJson({}),
    generateDrizzleJson(schema)
  );
  for (const statement of statements) await client.exec(statement);
}

test('adversarial core flows against a disposable PostgreSQL engine', {
  timeout: 60_000,
}, async (t) => {
  const client = new PGlite();
  try {
    await installSchema(client);
    const db = drizzle(client, { schema });
    const core = new OctoloadCore(
      {
        storage: {
          adapter: 's3',
          bucket: 'disposable-db-test',
          region: 'us-east-1',
          credentials: {
            accessKeyId: 'test-only',
            secretAccessKey: 'test-only',
          },
        },
        limits: { maxFileSize: 1000, allowedTypes: ['image/png'] },
      },
      db,
      schema.uploadSchema
    );
    const objects = new Map();
    let headHook;
    // JavaScript can replace the private implementation seam without touching
    // production APIs. No network request is made by these storage doubles.
    core.storage = {
      getPresignedPutUrl: async (key, type, _ttl, size) => ({
        url: `https://example.invalid/${key}`,
        fields: { 'Content-Type': type, 'If-None-Match': '*' },
        size,
      }),
      getPrivateUrl: async (key) => `https://example.invalid/private/${key}`,
      getPublicUrl: (key) => `https://example.invalid/public/${key}`,
      headObject: async (key) => {
        if (headHook) await headHook(key);
        if (!objects.has(key))
          throw Object.assign(new Error('missing'), { name: 'NotFound' });
        return objects.get(key);
      },
      deleteObject: async (key) => {
        objects.delete(key);
      },
    };
    const create = async (owner = 'alice') => {
      const result = await core.presign({
        filename: 'pixel.png',
        contentType: 'image/png',
        byteSize: 68,
        ownerId: owner,
        entityType: 'recipe',
        entityId: entity,
      });
      const [row] = await db
        .select()
        .from(schema.images)
        .where(eq(schema.images.storageKey, result.storageKey));
      return row;
    };
    const entity = randomUUID();
    const put = (row) =>
      objects.set(row.storageKey, {
        ContentLength: row.byteSize,
        ContentType: row.contentType,
      });

    await t.test(
      'PostgreSQL rejects invalid UUIDs, enum values, nulls, oversized text and duplicate primary keys',
      async () => {
        const row = await create();
        const invalid = [
          { id: 'invalid-uuid' },
          { status: 'hacked' },
          { filename: null },
          { title: 'x'.repeat(256) },
        ];
        for (const values of invalid) {
          await assert.rejects(
            db
              .insert(schema.images)
              .values({ ...row, id: randomUUID(), ...values })
          );
        }
        await assert.rejects(db.insert(schema.images).values(row));
        const [persisted] = await db
          .select()
          .from(schema.images)
          .where(eq(schema.images.id, row.id));
        assert.equal(persisted.status, 'processing');
        assert.equal(persisted.isPublic, false);
      }
    );

    await t.test(
      'private ownership and processing state survive real SQL queries',
      async () => {
        const row = await create();
        await assert.rejects(core.getImage(row.id), /Authentication required/);
        await assert.rejects(core.getImage(row.id, 'mallory'), /Access denied/);
        await assert.rejects(core.getImage(row.id, 'alice'), /Image not found/);
        await assert.rejects(
          core.finalize({ storageKey: row.storageKey }, 'mallory'),
          /Access denied/
        );
        await assert.rejects(
          core.deleteImage(row.id, 'mallory'),
          /Access denied/
        );
        await assert.rejects(
          core.updateImageMetadata(row.id, { title: 'hijack' }, 'mallory'),
          /Access denied/
        );
        await assert.rejects(
          core.updateImageMetadata(
            row.id,
            { ownerId: 'mallory', isPublic: true },
            'alice'
          )
        );
        const [persisted] = await db
          .select()
          .from(schema.images)
          .where(eq(schema.images.id, row.id));
        assert.equal(persisted.ownerId, 'alice');
        assert.equal(persisted.isPublic, false);
        assert.equal(persisted.status, 'processing');
      }
    );

    await t.test(
      'missing objects and wrong size/type cannot become ready',
      async () => {
        const row = await create();
        await assert.rejects(
          core.finalize({ storageKey: row.storageKey }, 'alice'),
          /file not found/
        );
        objects.set(row.storageKey, {
          ContentLength: 69,
          ContentType: 'image/png',
        });
        await assert.rejects(
          core.finalize({ storageKey: row.storageKey }, 'alice'),
          /size does not match/
        );
        objects.set(row.storageKey, {
          ContentLength: 68,
          ContentType: 'text/html',
        });
        await assert.rejects(
          core.finalize({ storageKey: row.storageKey }, 'alice'),
          /content type does not match/
        );
        const [persisted] = await db
          .select()
          .from(schema.images)
          .where(eq(schema.images.id, row.id));
        assert.equal(persisted.status, 'processing');
      }
    );

    await t.test(
      '12 simultaneous finalizations produce exactly one winner',
      async () => {
        const row = await create();
        put(row);
        const results = await Promise.allSettled(
          Array.from({ length: 12 }, () =>
            core.finalize({ storageKey: row.storageKey }, 'alice')
          )
        );
        assert.equal(
          results.filter((result) => result.status === 'fulfilled').length,
          1
        );
        for (const result of results) {
          if (result.status === 'rejected')
            assert.match(result.reason.message, /no longer processing/);
        }
        const read = await core.getImage(row.id, 'alice');
        assert.equal(read.image.status, 'ready');
        assert.equal(read.image.publicUrl, null);
      }
    );

    await t.test(
      'ready listings isolate owners and hostile owner strings remain bound SQL parameters',
      async () => {
        const alice = await create('alice');
        const bob = await create('bob');
        const hostileOwner = "alice' OR 1=1 --";
        const hostile = await create(hostileOwner);
        for (const row of [alice, bob, hostile]) {
          put(row);
          await core.finalize({ storageKey: row.storageKey }, row.ownerId);
        }
        const aliceRows = await core.getImagesForEntity(
          'recipe',
          entity,
          'alice'
        );
        assert.ok(aliceRows.length > 0);
        assert.ok(
          aliceRows.every(
            (row) => row.ownerId === 'alice' && row.status === 'ready'
          )
        );
        const hostileRows = await core.getImagesForUser(hostileOwner);
        assert.equal(hostileRows.length, 1);
        assert.equal(hostileRows[0].id, hostile.id);
      }
    );

    await t.test(
      'cleanup winning during HeadObject prevents finalize and removes SQL row',
      async () => {
        const row = await create();
        put(row);
        await db
          .update(schema.images)
          .set({ createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000) })
          .where(eq(schema.images.id, row.id));
        let entered;
        let release;
        const started = new Promise((resolve) => {
          entered = resolve;
        });
        const blocked = new Promise((resolve) => {
          release = resolve;
        });
        headHook = async (key) => {
          if (key === row.storageKey) {
            entered();
            await blocked;
          }
        };
        // Capture metadata before cleanup to exercise the final SQL status guard.
        const metadata = objects.get(row.storageKey);
        const originalHead = core.storage.headObject;
        core.storage.headObject = async (key) => {
          if (key === row.storageKey) {
            await headHook(key);
            return metadata;
          }
          return originalHead(key);
        };
        const finalizing = core.finalize(
          { storageKey: row.storageKey },
          'alice'
        );
        const rejected = assert.rejects(finalizing, /no longer processing/);
        try {
          await started;
          const cleaned = await core.cleanupAbandonedUploads();
          assert.equal(cleaned.errors.length, 0);
          assert.ok(cleaned.cleaned >= 1);
        } finally {
          release();
          headHook = undefined;
          core.storage.headObject = originalHead;
        }
        await rejected;
        const rows = await db
          .select()
          .from(schema.images)
          .where(eq(schema.images.id, row.id));
        assert.equal(rows.length, 0);
        assert.equal(objects.has(row.storageKey), false);
      }
    );

    await t.test(
      'failed storage cleanup remains unfinalizable and retry removes its SQL row',
      async () => {
        const row = await create();
        put(row);
        await db
          .update(schema.images)
          .set({ createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000) })
          .where(eq(schema.images.id, row.id));
        const originalDelete = core.storage.deleteObject;
        core.storage.deleteObject = async (key) => {
          if (key === row.storageKey)
            throw new Error('deliberate storage outage');
          return originalDelete(key);
        };
        try {
          const cleaned = await core.cleanupAbandonedUploads();
          assert.equal(cleaned.errors.length, 1);
          assert.equal(cleaned.errors[0].imageId, row.id);
          const [failed] = await db
            .select()
            .from(schema.images)
            .where(eq(schema.images.id, row.id));
          assert.equal(failed.status, 'failed');
          assert.equal(objects.has(row.storageKey), true);
          await assert.rejects(
            core.finalize({ storageKey: row.storageKey }, 'alice'),
            /no longer processing/
          );
        } finally {
          core.storage.deleteObject = originalDelete;
        }
        const retry = await core.cleanupAbandonedUploads();
        assert.equal(retry.errors.length, 0);
        assert.equal(retry.cleaned, 1);
        assert.equal(
          (
            await db
              .select()
              .from(schema.images)
              .where(eq(schema.images.id, row.id))
          ).length,
          0
        );
        assert.equal(objects.has(row.storageKey), false);
      }
    );

    await t.test(
      'foreign keys reject orphans and deleting an image cascades all child rows',
      async () => {
        const row = await create();
        await assert.rejects(
          db
            .insert(schema.imageTags)
            .values({ imageId: randomUUID(), tag: 'orphan' })
        );
        await db
          .insert(schema.imageTags)
          .values({ imageId: row.id, tag: 'fixture' });
        await db.insert(schema.assetVariants).values({
          imageId: row.id,
          variant: 'thumb',
          byteSize: 2,
          storageKey: 'fixture/thumb',
        });
        await db
          .insert(schema.uploadSessions)
          .values({ imageId: row.id, expiresAt: new Date(Date.now() + 1000) });
        await core.deleteImage(row.id, 'alice');
        for (const table of [
          schema.imageTags,
          schema.assetVariants,
          schema.uploadSessions,
        ]) {
          const rows = await db
            .select()
            .from(table)
            .where(eq(table.imageId, row.id));
          assert.equal(rows.length, 0);
        }
      }
    );
  } finally {
    await client.close();
  }
});

test('optional real R2 upload → PostgreSQL finalize → private download → delete', {
  skip: process.env.OCTOLOAD_DB_TEST_LIVE_R2 !== '1',
  timeout: 60_000,
}, async () => {
  const required = [
    'OCTOLOAD_TEST_BUCKET',
    'OCTOLOAD_TEST_ENDPOINT',
    'OCTOLOAD_TEST_ACCESS_KEY_ID',
    'OCTOLOAD_TEST_SECRET_ACCESS_KEY',
  ];
  for (const name of required)
    assert.ok(process.env[name], `${name} is required`);
  assert.equal(process.env.OCTOLOAD_TEST_ADAPTER, 'r2');
  const deadline = AbortSignal.timeout(45_000);
  const requestSignal = () =>
    AbortSignal.any([deadline, AbortSignal.timeout(15_000)]);
  const client = new PGlite();
  const owner = `db-harness-${randomUUID()}`;
  let core;
  let row;
  let stage = 'schema setup';
  let failure;
  let send;
  try {
    await installSchema(client);
    const db = drizzle(client, { schema });
    core = new OctoloadCore(
      {
        storage: {
          adapter: 'r2',
          bucket: process.env.OCTOLOAD_TEST_BUCKET,
          region: process.env.OCTOLOAD_TEST_REGION || 'auto',
          endpoint: process.env.OCTOLOAD_TEST_ENDPOINT,
          credentials: {
            accessKeyId: process.env.OCTOLOAD_TEST_ACCESS_KEY_ID,
            secretAccessKey: process.env.OCTOLOAD_TEST_SECRET_ACCESS_KEY,
            ...(process.env.OCTOLOAD_TEST_SESSION_TOKEN
              ? { sessionToken: process.env.OCTOLOAD_TEST_SESSION_TOKEN }
              : {}),
          },
        },
      },
      db,
      schema.uploadSchema
    );
    send = core.storage.client.send.bind(core.storage.client);
    core.storage.client.send = (command, options = {}) =>
      send(command, {
        ...options,
        abortSignal: options.abortSignal
          ? AbortSignal.any([options.abortSignal, requestSignal()])
          : requestSignal(),
      });
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
      'base64'
    );
    stage = 'private presign';
    const upload = await core.presign({
      filename: `db-harness-${randomUUID()}.png`,
      contentType: 'image/png',
      byteSize: png.length,
      ownerId: owner,
    });
    [row] = await db
      .select()
      .from(schema.images)
      .where(eq(schema.images.storageKey, upload.storageKey));
    assert.equal(row.status, 'processing');
    assert.equal(row.isPublic, false);
    await assert.rejects(core.getImage(row.id, owner), /Image not found/);
    stage = 'actual signed PUT';
    const put = await fetch(upload.uploadUrl, {
      method: 'PUT',
      headers: upload.headers,
      body: png,
      signal: requestSignal(),
    });
    assert.ok(put.ok, `R2 PUT returned HTTP ${put.status}`);
    await put.arrayBuffer();
    stage = 'owner checks and actual HeadObject finalize';
    await assert.rejects(
      core.finalize({ storageKey: row.storageKey }, 'intruder'),
      /Access denied/
    );
    const finalized = await core.finalize(
      { storageKey: row.storageKey },
      owner
    );
    assert.equal(finalized.status, 'ready');
    assert.equal(finalized.publicUrl, null);
    await assert.rejects(core.getImage(row.id, 'intruder'), /Access denied/);
    stage = 'actual private signed GET';
    const download = await core.getImage(row.id, owner);
    const get = await fetch(download.url, {
      signal: requestSignal(),
    });
    assert.ok(get.ok, `R2 GET returned HTTP ${get.status}`);
    assert.deepEqual(Buffer.from(await get.arrayBuffer()), png);
    stage = 'overwrite replay after finalize';
    const replay = await fetch(upload.uploadUrl, {
      method: 'PUT',
      headers: upload.headers,
      body: png,
      signal: requestSignal(),
    });
    assert.equal(replay.status, 412);
    await replay.arrayBuffer();
    stage = 'delete storage and database';
    await core.deleteImage(row.id, owner);
    assert.equal(
      (
        await db
          .select()
          .from(schema.images)
          .where(eq(schema.images.id, row.id))
      ).length,
      0
    );
    await assert.rejects(
      core.storage.headObject(row.storageKey),
      (error) =>
        error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound'
    );
  } catch {
    // Node's test reporter must never print SDK errors containing signed URLs.
    failure = new Error(
      `Live database/R2 test failed during ${stage}; provider details redacted`
    );
  } finally {
    if (send && row) {
      try {
        // Cleanup remains possible after the main deadline has elapsed.
        await send(
          new DeleteObjectCommand({
            Bucket: process.env.OCTOLOAD_TEST_BUCKET,
            Key: row.storageKey,
          }),
          { abortSignal: AbortSignal.timeout(10_000) }
        );
      } catch {
        failure = new Error(
          'Live database/R2 object cleanup failed; provider details redacted'
        );
      }
    }
    core?.storage.client.destroy();
    await client.close();
  }
  if (failure) throw failure;
});

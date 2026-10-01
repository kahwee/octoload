// Opt-in private R2 lifecycle against real embedded SQLite; build first.
// Run with node --env-file=.env.r2-test --test scripts/test-db-sqlite-live.js.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq } from 'drizzle-orm';
import {
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
} from 'drizzle-kit/api';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { OctoloadCore } from '../dist/handlers/core.js';
import * as schema from '../dist/templates/upload-schema-sqlite.js';

test('real R2 upload → SQLite finalize → private download → cascade delete', {
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
  const client = createClient({ url: ':memory:' });
  const owner = `db-harness-${randomUUID()}`;
  let core;
  let row;
  let storageKey;
  const deadline = AbortSignal.timeout(45_000);
  let stage = 'schema setup';
  let failure;
  try {
    await client.execute('PRAGMA foreign_keys = ON');
    const empty = await generateSQLiteDrizzleJson({});
    const current = await generateSQLiteDrizzleJson(schema);
    for (const statement of await generateSQLiteMigration(empty, current)) {
      await client.execute(statement);
    }
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
    // Keep SDK HeadObject/DeleteObject requests bounded, including retries.
    const send = core.storage.client.send.bind(core.storage.client);
    core.storage.client.sendOriginal = send;
    core.storage.client.send = (command, options = {}) =>
      send(command, {
        ...options,
        abortSignal: AbortSignal.any([deadline, AbortSignal.timeout(15_000)]),
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
    storageKey = upload.storageKey;
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
      signal: AbortSignal.any([deadline, AbortSignal.timeout(15_000)]),
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
    assert.ok(finalized.createdAt instanceof Date);
    assert.ok(finalized.updatedAt instanceof Date);
    assert.equal(finalized.isPublic, false);
    await assert.rejects(core.getImage(row.id, 'intruder'), /Access denied/);
    stage = 'actual private signed GET';
    const download = await core.getImage(row.id, owner);
    const get = await fetch(download.url, {
      signal: AbortSignal.any([deadline, AbortSignal.timeout(15_000)]),
    });
    assert.ok(get.ok, `R2 GET returned HTTP ${get.status}`);
    assert.deepEqual(Buffer.from(await get.arrayBuffer()), png);
    stage = 'overwrite replay after finalize';
    const replay = await fetch(upload.uploadUrl, {
      method: 'PUT',
      headers: upload.headers,
      body: png,
      signal: AbortSignal.any([deadline, AbortSignal.timeout(15_000)]),
    });
    assert.equal(replay.status, 412);
    await replay.arrayBuffer();
    const retained = await fetch(download.url, {
      signal: AbortSignal.any([deadline, AbortSignal.timeout(15_000)]),
    });
    assert.ok(retained.ok, `R2 retained GET returned HTTP ${retained.status}`);
    assert.deepEqual(Buffer.from(await retained.arrayBuffer()), png);
    stage = 'SQLite child rows and cascade deletion';
    await db
      .insert(schema.imageTags)
      .values({ imageId: row.id, tag: 'live-test' });
    await db.insert(schema.assetVariants).values({
      imageId: row.id,
      variant: 'thumb',
      byteSize: png.length,
      storageKey: storageKey,
    });
    await db
      .insert(schema.uploadSessions)
      .values({ imageId: row.id, expiresAt: new Date(Date.now() + 60_000) });
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
    for (const table of [
      schema.imageTags,
      schema.assetVariants,
      schema.uploadSessions,
    ]) {
      assert.equal(
        (await db.select().from(table).where(eq(table.imageId, row.id))).length,
        0
      );
    }
    await assert.rejects(
      core.storage.headObject(row.storageKey),
      (error) =>
        error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound'
    );
  } catch {
    // Node's test reporter must never print SDK errors containing signed URLs.
    failure = new Error(
      `Live SQLite/R2 test failed during ${stage}; provider details redacted`
    );
  } finally {
    if (core && storageKey) {
      try {
        // Cleanup has its own deadline if the main test's deadline has elapsed.
        await core.storage.client.sendOriginal(
          new DeleteObjectCommand({
            Bucket: process.env.OCTOLOAD_TEST_BUCKET,
            Key: storageKey,
          }),
          { abortSignal: AbortSignal.timeout(10_000) }
        );
      } catch {
        failure = new Error(
          'Live SQLite/R2 object cleanup failed; provider details redacted'
        );
      }
    }
    core?.storage.client.destroy();
    client.close();
  }
  if (failure) throw failure;
});

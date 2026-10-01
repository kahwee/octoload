// After building: node examples/persistent-database.mjs sqlite (or pglite).
// Creates a temporary disk DB, reopens it, and removes it after verification.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  generateDrizzleJson,
  generateMigration,
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
} from 'drizzle-kit/api';
import { OctoloadCore } from '../dist/index.js';

const driver = process.argv[2] ?? 'sqlite';
assert.ok(['sqlite', 'pglite'].includes(driver), 'Use sqlite or pglite');
const directory = await mkdtemp(join(tmpdir(), 'octoload-persistence-'));
const schema = await import(
  driver === 'sqlite'
    ? '../dist/templates/upload-schema-sqlite.js'
    : '../dist/templates/upload-schema.js'
);
const open = async () => {
  if (driver === 'sqlite') {
    const { createClient } = await import('@libsql/client');
    const { drizzle } = await import('drizzle-orm/libsql');
    const client = createClient({
      url: `file:${join(directory, 'uploads.db')}`,
    });
    await client.execute('PRAGMA foreign_keys = ON');
    return {
      client,
      db: drizzle(client, { schema }),
      execute: (sql) => client.execute(sql),
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const client = new PGlite(join(directory, 'postgres'));
  return {
    client,
    db: drizzle(client, { schema }),
    execute: (sql) => client.exec(sql),
  };
};
let connection;
try {
  connection = await open();
  const statements =
    driver === 'sqlite'
      ? await generateSQLiteMigration(
          await generateSQLiteDrizzleJson({}),
          await generateSQLiteDrizzleJson(schema)
        )
      : await generateMigration(
          generateDrizzleJson({}),
          generateDrizzleJson(schema)
        );
  for (const sql of statements) await connection.execute(sql);
  const core = new OctoloadCore(
    {
      storage: {
        adapter: 's3',
        bucket: 'example-only',
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'fake-example',
          secretAccessKey: 'fake-example',
        },
      },
      limits: {
        maxFileSize: 1024,
        allowedTypes: ['image/png'],
        maxVariants: 0,
      },
    },
    connection.db,
    schema.uploadSchema
  );
  await core.presign({
    filename: 'pixel.png',
    contentType: 'image/png',
    byteSize: 68,
    ownerId: 'example-owner',
  });
  const [before] = await connection.db.select().from(schema.images);
  await connection.client.close();
  connection = undefined;
  connection = await open();
  const [after] = await connection.db.select().from(schema.images);
  assert.deepEqual(after, before, 'Row and Date/boolean values survive reopen');
  assert.equal(after.isPublic, false);
  assert.equal(after.status, 'processing');
  console.log(
    `${driver}: private upload metadata survives closing and reopening the disk database; no network upload sent`
  );
} finally {
  try {
    await connection?.client.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// Run after building: node examples/database.mjs sqlite (or pglite).
// A disposable DB and fake storage credentials: signs, but never uploads.
import assert from 'node:assert/strict';
import { OctoloadCore } from '../dist/index.js';
import {
  generateDrizzleJson,
  generateMigration,
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
} from 'drizzle-kit/api';

const dialect = process.argv[2] ?? 'sqlite';
assert.ok(['sqlite', 'pglite'].includes(dialect), 'Use sqlite or pglite');
const schema = await import(
  dialect === 'sqlite'
    ? '../dist/templates/upload-schema-sqlite.js'
    : '../dist/templates/upload-schema.js'
);
let client;
let db;
if (dialect === 'sqlite') {
  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  client = createClient({ url: ':memory:' });
  const statements = await generateSQLiteMigration(
    await generateSQLiteDrizzleJson({}),
    await generateSQLiteDrizzleJson(schema)
  );
  await client.execute('PRAGMA foreign_keys = ON');
  for (const statement of statements) await client.execute(statement);
  db = drizzle(client, { schema });
} else {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  client = new PGlite();
  const statements = await generateMigration(
    generateDrizzleJson({}),
    generateDrizzleJson(schema)
  );
  for (const statement of statements) await client.exec(statement);
  db = drizzle(client, { schema });
}
try {
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
    db,
    schema.uploadSchema
  );
  await core.presign({
    filename: 'pixel.png',
    contentType: 'image/png',
    byteSize: 68,
    ownerId: 'example-user',
  });
  const [image] = await db.select().from(schema.images);
  assert.equal(image.status, 'processing');
  assert.equal(image.isPublic, false);
  assert.ok(image.createdAt instanceof Date);
  console.log(
    `${dialect}: private processing record created; dates decoded; no upload sent`
  );
} finally {
  await client.close();
}

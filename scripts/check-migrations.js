// Exercise the packed CLI against persistent databases, including an index upgrade.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { PGlite } from '@electric-sql/pglite';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = resolve(process.argv[2] ?? join(root, 'dist/cli.js'));
const indexes = [
  'images_storage_key_unique',
  'images_owner_status_created_idx',
  'images_entity_owner_status_created_idx',
  'images_status_created_idx',
];
for (const dialect of ['sqlite', 'postgresql']) {
  const project = mkdtempSync(join(tmpdir(), 'octoload-migrations-'));
  const databasePath = join(
    project,
    dialect === 'sqlite' ? 'uploads.db' : 'pglite'
  );
  const databaseUrl =
    dialect === 'sqlite' ? `file:${databasePath}` : databasePath;
  const run = (args, online = true) => {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    if (online) env.DATABASE_URL = databaseUrl;
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: project,
      env,
      encoding: 'utf8',
      timeout: 60000,
    });
    assert.equal(
      result.status,
      0,
      `${dialect}: ${args.join(' ')}\n${result.stdout}\n${result.stderr}`
    );
  };
  const connect = async () => {
    if (dialect === 'sqlite') {
      const client = createClient({ url: databaseUrl });
      await client.execute('PRAGMA foreign_keys = ON');
      return {
        query: async (sql) => (await client.execute(sql)).rows,
        close: () => client.close(),
      };
    }
    const client = new PGlite(databasePath);
    return {
      query: async (sql) => (await client.query(sql)).rows,
      close: () => client.close(),
    };
  };
  let connection;
  try {
    writeFileSync(
      join(project, 'package.json'),
      JSON.stringify({
        name: 'migration-consumer',
        private: true,
        type: 'module',
      })
    );
    symlinkSync(
      join(root, 'node_modules'),
      join(project, 'node_modules'),
      'dir'
    );
    run(
      [
        'init',
        '--dialect',
        dialect,
        ...(dialect === 'postgresql' ? ['--driver', 'pglite'] : []),
      ],
      false
    );
    run(['generate', '--dialect', dialect], false);
    const schemaPath = join(project, 'src/db/upload-schema.ts');
    const currentSchema = readFileSync(schemaPath, 'utf8');
    // Match the previous release: same tables, without the newly added indexes.
    const previousSchema = currentSchema.replace(
      /(?:uniqueIndex|index)\('images_[^']+'\)\.on\([^)]*\),?/g,
      ''
    );
    assert.notEqual(previousSchema, currentSchema);
    writeFileSync(schemaPath, previousSchema);
    run(['migrate', '--generate-only'], false);
    assert.equal(
      existsSync(databasePath),
      false,
      'Offline generation must not create a database'
    );
    run(['migrate']);
    connection = await connect();
    await connection.query(`INSERT INTO images (id, owner_id, filename, content_type, byte_size, storage_key, title)
      VALUES ('00000000-0000-4000-8000-000000000001', 'owner', 'pixel.png', 'image/png', 3, 'existing/key', 'before')`);
    await connection.close();
    connection = undefined;

    writeFileSync(schemaPath, currentSchema);
    run(['migrate', '--generate-only'], false);
    const migrationDir = join(project, 'migrations');
    const migrations = readdirSync(migrationDir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    assert.equal(migrations.length, 2);
    const upgradePath = join(migrationDir, migrations[1]);
    const upgrade = readFileSync(upgradePath, 'utf8');
    for (const name of indexes) assert.ok(upgrade.includes(name));
    assert.doesNotMatch(upgrade, /DROP TABLE/i);
    // A schema push cannot execute this reviewed data migration.
    writeFileSync(
      upgradePath,
      `${upgrade}\n--> statement-breakpoint\nUPDATE images SET title = 'migrated' WHERE storage_key = 'existing/key';\n`
    );
    run(['migrate']);
    run(['migrate']); // Tracked migrations must be safe to rerun.
    connection = await connect();
    const rows = await connection.query(
      'SELECT filename, storage_key, title FROM images'
    );
    assert.deepEqual(
      rows.map((row) => ({ ...row })),
      [
        {
          filename: 'pixel.png',
          storage_key: 'existing/key',
          title: 'migrated',
        },
      ]
    );
    const ledger = await connection.query(
      dialect === 'sqlite'
        ? 'SELECT * FROM __drizzle_migrations'
        : 'SELECT * FROM drizzle.__drizzle_migrations'
    );
    assert.equal(ledger.length, 2, 'Each migration must be recorded once');
    const installed = await connection.query(
      dialect === 'sqlite'
        ? "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'images'"
        : "SELECT indexname AS name FROM pg_indexes WHERE tablename = 'images'"
    );
    for (const name of indexes)
      assert.ok(installed.some((row) => row.name === name));
    await assert.rejects(
      connection.query(`INSERT INTO images (id, filename, content_type, byte_size, storage_key)
      VALUES ('00000000-0000-4000-8000-000000000002', 'duplicate.png', 'image/png', 3, 'existing/key')`)
    );
    if (dialect === 'sqlite') {
      const queries = [
        "SELECT * FROM images WHERE storage_key = 'existing/key' LIMIT 1",
        "SELECT * FROM images WHERE owner_id = 'owner' AND status = 'ready' ORDER BY created_at",
        "SELECT * FROM images WHERE entity_type = 'post' AND entity_id = 'id' AND owner_id = 'owner' AND status = 'ready' ORDER BY created_at",
        "SELECT * FROM images WHERE status IN ('processing', 'failed') AND created_at < 1 ORDER BY created_at LIMIT 100",
      ];
      for (const [i, query] of queries.entries()) {
        const plan = await connection.query(`EXPLAIN QUERY PLAN ${query}`);
        assert.ok(
          plan.some((row) => String(row.detail).includes(indexes[i])),
          JSON.stringify(plan)
        );
      }
    }
    console.log(
      `${dialect}: offline generation, tracked upgrade, repeat migration, preserved data, and indexes passed`
    );
  } finally {
    await connection?.close();
    rmSync(project, { recursive: true, force: true });
  }
}

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import {
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
} from 'drizzle-kit/api';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import * as schema from '../dist/templates/upload-schema-sqlite.js';

const live = process.env.OCTOLOAD_E2E_LIVE === '1';
const port = Number(process.env.OCTOLOAD_E2E_PORT || 4317);
const origin = `http://localhost:${port}`;
const directory = await mkdtemp(join(tmpdir(), 'octoload-e2e-'));
let storageServer;
let child;
let connection;
let cleaning;
let databaseReady = false;
const objects = new Map();
async function cleanup() {
  if (cleaning) return cleaning;
  cleaning = (async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const stopped = new Promise((done) => child.once('exit', done));
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      await stopped;
      clearTimeout(timer);
    }
    let failed = false;
    if (connection && live && databaseReady) {
      const sdk = new S3Client({
        region: 'auto',
        endpoint: process.env.OCTOLOAD_TEST_ENDPOINT,
        maxAttempts: 1,
        credentials: {
          accessKeyId: process.env.OCTOLOAD_TEST_ACCESS_KEY_ID,
          secretAccessKey: process.env.OCTOLOAD_TEST_SECRET_ACCESS_KEY,
          ...(process.env.OCTOLOAD_TEST_SESSION_TOKEN
            ? { sessionToken: process.env.OCTOLOAD_TEST_SESSION_TOKEN }
            : {}),
        },
      });
      const deadline = AbortSignal.timeout(10000);
      const remaining = await drizzle(connection, { schema })
        .select()
        .from(schema.images);
      await Promise.all(
        remaining.map(async (row) => {
          try {
            await sdk.send(
              new DeleteObjectCommand({
                Bucket: process.env.OCTOLOAD_TEST_BUCKET,
                Key: row.storageKey,
              }),
              { abortSignal: deadline }
            );
          } catch {
            failed = true;
            console.error(`E2E cleanup failed for test image ${row.id}`);
          }
        })
      );
      sdk.destroy();
    }
    connection?.close();
    storageServer?.closeAllConnections();
    await new Promise((done) =>
      storageServer ? storageServer.close(done) : done()
    );
    if (!failed) await rm(directory, { recursive: true, force: true });
    else {
      console.error(`Preserved cleanup database at ${directory}`);
      process.exitCode = 1;
    }
  })();
  return cleaning;
}
try {
  if (live) {
    for (const name of [
      'ADAPTER',
      'BUCKET',
      'ENDPOINT',
      'ACCESS_KEY_ID',
      'SECRET_ACCESS_KEY',
    ]) {
      if (!process.env[`OCTOLOAD_TEST_${name}`])
        throw new Error(`Missing OCTOLOAD_TEST_${name}`);
    }
    if (process.env.OCTOLOAD_TEST_ADAPTER !== 'r2')
      throw new Error(
        'Live browser harness requires the dedicated R2 test configuration'
      );
  } else {
    // HTTP storage fixture: exercises browser CORS and conditional PUT, not SigV4.
    storageServer = createServer(async (req, res) => {
      if (req.headers.origin === origin)
        res.setHeader('Access-Control-Allow-Origin', origin);
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'PUT, GET, HEAD, DELETE',
          'Access-Control-Allow-Headers': 'content-type, if-none-match',
        });
        return res.end();
      }
      const key = new URL(req.url, 'http://fixture').pathname;
      if (req.method === 'PUT') {
        if (req.headers['if-none-match'] !== '*') {
          res.writeHead(403);
          return res.end();
        }
        if (objects.has(key)) {
          res.writeHead(412);
          return res.end();
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        if (objects.has(key)) {
          res.writeHead(412);
          return res.end();
        }
        objects.set(key, {
          body: Buffer.concat(chunks),
          type: req.headers['content-type'],
        });
        res.writeHead(200);
        return res.end();
      }
      if (req.method === 'DELETE') {
        objects.delete(key);
        res.writeHead(204);
        return res.end();
      }
      const object = objects.get(key);
      if (!object) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, {
        'Content-Type': object.type,
        'Content-Length': object.body.length,
      });
      res.end(req.method === 'HEAD' ? undefined : object.body);
    });
    await new Promise((done) => storageServer.listen(0, '127.0.0.1', done));
    Object.assign(process.env, {
      OCTOLOAD_TEST_BUCKET: 'octoload-browser-test',
      OCTOLOAD_TEST_ENDPOINT: `http://127.0.0.1:${storageServer.address().port}`,
      OCTOLOAD_TEST_ACCESS_KEY_ID: 'test-only',
      OCTOLOAD_TEST_SECRET_ACCESS_KEY: 'test-only',
    });
    delete process.env.OCTOLOAD_TEST_SESSION_TOKEN;
  }
  connection = createClient({ url: `file:${join(directory, 'metadata.db')}` });
  await connection.execute('PRAGMA foreign_keys = ON');
  for (const sql of await generateSQLiteMigration(
    await generateSQLiteDrizzleJson({}),
    await generateSQLiteDrizzleJson(schema)
  ))
    await connection.execute(sql);
  databaseReady = true;
  const bundle = join(directory, 'client.js');
  await build({
    entryPoints: ['tests/e2e/browser.js'],
    outfile: bundle,
    bundle: true,
    platform: 'browser',
    format: 'esm',
  });
  child = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'dev',
      'tests/e2e/fixture',
      '--webpack',
      '--hostname',
      'localhost',
      '--port',
      String(port),
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: '1',
        OCTOLOAD_E2E_ENABLED: '1',
        OCTOLOAD_E2E_DB: `file:${join(directory, 'metadata.db')}`,
        OCTOLOAD_E2E_BUNDLE: bundle,
      },
    }
  );
  // Next's request logging can contain signed URLs. Keep raw logs off stdout.
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      void cleanup().then(() => process.exit(process.exitCode || 0));
    });
  child.once('exit', () => {
    if (!cleaning) void cleanup();
  });
  console.log(
    `Browser fixture starting at ${origin}; storage=${live ? 'real R2' : 'local HTTP fixture'}`
  );
} catch (error) {
  console.error(
    `E2E setup failed: ${error instanceof Error && error.message.startsWith('Missing ') ? error.message : 'check fixture configuration'}`
  );
  await cleanup();
  process.exitCode = 1;
}

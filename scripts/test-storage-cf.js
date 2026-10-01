import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export async function checkCloudflareStorage(env = process.env, run = execute) {
  const bucket = env.OCTOLOAD_TEST_BUCKET;
  if (!bucket) throw new Error('Set OCTOLOAD_TEST_BUCKET');
  if (!env.CLOUDFLARE_ACCOUNT_ID) throw new Error('Set CLOUDFLARE_ACCOUNT_ID');
  const deadline = Date.now() + 45_000;
  const cf = (args, cleanup = false) =>
    run('cf', [...args, '--bucket-name', bucket, '--quiet'], {
      env,
      encoding: 'buffer',
      maxBuffer: 1024 * 1024,
      timeout: cleanup
        ? 15_000
        : Math.max(1, Math.min(15_000, deadline - Date.now())),
    });
  const json = async (args) => JSON.parse((await cf(args)).stdout.toString());
  const managed = await json(['r2', 'buckets', 'domains', 'managed', 'list']);
  assert.equal(
    managed.enabled,
    false,
    'Test bucket must disable r2.dev access'
  );
  const custom = await json(['r2', 'buckets', 'domains', 'custom', 'list']);
  assert.ok(
    Array.isArray(custom.domains),
    'Custom domains response must be a list'
  );
  assert.ok(
    custom.domains.every((domain) => domain.enabled === false),
    'Test bucket must disable every custom public domain'
  );
  const key = `octoload-cli-harness/${randomUUID()}/pixel.png`;
  const directory = await mkdtemp(join(tmpdir(), 'octoload-cli-harness-'));
  const file = join(directory, 'pixel.png');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64'
  );
  let attemptedPut = false;
  let failure;
  let cleanupFailure;
  try {
    await writeFile(file, png, { mode: 0o600 });
    attemptedPut = true;
    await cf([
      'r2',
      'objects',
      'put',
      key,
      '--file',
      file,
      '--content-type',
      'image/png',
      '--content-length',
      String(png.length),
    ]);
    const downloaded = (await cf(['r2', 'objects', 'get', key])).stdout;
    assert.deepEqual(
      downloaded,
      png,
      'CLI GET must preserve every binary PNG byte'
    );
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (attemptedPut)
        await cf(['r2', 'objects', 'delete', key, '--force'], true);
    } catch {
      cleanupFailure = new Error(`Cleanup failed; remove test object ${key}`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  if (cleanupFailure) throw cleanupFailure;
  if (failure) throw failure;
  let confirmedMissing = false;
  try {
    await cf(['r2', 'objects', 'get', key]);
  } catch (error) {
    const stderr = error.stderr?.toString() || '';
    confirmedMissing =
      error.code === 1 &&
      /\[10007\]/.test(stderr) &&
      /404 Not Found/.test(stderr);
  }
  assert.ok(
    confirmedMissing,
    'Deleted test object must return provider 404/code 10007'
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  checkCloudflareStorage().then(
    () =>
      console.log(
        'PASS: private R2 bucket, cf binary PUT/GET, cleanup, and deleted-object 404'
      ),
    (error) => {
      const safe =
        error.code === 'ERR_ASSERTION' ||
        /^(Set |Cleanup failed;)/.test(error.message);
      console.error(
        safe
          ? error.message
          : 'Cloudflare CLI storage check failed (details suppressed)'
      );
      process.exitCode = 1;
    }
  );
}

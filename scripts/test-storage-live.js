import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';

// Explicit configuration only: never fall back to AWS profiles or default buckets.
function required(name) {
  const value = process.env[`OCTOLOAD_TEST_${name}`];
  if (!value) throw new Error(`Set OCTOLOAD_TEST_${name}`);
  return value;
}

async function main() {
  const adapter = required('ADAPTER');
  assert.ok(['s3', 'r2'].includes(adapter), 'ADAPTER must be s3 or r2');
  const config = {
    adapter,
    bucket: required('BUCKET'),
    region: required('REGION'),
    endpoint: process.env.OCTOLOAD_TEST_ENDPOINT,
    credentials: {
      accessKeyId: required('ACCESS_KEY_ID'),
      secretAccessKey: required('SECRET_ACCESS_KEY'),
      sessionToken: process.env.OCTOLOAD_TEST_SESSION_TOKEN,
    },
  };
  if (adapter === 'r2') config.endpoint = required('ENDPOINT');
  assert.ok(
    adapter !== 's3' || !config.endpoint,
    'OCTOLOAD_TEST_ENDPOINT is supported only for the r2 adapter'
  );
  const { S3StorageAdapter } = await import('../dist/index.js');
  const storage = new S3StorageAdapter(config);
  const cleanupClient = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: config.credentials,
    maxAttempts: 1,
  });
  const prefix = `octoload-harness/${randomUUID()}`;
  const keys = [];
  const deadline = AbortSignal.timeout(45_000);
  // Valid 1x1 PNG; altered bytes are intentionally adversarial payloads.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64'
  );
  const changed = Buffer.from(png);
  changed[changed.length - 1] ^= 1;
  const request = async (url, options = {}) => {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.any([deadline, AbortSignal.timeout(15_000)]),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    return { status: response.status, bytes };
  };
  const presign = async (name) => {
    const key = `${prefix}/${name}.png`;
    keys.push(key);
    const signed = await storage.getPresignedPutUrl(
      key,
      'image/png',
      60,
      png.length
    );
    return { key, ...signed };
  };
  const put = (signed, body, headers = signed.fields) =>
    request(signed.url, { method: 'PUT', headers, body });
  const assertRejected = (result, label) =>
    assert.ok(
      [400, 403].includes(result.status),
      `${label}: HTTP ${result.status}`
    );

  try {
    // Fresh keys ensure a failed condition cannot hide broken signature checks.
    const missing = await presign('missing-condition');
    const missingHeaders = { ...missing.fields };
    for (const name of Object.keys(missingHeaders)) {
      if (name.toLowerCase() === 'if-none-match') delete missingHeaders[name];
    }
    assertRejected(
      await put(missing, png, missingHeaders),
      'Missing condition'
    );

    const tampered = await presign('tampered-condition');
    assertRejected(
      await put(tampered, png, {
        ...tampered.fields,
        'If-None-Match': '"other"',
      }),
      'Tampered condition'
    );

    const wrongSize = await presign('wrong-size');
    assertRejected(
      await put(wrongSize, Buffer.concat([png, Buffer.from([0])])),
      'Different byte size'
    );

    const valid = await presign('valid');
    const initial = await put(valid, png);
    assert.ok(
      initial.status >= 200 && initial.status < 300,
      `PUT: HTTP ${initial.status}`
    );
    const getUrl = await storage.getPrivateUrl(valid.key, 60);
    const firstRead = await request(getUrl);
    assert.equal(firstRead.status, 200, 'GET succeeds');
    assert.deepEqual(firstRead.bytes, png, 'GET preserves original bytes');
    const replay = await put(valid, changed);
    assert.equal(
      replay.status,
      412,
      'Replay must fail the absent-key condition'
    );
    const secondRead = await request(getUrl);
    assert.equal(secondRead.status, 200, 'GET after replay succeeds');
    assert.deepEqual(
      secondRead.bytes,
      png,
      'Replay cannot replace original bytes'
    );
    console.log(
      'PASS: signed headers, size binding, upload/read, and replay protection'
    );
  } finally {
    const cleanup = await Promise.allSettled(
      keys.map((key) =>
        cleanupClient.send(
          new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
          { abortSignal: AbortSignal.timeout(10_000) }
        )
      )
    );
    cleanupClient.destroy();
    const failed = cleanup.filter(
      (result) => result.status === 'rejected'
    ).length;
    if (failed) {
      console.error(`Cleanup failed for ${failed} objects under ${prefix}`);
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  // Provider/network errors can contain signed URLs. Print only our assertions
  // and configuration errors, never arbitrary SDK messages or response bodies.
  const safe =
    error.code === 'ERR_ASSERTION' ||
    error.message?.startsWith('Set OCTOLOAD_TEST_');
  console.error(
    safe
      ? error.message
      : 'Storage harness failed (provider/network/build error)'
  );
  process.exitCode = 1;
});

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { S3StorageAdapter } from '../dist/index.js';

const required = (name) => {
  const value = process.env[`OCTOLOAD_TEST_${name}`];
  if (!value) throw new Error(`Set OCTOLOAD_TEST_${name}`);
  return value;
};
async function main() {
  const adapter = required('ADAPTER');
  assert.equal(adapter, 'r2', 'This adversarial harness targets R2');
  const config = {
    adapter,
    bucket: required('BUCKET'),
    region: required('REGION'),
    endpoint: required('ENDPOINT'),
    credentials: {
      accessKeyId: required('ACCESS_KEY_ID'),
      secretAccessKey: required('SECRET_ACCESS_KEY'),
      sessionToken: process.env.OCTOLOAD_TEST_SESSION_TOKEN,
    },
  };
  const storage = new S3StorageAdapter(config);
  const client = new S3Client({ ...config, maxAttempts: 1 });
  const prefix = `octoload-adversarial/${randomUUID()}`;
  const keys = [];
  const deadline = AbortSignal.timeout(90_000);
  const body = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64'
  );
  const request = async (url, options = {}) => {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.any([deadline, AbortSignal.timeout(15_000)]),
    });
    return {
      status: response.status,
      bytes: Buffer.from(await response.arrayBuffer()),
    };
  };
  const sign = async (name) => {
    const key = `${prefix}/${name}.png`;
    keys.push(key);
    return {
      key,
      ...(await storage.getPresignedPutUrl(key, 'image/png', 60, body.length)),
    };
  };
  const put = (
    signed,
    payload = body,
    headers = signed.fields,
    url = signed.url
  ) => request(url, { method: 'PUT', body: payload, headers });
  const reject = (result, label) =>
    assert.ok(
      [400, 403].includes(result.status),
      `${label}: expected rejection, HTTP ${result.status}`
    );
  try {
    const signed = await sign('mutations');
    for (let i = 0; i < 64; i++) {
      const url = new URL(signed.url);
      const signature = url.searchParams.get('X-Amz-Signature');
      const replacement = signature[i] === '0' ? '1' : '0';
      url.searchParams.set(
        'X-Amz-Signature',
        signature.slice(0, i) + replacement + signature.slice(i + 1)
      );
      reject(
        await put(signed, body, signed.fields, url),
        `Signature mutation ${i}`
      );
    }
    console.log('PASS: all 64 single-position signature mutations rejected');
    for (const [name, value] of [
      ['X-Amz-Expires', '3600'],
      ['X-Amz-Date', '20000101T000000Z'],
      ['X-Amz-Credential', 'invalid/20000101/auto/s3/aws4_request'],
    ]) {
      const url = new URL(signed.url);
      url.searchParams.set(name, value);
      reject(await put(signed, body, signed.fields, url), `Tampered ${name}`);
    }
    const changedPath = new URL(signed.url);
    changedPath.pathname += '-different';
    keys.push(`${signed.key}-different`);
    reject(
      await put(signed, body, signed.fields, changedPath),
      'Changed object key'
    );
    reject(
      await put(signed, body, {
        ...signed.fields,
        'Content-Type': 'text/html',
      }),
      'Changed content type'
    );
    reject(await put(signed, Buffer.alloc(0)), 'Empty payload');
    const absent = await request(await storage.getPrivateUrl(signed.key, 60));
    assert.equal(absent.status, 404, 'Rejected mutations create no object');
    console.log(
      'PASS: altered expiry/date/credential/key/type and empty payload rejected'
    );

    const race = await sign('race');
    const contenders = Array.from({ length: 12 }, (_, i) => {
      const payload = Buffer.from(body);
      payload[payload.length - 1] = i;
      return payload;
    });
    const results = await Promise.all(
      contenders.map((payload) => put(race, payload))
    );
    const winners = results.flatMap((result, i) =>
      result.status >= 200 && result.status < 300 ? [i] : []
    );
    assert.equal(winners.length, 1, 'Concurrent PUT has exactly one winner');
    for (const [i, result] of results.entries())
      if (i !== winners[0])
        assert.equal(result.status, 412, 'Concurrent loser fails condition');
    const getUrl = await storage.getPrivateUrl(race.key, 60);
    assert.deepEqual(
      (await request(getUrl)).bytes,
      contenders[winners[0]],
      'Winning bytes preserved'
    );
    const unsigned = new URL(getUrl);
    unsigned.search = '';
    reject(await request(unsigned), 'Unsigned private read');
    const alteredGet = new URL(getUrl);
    alteredGet.searchParams.set('X-Amz-Signature', '0'.repeat(64));
    reject(await request(alteredGet), 'Forged private read');
    console.log(
      'PASS: 12 concurrent PUTs have one winner; unsigned/forged reads rejected'
    );

    const arbitrary = await sign('content-boundary');
    const nonImage = Buffer.alloc(body.length, 65);
    const accepted = await put(arbitrary, nonImage);
    assert.ok(
      accepted.status >= 200 && accepted.status < 300,
      'Same-size content is not image-validated by storage'
    );
    assert.deepEqual(
      (await request(await storage.getPrivateUrl(arbitrary.key, 60))).bytes,
      nonImage
    );
    console.log(
      'CONFIRMED LIMIT: signed size/type allows same-size non-image bytes; no image decoding is performed'
    );
  } finally {
    const cleanup = await Promise.allSettled(
      keys.map((Key) =>
        client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key }), {
          abortSignal: AbortSignal.timeout(10_000),
        })
      )
    );
    client.destroy();
    assert.ok(
      cleanup.every((result) => result.status === 'fulfilled'),
      'All allocated test keys cleaned up'
    );
    console.log('PASS: test objects cleaned up');
  }
}
main().catch((error) => {
  console.error(
    error.code === 'ERR_ASSERTION' ||
      error.message?.startsWith('Set OCTOLOAD_TEST_')
      ? error.message
      : 'Adversarial storage test failed; provider details withheld'
  );
  process.exitCode = 1;
});

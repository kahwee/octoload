import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { promisify } from 'node:util';

const run = promisify(execFile);
const script = new URL('./test-storage-live.js', import.meta.url).pathname;
const env = { ...process.env };
for (const name of Object.keys(env)) {
  if (name.startsWith('OCTOLOAD_TEST_')) delete env[name];
}

test('live harness fails before network without explicit configuration', async () => {
  await assert.rejects(run(process.execPath, [script], { env }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Set OCTOLOAD_TEST_ADAPTER/);
    return true;
  });
});

// Protocol fixture only: it deliberately does not verify SigV4 cryptography.
// Real-provider execution is required to prove that signatures enforce headers.
async function withFixture(acceptReplay, check) {
  const objects = new Map();
  let deletes = 0;
  let puts = 0;
  const fixtureErrors = [];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://fixture.invalid');
      const key = url.pathname;
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      if (request.method === 'DELETE') {
        deletes++;
        objects.delete(key);
        response.writeHead(204).end();
        return;
      }
      if (request.method === 'GET') {
        const body = objects.get(key);
        response.writeHead(body ? 200 : 404).end(body);
        return;
      }
      assert.equal(request.method, 'PUT');
      puts++;
      const signedHeaders = url.searchParams.get('X-Amz-SignedHeaders');
      for (const name of ['content-length', 'content-type', 'if-none-match']) {
        assert.ok(signedHeaders?.split(';').includes(name), `Signed ${name}`);
      }
      assert.equal(request.headers['content-type'], 'image/png');
      if (request.headers['if-none-match'] !== '*' || bytes.length !== 68) {
        response.writeHead(403).end();
        return;
      }
      if (objects.has(key) && !acceptReplay) {
        response.writeHead(412).end();
        return;
      }
      objects.set(key, bytes);
      response.writeHead(200).end();
    } catch (error) {
      fixtureErrors.push(error);
      response.writeHead(500).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const fixtureEnv = {
    ...env,
    OCTOLOAD_TEST_ADAPTER: 'r2',
    OCTOLOAD_TEST_BUCKET: 'test-bucket',
    OCTOLOAD_TEST_REGION: 'auto',
    OCTOLOAD_TEST_ENDPOINT: `http://127.0.0.1:${server.address().port}`,
    OCTOLOAD_TEST_ACCESS_KEY_ID: 'fixture-key',
    OCTOLOAD_TEST_SECRET_ACCESS_KEY: 'fixture-secret',
  };
  try {
    await check(
      run(process.execPath, [script], { env: fixtureEnv, timeout: 20_000 })
    );
    assert.deepEqual(fixtureErrors, [], 'Fixture protocol assertions pass');
    assert.equal(puts, 5, 'Three tampering probes, initial PUT, replay');
    assert.equal(deletes, 4, 'Every allocated key is cleaned up');
    assert.equal(objects.size, 0, 'No uploaded objects remain');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('live harness completes protocol checks and cleanup', async () => {
  await withFixture(false, async (execution) => {
    const result = await execution;
    assert.match(result.stdout, /PASS:/);
    assert.equal(result.stderr, '');
    assert.ok(!result.stdout.includes('fixture-secret'));
    assert.ok(!result.stdout.includes('X-Amz-Signature'));
  });
});

test('live harness detects replay acceptance and still cleans up', async () => {
  await withFixture(true, async (execution) => {
    await assert.rejects(execution, (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Replay must fail/);
      assert.ok(!error.stderr.includes('fixture-secret'));
      assert.ok(!error.stderr.includes('X-Amz-Signature'));
      return true;
    });
  });
});

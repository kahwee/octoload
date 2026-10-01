import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const harness = new URL('./test-storage-cf.js', import.meta.url).pathname;
const fake = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const root = process.env.OCTOLOAD_CF_FIXTURE;
const scenario = process.env.OCTOLOAD_CF_SCENARIO;
const object = path.join(root, 'object');
fs.appendFileSync(path.join(root, 'calls'), JSON.stringify(args) + '\\n');
const value = flag => args[args.indexOf(flag) + 1];
if (args.includes('managed')) {
  console.log(JSON.stringify({enabled: scenario === 'public'}));
} else if (args.includes('custom')) {
  console.log(JSON.stringify({domains: []}));
} else if (args[2] === 'put') {
  const bytes = fs.readFileSync(value('--file'));
  if (bytes.length !== Number(value('--content-length'))) process.exit(2);
  fs.writeFileSync(object, bytes);
} else if (args[2] === 'delete') {
  fs.rmSync(object, {force: true});
} else if (args[2] === 'get' && fs.existsSync(object)) {
  process.stdout.write(scenario === 'mismatch' ? Buffer.from('wrong') : fs.readFileSync(object));
} else if (args[2] === 'get') {
  console.error(scenario === 'auth' ? '[10000] 403 Forbidden' : '[10007] 404 Not Found');
  process.exit(1);
} else process.exit(2);
`;

async function fixture(scenario, verify) {
  const root = await mkdtemp(join(tmpdir(), 'octoload-cf-fixture-'));
  try {
    await writeFile(join(root, 'cf'), fake, { mode: 0o700 });
    const execution = execute(process.execPath, [harness], {
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH}`,
        CLOUDFLARE_ACCOUNT_ID: 'fixture-account',
        OCTOLOAD_TEST_BUCKET: 'fixture-bucket',
        OCTOLOAD_CF_FIXTURE: root,
        OCTOLOAD_CF_SCENARIO: scenario,
      },
      timeout: 10_000,
    });
    await verify(execution);
    const calls = (await readFile(join(root, 'calls'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    if (scenario === 'public') {
      assert.ok(!calls.some((args) => args.includes('put')));
    } else {
      assert.equal(calls.filter((args) => args[2] === 'delete').length, 1);
      await assert.rejects(readFile(join(root, 'object')), { code: 'ENOENT' });
      assert.ok(calls.every((args) => args.includes('--quiet')));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('cf harness refuses a public bucket before writing', async () => {
  await fixture('public', async (execution) => {
    await assert.rejects(execution, (error) => {
      assert.match(error.stderr, /disable r2.dev/);
      return error.code === 1;
    });
  });
});

test('cf harness verifies binary bytes and deleted-object 404', async () => {
  await fixture('success', async (execution) => {
    const result = await execution;
    assert.match(result.stdout, /PASS:/);
    assert.equal(result.stderr, '');
  });
});

test('cf harness catches byte mismatch and cleans up', async () => {
  await fixture('mismatch', async (execution) => {
    await assert.rejects(execution, (error) => {
      assert.match(error.stderr, /preserve every binary PNG byte/);
      return error.code === 1;
    });
  });
});

test('cf harness does not treat authorization failure as deletion proof', async () => {
  await fixture('auth', async (execution) => {
    await assert.rejects(execution, (error) => {
      assert.ok(!error.stdout.includes('PASS:'));
      return error.code === 1;
    });
  });
});

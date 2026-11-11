import { spawnSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  archiveIntegrity,
  compareVersions,
  registryState,
  verifyPublished,
} from './archive-registry.mjs';

const pkg = { name: 'example-package', version: '2.10.0' };
const integrity = archiveIntegrity(Buffer.from('checked tarball'));
const entry = (version, hash = integrity) => ({
  name: pkg.name,
  version,
  dist: { integrity: hash },
});
const data = (latest, versions = { [latest]: entry(latest) }) => ({
  name: pkg.name,
  'dist-tags': { latest },
  versions,
});
const response =
  (body, status = 200) =>
  async () => ({ status, json: async () => body });

test('compares unbounded stable version components', () => {
  assert.equal(compareVersions('2.10.0', '2.9.99'), 1);
  assert.equal(
    compareVersions('999999999999999999999.0.0', '1000000000000000000000.0.0'),
    -1
  );
  assert.equal(compareVersions('2.10.0', '2.10.0'), 0);
  assert.throws(() => compareVersions('2.01.0', '2.1.0'));
});

test('existing archives are immutable and newer latest is preserved', async () => {
  await assert.rejects(
    registryState(pkg, integrity, response(null, 404)),
    /not found/
  );
  assert.equal(
    await registryState(pkg, integrity, response(data('2.9.0'))),
    'new'
  );
  const versions = { '2.10.0': entry('2.10.0'), '3.0.0': entry('3.0.0') };
  assert.equal(
    await registryState(pkg, integrity, response(data('3.0.0', versions))),
    'published'
  );
  await verifyPublished(pkg, integrity, {
    request: response(data('3.0.0', versions)),
  });
  await assert.rejects(
    registryState(pkg, integrity, response(data('3.0.0'))),
    /Refusing/
  );
  versions['2.10.0'] = entry('2.10.0', 'sha512-different');
  await assert.rejects(
    registryState(pkg, integrity, response(data('3.0.0', versions))),
    /integrity/
  );
  await assert.rejects(
    verifyPublished(pkg, integrity, {
      request: response(data('3.0.0', versions)),
    }),
    /integrity/
  );
});

test('readback retries propagation only and exhausts a finite budget', async () => {
  let calls = 0;
  let sleeps = 0;
  const request = async () =>
    ++calls === 1
      ? { status: 404 }
      : { status: 200, json: async () => data(pkg.version) };
  await verifyPublished(pkg, integrity, {
    request,
    sleep: async () => {
      sleeps++;
    },
  });
  assert.equal(calls, 2);
  assert.equal(sleeps, 1);
  await assert.rejects(
    verifyPublished(pkg, integrity, {
      request: response(null, 404),
      attempts: 3,
      sleep: async () => {},
    }),
    /exhausted 3/
  );
  calls = 0;
  await assert.rejects(
    verifyPublished(pkg, integrity, {
      request: async () => {
        calls++;
        return { status: 403 };
      },
      sleep: async () => {},
    }),
    /HTTP 403/
  );
  assert.equal(calls, 1);
});

test('registry errors and malformed or inconsistent metadata fail closed', async () => {
  for (const status of [401, 403, 429, 500])
    await assert.rejects(registryState(pkg, integrity, response(null, status)));
  for (const body of [
    {},
    { ...data('2.9.0'), name: 'wrong' },
    data('bad'),
    { ...data('2.9.0'), versions: {} },
    data('2.9.0', { '2.9.0': entry('wrong') }),
  ]) {
    await assert.rejects(registryState(pkg, integrity, response(body)));
  }
  await assert.rejects(
    registryState(pkg, integrity, async () => ({
      status: 200,
      json: async () => {
        throw new Error('bad JSON');
      },
    }))
  );
  await assert.rejects(
    registryState(
      pkg,
      integrity,
      response(
        data(pkg.version, {
          [pkg.version]: { ...entry(pkg.version), name: 'wrong' },
        })
      )
    )
  );
});

test('missing version and older latest can propagate', async () => {
  let calls = 0;
  let sleeps = 0;
  const stages = [
    data('2.9.0'),
    data('2.9.0', {
      '2.9.0': entry('2.9.0'),
      [pkg.version]: entry(pkg.version),
    }),
    data(pkg.version),
  ];
  await verifyPublished(pkg, integrity, {
    request: async () => ({ status: 200, json: async () => stages[calls++] }),
    sleep: async () => {
      sleeps++;
    },
  });
  assert.equal(calls, 3);
  assert.equal(sleeps, 2);
});

test('local tarball integrity gates existing-version upload', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'archive-guard-'));
  try {
    writeFileSync(join(dir, 'content'), 'checked package');
    execFileSync('tar', [
      '-czf',
      join(dir, 'package.tgz'),
      '-C',
      dir,
      'content',
    ]);
    const checked = archiveIntegrity(readFileSync(join(dir, 'package.tgz')));
    const published = data(pkg.version, {
      [pkg.version]: entry(pkg.version, checked),
    });
    assert.equal(
      await registryState(pkg, checked, response(published)),
      'published'
    );
    await assert.rejects(
      registryState(
        pkg,
        archiveIntegrity(Buffer.from('different')),
        response(published)
      ),
      /integrity/
    );
    await assert.rejects(
      verifyPublished(pkg, checked, {
        request: response(data('2.9.0')),
        attempts: 2,
        sleep: async () => {},
      }),
      /exhausted 2/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('active publisher isolates OIDC from builds and verifies the archive', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/publish.yml', import.meta.url),
    'utf8'
  );
  const build = workflow.split('\n  build:')[1].split('\n  publish:')[0];
  const publish = workflow.split('\n  publish:')[1].split('\n  verify:')[0];
  const verify = workflow.split('\n  verify:')[1];
  assert.match(workflow, /on:\s*\n  release:\s*\n    types: \[published\]/);
  assert.match(workflow, /group: npm-release-octoload/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.equal((workflow.match(/id-token: write/g) || []).length, 1);
  assert.equal((workflow.match(/npm publish /g) || []).length, 1);
  assert.doesNotMatch(workflow, /NPM_TOKEN|NODE_AUTH_TOKEN/);
  assert.doesNotMatch(build, /id-token: write/);
  assert.match(build, /--archive-registry/);
  assert.match(build, /actions\/upload-artifact@/);
  assert.match(publish, /needs: build/);
  assert.match(publish, /if: needs\.build\.outputs\.should_publish == 'true'/);
  assert.match(publish, /id-token: write/);
  assert.match(publish, /actions\/download-artifact@/);
  assert.match(publish, /sha256sum -c package\.tgz\.sha256/);
  assert.match(publish, /npm publish .*--ignore-scripts/);
  assert.doesNotMatch(
    publish,
    /actions\/checkout|pnpm|npm install|npm ci|node scripts/
  );
  assert.doesNotMatch(verify, /id-token: write|npm publish/);
  assert.match(verify, /--verify-archive/);
});
test('prerelease release readback verifies next and leaves newer latest untouched', async () => {
  const versions = { '2.10.0': entry('2.10.0'), '3.0.0': entry('3.0.0') };
  const payload = data('3.0.0', versions);
  let calls = 0;
  await verifyPublished(pkg, integrity, {
    tag: 'next',
    request: async () => ({
      status: 200,
      json: async () =>
        ++calls === 1
          ? payload
          : { ...payload, 'dist-tags': { latest: '3.0.0', next: pkg.version } },
    }),
    sleep: async () => {},
  });
  assert.equal(calls, 2);
  await assert.rejects(
    verifyPublished(pkg, integrity, {
      tag: 'next',
      request: response({
        ...payload,
        'dist-tags': { latest: '3.0.0', next: 'bad' },
      }),
      sleep: async () => {},
    }),
    /Malformed/
  );
});

test('legacy registry CLI still works without an archive', () => {
  const dir = mkdtempSync(join(tmpdir(), 'legacy-guard-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
    const hook = join(dir, 'fetch.mjs');
    writeFileSync(
      hook,
      `globalThis.fetch = async () => ({ status: Number(process.env.TEST_STATUS), json: async () => JSON.parse(process.env.TEST_BODY) });`
    );
    const script = new URL('./release-check.mjs', import.meta.url).pathname;
    const run = (status, body) =>
      spawnSync(
        process.execPath,
        ['--import', hook, script, 'v2.10.0', '--registry'],
        {
          cwd: dir,
          env: {
            ...process.env,
            GITHUB_OUTPUT: join(dir, 'output'),
            TEST_STATUS: String(status),
            TEST_BODY: JSON.stringify(body),
          },
        }
      );
    assert.equal(run(404, {}).status, 0);
    assert.match(
      readFileSync(join(dir, 'output'), 'utf8'),
      /should_publish=true/
    );
    writeFileSync(join(dir, 'output'), '');
    assert.equal(run(200, pkg).status, 0);
    assert.match(
      readFileSync(join(dir, 'output'), 'utf8'),
      /should_publish=false/
    );
    assert.equal(run(200, { ...pkg, name: 'wrong' }).status, 1);
    assert.equal(run(403, {}).status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

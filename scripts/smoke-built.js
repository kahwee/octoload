import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packed = mkdtempSync(join(tmpdir(), 'octoload-packed-'));
const packageRoot = join(packed, 'node_modules/octoload');
const cli = join(packageRoot, 'dist/cli.js');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`
  );
  return result.stdout;
}

function runCli(args, cwd = root) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
  });
  assert.equal(
    result.status,
    0,
    `octoload ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`
  );
  return result.stdout;
}

try {
  const tarball = join(packed, 'octoload.tgz');
  run(process.env.npm_execpath || 'pnpm', ['pack', '--out', tarball]);
  const entries = run('tar', ['-tzf', tarball]).trim().split('\n');
  for (const path of [
    'README.md',
    'CHANGELOG.md',
    'docs/nextjs.md',
    'docs/integrations.md',
    'docs/testing.md',
    'docs/releasing.md',
    'docs/databases.md',
    'examples/README.md',
    'examples/presign.mjs',
    'examples/database.mjs',
  ]) {
    assert.ok(
      entries.includes(`package/${path}`),
      `Package is missing ${path}`
    );
  }
  assert.ok(
    !entries.some((path) => path.includes('/__tests__/')),
    'Do not ship test fixtures'
  );
  mkdirSync(packageRoot, { recursive: true });
  run('tar', ['-xzf', tarball, '--strip-components=1', '-C', packageRoot]);
  const packedManifest = JSON.parse(
    readFileSync(join(packageRoot, 'package.json'), 'utf8')
  );
  assert.equal(packedManifest.version, manifest.version);
  for (const target of Object.values(packedManifest.exports)) {
    assert.ok(
      existsSync(join(packageRoot, target.types)),
      `Missing type entry: ${target.types}`
    );
  }
  // Resolve only declared runtime dependencies from the existing install. The
  // Octoload code and export map come from the tarball, not repository self-imports.
  for (const name of Object.keys(manifest.dependencies)) {
    const destination = join(packed, 'node_modules', name);
    mkdirSync(dirname(destination), { recursive: true });
    symlinkSync(
      realpathSync(join(root, 'node_modules', name)),
      destination,
      'dir'
    );
  }
  const consumer = join(packed, 'consumer.mjs');
  writeFileSync(
    consumer,
    `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as library from 'octoload';
import * as client from 'octoload/client';
import * as next from 'octoload/nextjs';
import * as router from 'octoload/react-router';
assert.equal(typeof library.createPresignHandler, 'function');
assert.equal(typeof client.OctoloadClient, 'function');
assert.equal(typeof next.createPresignHandler, 'function');
assert.equal(typeof router.createPresignHandler, 'function');
const require = createRequire(import.meta.url);
for (const name of ['octoload', 'octoload/client', 'octoload/nextjs', 'octoload/react-router']) {
  assert.ok(Object.keys(require(name)).length > 0);
}
`
  );
  run(process.execPath, [consumer], packed);
  assert.match(
    run(process.execPath, [join(packageRoot, 'examples/presign.mjs')], packed),
    /Signing example passed/
  );
  assert.equal(runCli(['--version']).trim(), manifest.version);
  assert.match(runCli(['--help']), /init|generate/);

  const project = mkdtempSync(join(tmpdir(), 'octoload-built-'));
  const r2Project = mkdtempSync(join(tmpdir(), 'octoload-r2-built-'));
  try {
    runCli(['init', '--framework', 'nextjs', '--auth', 'better-auth'], project);
    const route = join(project, 'src/app/api/uploads/presign/route.ts');
    const routeContent = readFileSync(route, 'utf8');
    assert.match(routeContent, /requireAuth: true/);
    assert.match(
      readFileSync(join(project, 'src/lib/octoload/auth.ts'), 'utf8'),
      /auth\.api\.getSession/
    );
    assert.match(
      readFileSync(join(project, 'src/lib/octoload/server.ts'), 'utf8'),
      /getUser: \(request: Request\) => getUploadUser\(request\)/
    );

    runCli(['generate'], project);
    assert.match(
      readFileSync(join(project, 'src/db/upload-schema.ts'), 'utf8'),
      /export const images = pgTable/
    );
    assert.match(
      readFileSync(join(project, 'src/db/upload-schema.ts'), 'utf8'),
      /ownerId: varchar\('owner_id', \{ length: 255 \}\)/
    );

    writeFileSync(route, 'custom route');
    runCli(['init', '--framework', 'nextjs', '--auth', 'better-auth'], project);
    assert.equal(readFileSync(route, 'utf8'), 'custom route');

    runCli(
      [
        'init',
        '--framework',
        'react-router',
        '--adapter',
        'r2',
        '--auth',
        'better-auth',
      ],
      r2Project
    );
    runCli(['generate', '--output', 'app/db/upload-schema.ts'], r2Project);
    assert.match(
      readFileSync(join(r2Project, 'app/lib/octoload/server.ts'), 'utf8'),
      /getUser: \(\{ request \}: \{ request: Request \}\) => getUploadUser\(request\)/
    );
    assert.match(
      readFileSync(join(r2Project, 'app/lib/octoload/config.ts'), 'utf8'),
      /R2_PUBLIC_BASE_URL/
    );
    assert.match(
      readFileSync(join(r2Project, '.env.example'), 'utf8'),
      /R2_REGION=auto/
    );
    assert.match(
      readFileSync(join(r2Project, 'app/db/upload-schema.ts'), 'utf8'),
      /ownerId: varchar\('owner_id', \{ length: 255 \}\)/
    );
    const sqliteProject = join(project, 'sqlite-app');
    mkdirSync(sqliteProject);
    runCli(
      ['init', '--framework', 'nextjs', '--dialect', 'sqlite'],
      sqliteProject
    );
    runCli(['generate', '--dialect', 'sqlite'], sqliteProject);
    assert.match(
      readFileSync(join(sqliteProject, 'drizzle.config.ts'), 'utf8'),
      /dialect: 'sqlite'/
    );
    assert.match(
      readFileSync(join(sqliteProject, 'src/db/upload-schema.ts'), 'utf8'),
      /sqliteTable/
    );
    assert.match(
      readFileSync(join(sqliteProject, '.env.example'), 'utf8'),
      /DATABASE_URL=file:/
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(r2Project, { recursive: true, force: true });
  }

  console.log(
    'Packed package exports, CLI version/scaffolds, guides, and signing example passed.'
  );
} finally {
  rmSync(packed, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, 'dist/cli.js');

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

const library = await import('octoload');
const client = await import('octoload/client');
const next = await import('octoload/nextjs');
const router = await import('octoload/react-router');
assert.equal(typeof library.createPresignHandler, 'function');
assert.equal(typeof client.OctoloadClient, 'function');
assert.equal(typeof next.createPresignHandler, 'function');
assert.equal(typeof router.createPresignHandler, 'function');
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
} finally {
  rmSync(project, { recursive: true, force: true });
  rmSync(r2Project, { recursive: true, force: true });
}

console.log('Built package exports and CLI scaffold passed.');

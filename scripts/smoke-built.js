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
try {
  runCli(['init', '--framework', 'nextjs', '--auth', 'better-auth'], project);
  const route = join(project, 'src/app/api/uploads/presign/route.ts');
  const routeContent = readFileSync(route, 'utf8');
  assert.match(routeContent, /requireAuth: true/);
  assert.match(
    readFileSync(join(project, 'src/lib/octoload/auth.ts'), 'utf8'),
    /auth\.api\.getSession/
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
} finally {
  rmSync(project, { recursive: true, force: true });
}

console.log('Built package exports and CLI scaffold passed.');

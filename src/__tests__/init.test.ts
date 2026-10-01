import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initCommand } from '../commands/init.js';

describe('init scaffold', () => {
  const projects: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const project of projects)
      rmSync(project, { recursive: true, force: true });
    projects.length = 0;
  });

  function project() {
    const dir = mkdtempSync(join(tmpdir(), 'octoload-init-'));
    projects.push(dir);
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    return dir;
  }

  it('creates Next.js routes with valid relative server imports and preserves edits', async () => {
    const dir = project();
    await initCommand({ adapter: 's3', framework: 'nextjs' });
    const route = join(dir, 'src/app/api/uploads/presign/route.ts');
    const content = readFileSync(route, 'utf8');
    expect(content).toContain(
      'createPresignHandler({ ...uploadHandlerOptions, requireAuth: true })'
    );
    expect(resolve(dirname(route), '../../../../lib/octoload/server')).toBe(
      join(dir, 'src/lib/octoload/server')
    );
    expect(
      readFileSync(join(dir, 'src/lib/octoload/server.ts'), 'utf8')
    ).toContain('getUser: (request: Request) => getUploadUser(request)');

    writeFileSync(route, 'custom route');
    await initCommand({ adapter: 's3', framework: 'nextjs' });
    expect(readFileSync(route, 'utf8')).toBe('custom route');
    expect(
      readFileSync(join(dir, '.env.example'), 'utf8').match(/S3_BUCKET=/g)
    ).toHaveLength(1);
  });

  it('creates React Router routes and matching schema location', async () => {
    const dir = project();
    await initCommand({
      adapter: 'r2',
      framework: 'react-router',
      auth: 'better-auth',
    });
    expect(readFileSync(join(dir, 'drizzle.config.ts'), 'utf8')).toContain(
      "schema: 'app/db/upload-schema.ts'"
    );
    expect(
      readFileSync(join(dir, 'app/routes/api.images.$imageId.ts'), 'utf8')
    ).toContain('createDeleteImageHandler(uploadHandlerOptions)');
    const auth = readFileSync(join(dir, 'app/lib/octoload/auth.ts'), 'utf8');
    expect(auth).toContain("from '../auth.server'");
    expect(auth).toContain('auth.api.getSession({ headers: request.headers })');
    expect(
      readFileSync(join(dir, 'app/lib/octoload/server.ts'), 'utf8')
    ).toContain(
      'getUser: ({ request }: { request: Request }) => getUploadUser(request)'
    );
    const env = readFileSync(join(dir, '.env.example'), 'utf8');
    expect(env).toContain('R2_REGION=auto');
    expect(env).toContain('R2_PUBLIC_BASE_URL=');
    expect(
      readFileSync(join(dir, 'app/lib/octoload/config.ts'), 'utf8')
    ).toContain('publicBaseUrl: process.env.R2_PUBLIC_BASE_URL || undefined');
  });
  it('creates SQLite configuration and keeps existing database configuration', async () => {
    const dir = project();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await initCommand({
      adapter: 'r2',
      framework: 'nextjs',
      dialect: 'sqlite',
    });
    const config = join(dir, 'drizzle.config.ts');
    expect(readFileSync(config, 'utf8')).toContain("dialect: 'sqlite'");
    expect(readFileSync(config, 'utf8')).toContain('process.env.DATABASE_URL!');
    expect(readFileSync(join(dir, '.env.example'), 'utf8')).toContain(
      'DATABASE_URL=file:./uploads.db'
    );
    expect(log).toHaveBeenCalledWith(
      'Next: pnpm exec octoload generate --dialect sqlite --output src/db/upload-schema.ts'
    );
    writeFileSync(config, 'existing database configuration');
    await initCommand({
      adapter: 'r2',
      framework: 'nextjs',
      dialect: 'postgresql',
    });
    expect(readFileSync(config, 'utf8')).toBe(
      'existing database configuration'
    );
  });

  it('rejects unsupported dialects before writing scaffold files', async () => {
    const dir = project();
    await expect(
      initCommand({
        adapter: 's3',
        framework: 'nextjs',
        dialect: 'mysql' as 'sqlite',
      })
    ).rejects.toThrow('Database dialect must be postgresql or sqlite');
    expect(() => readFileSync(join(dir, 'drizzle.config.ts'))).toThrow();
  });
});

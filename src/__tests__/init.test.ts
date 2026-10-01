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
    expect(readFileSync(config, 'utf8')).toContain(
      "process.loadEnvFile('.env')"
    );
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
  it('scaffolds persistent PGlite with PostgreSQL schema and preserves app database edits', async () => {
    const dir = project();
    writeFileSync(join(dir, '.env.example'), 'S3_BUCKET=existing\n');
    await initCommand({ adapter: 's3', framework: 'nextjs', driver: 'pglite' });
    const config = readFileSync(join(dir, 'drizzle.config.ts'), 'utf8');
    expect(config).toContain("dialect: 'postgresql'");
    expect(config).toContain("driver: 'pglite'");
    const dbPath = join(dir, 'src/db/index.ts');
    const db = readFileSync(dbPath, 'utf8');
    expect(db).toContain("from 'drizzle-orm/pglite'");
    expect(db).toContain('new PGlite(dataDir)');
    expect(db).toContain('if (!dataDir) throw new Error');
    const env = readFileSync(join(dir, '.env.example'), 'utf8');
    expect(env).toContain('DATABASE_URL=./uploads-pglite');
    expect(env.match(/S3_BUCKET=/g)).toHaveLength(1);
    writeFileSync(dbPath, 'existing application DB');
    await initCommand({ adapter: 's3', framework: 'nextjs', driver: 'pglite' });
    expect(readFileSync(dbPath, 'utf8')).toBe('existing application DB');
    expect(readFileSync(join(dir, '.env.example'), 'utf8')).toBe(env);
  });

  it('rejects a PGlite and SQLite combination before writing files', async () => {
    const dir = project();
    await expect(
      initCommand({
        adapter: 's3',
        framework: 'nextjs',
        dialect: 'sqlite',
        driver: 'pglite',
      })
    ).rejects.toThrow('PGlite requires the postgresql dialect');
    expect(() => readFileSync(join(dir, 'drizzle.config.ts'))).toThrow();
  });

  it('rejects unsupported drivers and preserves an existing exported database URL', async () => {
    const dir = project();
    await expect(
      initCommand({
        adapter: 's3',
        framework: 'nextjs',
        driver: 'unknown' as 'pglite',
      })
    ).rejects.toThrow('Database driver must be pglite');
    writeFileSync(
      join(dir, '.env.example'),
      'export DATABASE_URL = ./custom-db\n'
    );
    await initCommand({
      adapter: 'r2',
      framework: 'react-router',
      driver: 'pglite',
    });
    expect(readFileSync(join(dir, '.env.example'), 'utf8')).not.toContain(
      'DATABASE_URL=./uploads-pglite'
    );
    expect(readFileSync(join(dir, 'app/db/index.ts'), 'utf8')).toContain(
      'new PGlite(dataDir)'
    );
  });
  it.each([
    [
      { dialect: 'sqlite' as const },
      [
        '/uploads.db',
        '/uploads.db-journal',
        '/uploads.db-wal',
        '/uploads.db-shm',
      ],
    ],
    [{ driver: 'pglite' as const }, ['/uploads-pglite/']],
  ])(
    'ignores default local database files without dropping existing ignore entries',
    async (database, patterns) => {
      const dir = project();
      const path = join(dir, '.gitignore');
      writeFileSync(path, 'node_modules/\n.env');
      await initCommand({ adapter: 's3', framework: 'nextjs', ...database });
      const once = readFileSync(path, 'utf8');
      expect(once.startsWith('node_modules/\n.env\n')).toBe(true);
      for (const pattern of patterns)
        expect(once.split('\n')).toContain(pattern);
      await initCommand({ adapter: 's3', framework: 'nextjs', ...database });
      expect(readFileSync(path, 'utf8')).toBe(once);
    }
  );
});

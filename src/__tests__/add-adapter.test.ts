import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addAdapterCommand } from '../commands/add-adapter.js';

const sdk = ['@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner'];

describe('add adapter preserves consumer configuration', () => {
  const projects: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const path of projects) rmSync(path, { recursive: true, force: true });
    projects.length = 0;
  });
  function project(content: object = { name: 'consumer' }) {
    const path = mkdtempSync(join(tmpdir(), 'octoload-add-'));
    projects.push(path);
    writeFileSync(join(path, 'package.json'), JSON.stringify(content));
    vi.spyOn(process, 'cwd').mockReturnValue(path);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    return path;
  }
  it('adds the current package SDK ranges only when missing and is idempotent', async () => {
    const own = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8')
    );
    const path = project();
    await addAdapterCommand('s3');
    const once = readFileSync(join(path, 'package.json'), 'utf8');
    const deps = JSON.parse(once).dependencies;
    for (const name of sdk) expect(deps[name]).toBe(own.dependencies[name]);
    const env = readFileSync(join(path, '.env.example'), 'utf8');
    expect(env).toContain('S3_REGION=us-east-1');
    await addAdapterCommand('s3');
    expect(readFileSync(join(path, 'package.json'), 'utf8')).toBe(once);
    expect(readFileSync(join(path, '.env.example'), 'utf8')).toBe(env);
  });
  it.each(['3.1.0', '^3.9999.0', 'workspace:*'])(
    'preserves explicit dependency range %s',
    async (version) => {
      const path = project({
        dependencies: Object.fromEntries(sdk.map((name) => [name, version])),
      });
      const original = readFileSync(join(path, 'package.json'), 'utf8');
      await addAdapterCommand('r2');
      expect(readFileSync(join(path, 'package.json'), 'utf8')).toBe(original);
    }
  );
  it('preserves SDK packages declared outside production dependencies', async () => {
    const path = project({
      devDependencies: { [sdk[0]]: '3.1.0' },
      optionalDependencies: { [sdk[1]]: '3.2.0' },
    });
    const original = readFileSync(join(path, 'package.json'), 'utf8');
    await addAdapterCommand('r2');
    expect(readFileSync(join(path, 'package.json'), 'utf8')).toBe(original);
  });
  it('fills only missing R2 variables and retains user values, comments and exported assignments', async () => {
    const path = project();
    const existing =
      '# custom configuration\nexport R2_BUCKET = custom\nR2_ACCESS_KEY_ID=existing-key\nR2_SECRET_ACCESS_KEY=existing-secret\n';
    writeFileSync(join(path, '.env.example'), existing);
    await addAdapterCommand('r2');
    const env = readFileSync(join(path, '.env.example'), 'utf8');
    expect(env.startsWith(existing)).toBe(true);
    expect(env).toContain('R2_REGION=auto');
    expect(env).toContain(
      'R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com'
    );
    expect(env).toContain('R2_PUBLIC_BASE_URL=');
    expect(env).not.toContain('R2_BUCKET=your-bucket-name');
    expect(env).not.toContain('R2_ACCESS_KEY_ID=your-access-key');
    await addAdapterCommand('r2');
    expect(readFileSync(join(path, '.env.example'), 'utf8')).toBe(env);
  });
  it('reports a React Router config without overwriting it', async () => {
    const path = project();
    const config = join(path, 'app/lib/octoload/config.ts');
    mkdirSync(join(path, 'app/lib/octoload'), { recursive: true });
    writeFileSync(config, 'user config');
    await addAdapterCommand('r2');
    expect(readFileSync(config, 'utf8')).toBe('user config');
    expect(console.log).toHaveBeenCalledWith(
      `💡 Update your config at ${config} to use the r2 adapter`
    );
  });
  it('rejects unsupported adapters before changing files', async () => {
    const path = project();
    const original = readFileSync(join(path, 'package.json'), 'utf8');
    await expect(addAdapterCommand('invalid' as 's3')).rejects.toThrow(
      'Invalid adapter'
    );
    expect(readFileSync(join(path, 'package.json'), 'utf8')).toBe(original);
    expect(() => readFileSync(join(path, '.env.example'))).toThrow();
  });
});

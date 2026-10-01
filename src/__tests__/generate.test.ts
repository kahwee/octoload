import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateCommand } from '../commands/generate.js';

describe('schema generation', () => {
  const projects: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of projects) rmSync(dir, { recursive: true, force: true });
    projects.length = 0;
  });

  function project() {
    const dir = mkdtempSync(join(tmpdir(), 'octoload-generate-'));
    projects.push(dir);
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    return dir;
  }

  it.each([
    [undefined, 'upload-schema.ts'],
    ['postgresql', 'upload-schema.ts'],
    ['sqlite', 'upload-schema-sqlite.ts'],
  ] as const)(
    'embeds the exact source schema for %s',
    async (dialect, source) => {
      const root = process.cwd();
      const expected = readFileSync(
        join(root, 'src/templates', source),
        'utf8'
      );
      const dir = project();
      await generateCommand({ output: 'nested/schema.ts', dialect });
      expect(readFileSync(join(dir, 'nested/schema.ts'), 'utf8')).toBe(
        expected
      );
    }
  );

  it('rejects invalid dialects without overwriting existing data', async () => {
    const dir = project();
    await expect(
      generateCommand({
        output: 'schema.ts',
        dialect: 'mysql' as 'sqlite',
      })
    ).rejects.toThrow('Database dialect must be postgresql or sqlite');
    expect(() => readFileSync(join(dir, 'schema.ts'))).toThrow();
  });
});

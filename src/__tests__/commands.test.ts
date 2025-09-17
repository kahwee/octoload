import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateCommand } from '../commands/generate.js';

// Mock fs functions
vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Mock path functions
vi.mock('path', () => ({
  join: vi.fn((...args) => args.join('/')),
  dirname: vi.fn((path) => path.split('/').slice(0, -1).join('/')),
}));

describe('Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock process.cwd()
    vi.spyOn(process, 'cwd').mockReturnValue('/mock/project');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateCommand', () => {
    it('should generate schema file with default output path', async () => {
      const mockExistsSync = vi.mocked(existsSync);
      const mockMkdirSync = vi.mocked(mkdirSync);
      const mockWriteFileSync = vi.mocked(writeFileSync);

      mockExistsSync.mockReturnValue(true);

      await generateCommand({ output: 'src/db/upload-schema.ts' });

      expect(mockMkdirSync).toHaveBeenCalledWith('/mock/project/src/db', {
        recursive: true,
      });
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        '/mock/project/src/db/upload-schema.ts',
        expect.stringContaining('export const images = pgTable')
      );
    });

    it('should create output directory if it does not exist', async () => {
      const mockExistsSync = vi.mocked(existsSync);
      const mockMkdirSync = vi.mocked(mkdirSync);

      mockExistsSync.mockReturnValue(false);

      await generateCommand({ output: 'custom/path/schema.ts' });

      expect(mockMkdirSync).toHaveBeenCalledWith('/mock/project/custom/path', {
        recursive: true,
      });
    });

    it('should generate schema with all required tables', async () => {
      const mockWriteFileSync = vi.mocked(writeFileSync);

      await generateCommand({ output: 'schema.ts' });

      const generatedContent = mockWriteFileSync.mock.calls[0][1] as string;

      // Check for table definitions
      expect(generatedContent).toContain('export const images = pgTable');
      expect(generatedContent).toContain(
        'export const uploadSessions = pgTable'
      );
      expect(generatedContent).toContain(
        'export const assetVariants = pgTable'
      );
      expect(generatedContent).toContain('export const imageTags = pgTable');

      // Check for enums
      expect(generatedContent).toContain('export const imageStatusEnum');
      expect(generatedContent).toContain('export const assetVariantEnum');

      // Check for types
      expect(generatedContent).toContain('export type Image =');
      expect(generatedContent).toContain('export type NewImage =');
      expect(generatedContent).toContain('export type UploadSession =');
      expect(generatedContent).toContain('export type AssetVariant =');
    });

    it('should include proper imports', async () => {
      const mockWriteFileSync = vi.mocked(writeFileSync);

      await generateCommand({ output: 'schema.ts' });

      const generatedContent = mockWriteFileSync.mock.calls[0][1] as string;

      expect(generatedContent).toContain("from 'drizzle-orm/pg-core'");
      expect(generatedContent).toContain('function generateUUID()');
    });
  });

  describe('Schema Generation Content', () => {
    it('should generate images table with all required columns', async () => {
      const mockWriteFileSync = vi.mocked(writeFileSync);

      await generateCommand({ output: 'schema.ts' });

      const generatedContent = mockWriteFileSync.mock.calls[0][1] as string;

      // Check for image table columns
      expect(generatedContent).toContain('id: uuid');
      expect(generatedContent).toContain('ownerId: uuid');
      expect(generatedContent).toContain('filename: varchar');
      expect(generatedContent).toContain('contentType: varchar');
      expect(generatedContent).toContain('byteSize: integer');
      expect(generatedContent).toContain('status: imageStatusEnum');
      expect(generatedContent).toContain('storageKey: varchar');
      expect(generatedContent).toContain('publicUrl: text');
      expect(generatedContent).toContain('isPublic: boolean');
    });

    it('should generate proper foreign key relationships', async () => {
      const mockWriteFileSync = vi.mocked(writeFileSync);

      await generateCommand({ output: 'schema.ts' });

      const generatedContent = mockWriteFileSync.mock.calls[0][1] as string;

      // Check for foreign key references
      expect(generatedContent).toContain('references(() => images.id');
      expect(generatedContent).toContain("onDelete: 'cascade'");
    });
  });
});

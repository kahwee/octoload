import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

interface GenerateOptions {
  output: string;
}

export async function generateCommand(options: GenerateOptions) {
  console.log('📝 Generating Drizzle schemas...');

  const cwd = process.cwd();
  const outputPath = join(cwd, options.output);

  // Ensure output directory exists
  mkdirSync(dirname(outputPath), { recursive: true });

  const schemaContent = generateDrizzleSchema();
  writeFileSync(outputPath, schemaContent);

  console.log(`✅ Generated schema at: ${options.output}`);
  console.log('\\nNext step: Run npx octoload migrate to generate migrations');
}

function generateDrizzleSchema(): string {
  return `import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  pgEnum,
  text,
  boolean,
} from 'drizzle-orm/pg-core';
import { createId } from '@paralleldrive/cuid2';

// Enums
export const imageStatusEnum = pgEnum('image_status', [
  'processing',
  'ready',
  'failed'
]);

export const assetVariantEnum = pgEnum('asset_variant', [
  'original',
  'thumb',
  'webp',
  'avif',
  'small',
  'medium',
  'large'
]);

// Images table
export const images = pgTable('images', {
  id: uuid('id').primaryKey().$defaultFn(() => createId()),
  ownerId: uuid('owner_id'), // nullable for public uploads
  orgId: uuid('org_id'), // nullable for personal uploads
  filename: varchar('filename', { length: 255 }).notNull(),
  contentType: varchar('content_type', { length: 100 }).notNull(),
  byteSize: integer('byte_size').notNull(),
  status: imageStatusEnum('status').notNull().default('processing'),
  storageKey: varchar('storage_key', { length: 500 }).notNull(),
  publicUrl: text('public_url'), // nullable for private storage
  checksum: varchar('checksum', { length: 64 }), // SHA-256 hash
  alt: text('alt'), // accessibility text
  title: varchar('title', { length: 255 }),
  isPublic: boolean('is_public').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Upload sessions for multipart uploads
export const uploadSessions = pgTable('upload_sessions', {
  id: uuid('id').primaryKey().$defaultFn(() => createId()),
  imageId: uuid('image_id').references(() => images.id, { onDelete: 'cascade' }),
  uploadId: varchar('upload_id', { length: 255 }), // S3 multipart upload ID
  partCount: integer('part_count').notNull().default(1),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Asset variants for different sizes/formats
export const assetVariants = pgTable('asset_variants', {
  id: uuid('id').primaryKey().$defaultFn(() => createId()),
  imageId: uuid('image_id').notNull().references(() => images.id, { onDelete: 'cascade' }),
  variant: assetVariantEnum('variant').notNull(),
  width: integer('width'),
  height: integer('height'),
  byteSize: integer('byte_size').notNull(),
  storageKey: varchar('storage_key', { length: 500 }).notNull(),
  publicUrl: text('public_url'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Image tags for organization
export const imageTags = pgTable('image_tags', {
  id: uuid('id').primaryKey().$defaultFn(() => createId()),
  imageId: uuid('image_id').notNull().references(() => images.id, { onDelete: 'cascade' }),
  tag: varchar('tag', { length: 50 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Types
export type Image = typeof images.$inferSelect;
export type NewImage = typeof images.$inferInsert;
export type UploadSession = typeof uploadSessions.$inferSelect;
export type NewUploadSession = typeof uploadSessions.$inferInsert;
export type AssetVariant = typeof assetVariants.$inferSelect;
export type NewAssetVariant = typeof assetVariants.$inferInsert;
export type ImageTag = typeof imageTags.$inferSelect;
export type NewImageTag = typeof imageTags.$inferInsert;

// Export table names for migrations
export const tableNames = {
  images: 'images',
  uploadSessions: 'upload_sessions',
  assetVariants: 'asset_variants',
  imageTags: 'image_tags',
} as const;`;
}

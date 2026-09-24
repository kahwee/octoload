import { createHash } from 'node:crypto';
// Import proper Drizzle types and functions
import { and, eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { S3StorageAdapter } from '../storage/s3-adapter.js';
// Import the actual schema types from our template
import type { NewImage, UploadSchema } from '../templates/upload-schema.js';
import type {
  FinalizeRequest,
  ImageRecord,
  OctoloadConfigLike,
  PresignRequest,
  PresignResponse,
} from '../types/index.js';
import { generateServerUUID } from '../utils/uuid.js';

// Match PostgreSQL Drizzle instances without requiring a particular driver.
export type DrizzleDB = Pick<
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle's database generics vary by driver and schema.
  PgDatabase<any, any, any>,
  'insert' | 'select' | 'update' | 'delete'
>;

// Use the proper schema type from our template, but allow flexible structure for testing
export type DrizzleSchema =
  | UploadSchema
  | {
      images: unknown;
      uploadSessions: unknown;
      assetVariants: unknown;
      imageTags: unknown;
      [key: string]: unknown;
    };

/**
 * Core implementation of Octoload functionality.
 * Complete working implementation with R2/S3 storage and database operations.
 *
 * @template TDb - Your specific Drizzle database instance type
 * @template TSchema - Your specific schema type with upload tables
 */
export class OctoloadCore<
  TDb extends DrizzleDB = DrizzleDB,
  TSchema extends DrizzleSchema = DrizzleSchema,
> {
  private config: OctoloadConfigLike;
  private db: TDb;
  private schema: TSchema;
  private storage: S3StorageAdapter;

  constructor(config: OctoloadConfigLike, db: TDb, schema: TSchema) {
    this.config = config;
    this.db = db;
    this.schema = schema;

    // Initialize storage adapter based on config
    const storageConfig =
      'storage' in config
        ? config.storage
        : {
            adapter: config.adapter || 's3',
            bucket: config.bucket || '',
            region: config.region || 'us-east-1',
            endpoint: config.endpoint,
            credentials: config.credentials || {
              accessKeyId: '',
              secretAccessKey: '',
            },
          };

    this.storage = new S3StorageAdapter(storageConfig);
  }

  /**
   * Generate presigned URL for file upload with hash-based storage key
   */
  async presign(request: PresignRequest): Promise<PresignResponse> {
    if (!request.ownerId && !request.isPublic) {
      throw new Error('Authentication required');
    }
    // Include the record ID so uploads with identical metadata in the same
    // millisecond cannot overwrite one another in storage.
    const imageId = generateServerUUID();
    const fileExtension = request.filename.split('.').pop() || '';
    const hashInput = `${request.entityId || 'upload'}-${request.ownerId || 'anonymous'}-${request.filename}-${imageId}`;
    const fileHash = createHash('sha256')
      .update(hashInput)
      .digest('hex')
      .substring(0, 16);
    const storageKey =
      request.entityType && request.entityId
        ? `${request.entityType}/${request.entityId}/${fileHash}.${fileExtension}`
        : `uploads/${fileHash}.${fileExtension}`;

    // Create image record in database with 'processing' status
    const imageData: NewImage = {
      id: imageId,
      ownerId: request.ownerId || null,
      orgId: request.orgId || null,
      entityType: request.entityType || null,
      entityId: request.entityId || null,
      filename: request.filename,
      contentType: request.contentType,
      byteSize: request.byteSize,
      status: 'processing',
      storageKey: storageKey,
      alt: request.alt || null,
      title: request.title || null,
      isPublic: request.isPublic || false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Insert image record
    const insertResults = await this.db
      .insert(this.getImagesTable())
      .values(imageData)
      .returning();
    const _image = insertResults[0] as ImageRecord;

    // Generate presigned URL using storage adapter
    const uploadResult = await this.storage.getPresignedPutUrl(
      storageKey,
      request.contentType,
      3600 // 1 hour
    );

    return {
      storageKey: storageKey,
      uploadUrl: uploadResult.url,
      headers: uploadResult.fields || {
        'Content-Type': request.contentType,
      },
      expiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour from now
    };
  }

  /**
   * Finalize upload by updating image status to 'ready'
   */
  async finalize(
    request: FinalizeRequest,
    userId?: string
  ): Promise<ImageRecord> {
    // Find image by storage key
    const cols = this.getImageColumns();
    const results = await this.db
      .select()
      .from(this.getImagesTable())
      .where(this.eq(cols.storageKey, request.storageKey))
      .limit(1);
    const image = results[0] as ImageRecord;

    if (!image) {
      throw new Error('Image record not found for storage key');
    }

    if (image.ownerId && !userId) {
      throw new Error('Authentication required');
    }
    if (image.ownerId && image.ownerId !== userId) {
      throw new Error('Access denied');
    }

    // Verify upload exists in storage
    const exists = await this.storage.objectExists(request.storageKey);
    if (!exists) {
      throw new Error('Upload verification failed - file not found in storage');
    }

    // Update image status to 'ready'
    const updatedResults = await this.db
      .update(this.getImagesTable())
      .set({
        status: 'ready',
        checksum: request.checksum || null,
        publicUrl: this.getPublicUrl(request.storageKey),
        updatedAt: new Date(),
      })
      .where(this.eq(cols.id, image.id))
      .returning();
    const updatedImage = updatedResults[0] as ImageRecord;

    return updatedImage;
  }

  /**
   * Get image record with download URL
   */
  async getImage(
    imageId: string,
    userId?: string
  ): Promise<{
    image: ImageRecord;
    url: string;
  }> {
    // Find image by ID
    const cols = this.getImageColumns();
    const results = await this.db
      .select()
      .from(this.getImagesTable())
      .where(this.eq(cols.id, imageId))
      .limit(1);
    const image = results[0] as ImageRecord;

    if (!image) {
      throw new Error('Image not found');
    }

    // Public images are readable by anyone. Private images require their owner.
    if (!image.isPublic && !userId) {
      throw new Error('Authentication required');
    }
    if (!image.isPublic && image.ownerId !== userId) {
      throw new Error('Access denied');
    }

    // Generate download URL
    const url = image.isPublic
      ? this.getPublicUrl(image.storageKey)
      : await this.storage.getPrivateUrl(image.storageKey, 3600);

    return { image: image as ImageRecord, url };
  }

  /**
   * Delete image from storage and database
   */
  async deleteImage(imageId: string, userId?: string): Promise<void> {
    // Find image by ID
    const cols = this.getImageColumns();
    const results = await this.db
      .select()
      .from(this.getImagesTable())
      .where(this.eq(cols.id, imageId))
      .limit(1);
    const image = results[0] as ImageRecord;

    if (!image) {
      throw new Error('Image not found');
    }

    if (!userId) {
      throw new Error('Authentication required');
    }
    if (image.ownerId !== userId) {
      throw new Error('Access denied');
    }

    // Delete from storage
    await this.storage.deleteObject(image.storageKey);

    // Delete from database
    await this.db
      .delete(this.getImagesTable())
      .where(this.eq(cols.id, imageId));
  }

  /**
   * Get images for a specific entity
   */
  async getImagesForEntity(
    entityType: string,
    entityId: string,
    ownerId: string
  ): Promise<ImageRecord[]> {
    const cols = this.getImageColumns();
    const conditions = [
      this.eq(cols.entityType, entityType),
      this.eq(cols.entityId, entityId),
      this.eq(cols.status, 'ready'),
    ];

    if (!ownerId) {
      throw new Error('Authentication required');
    }
    conditions.push(this.eq(cols.ownerId, ownerId));

    const results = await this.db
      .select()
      .from(this.getImagesTable())
      .where(this.and(...conditions))
      .orderBy(cols.createdAt);
    return results as ImageRecord[];
  }

  /**
   * Get images for a user
   */
  async getImagesForUser(ownerId: string): Promise<ImageRecord[]> {
    const cols = this.getImageColumns();
    const results = await this.db
      .select()
      .from(this.getImagesTable())
      .where(
        this.and(this.eq(cols.ownerId, ownerId), this.eq(cols.status, 'ready'))
      )
      .orderBy(cols.createdAt);
    return results as ImageRecord[];
  }

  /**
   * Update image metadata
   */
  async updateImageMetadata(
    imageId: string,
    metadata: { alt?: string; title?: string },
    userId?: string
  ): Promise<ImageRecord> {
    // Find and verify ownership
    const cols = this.getImageColumns();
    const results = await this.db
      .select()
      .from(this.getImagesTable())
      .where(this.eq(cols.id, imageId))
      .limit(1);
    const image = results[0] as ImageRecord;

    if (!image) {
      throw new Error('Image not found');
    }

    if (!userId) {
      throw new Error('Authentication required');
    }
    if (image.ownerId !== userId) {
      throw new Error('Access denied');
    }

    // Update metadata
    const updateResults = await this.db
      .update(this.getImagesTable())
      .set({
        ...metadata,
        updatedAt: new Date(),
      })
      .where(this.eq(cols.id, imageId))
      .returning();
    const updatedImage = updateResults[0] as ImageRecord;

    return updatedImage;
  }

  /**
   * Helper method to get public URL for a storage key
   */
  private getPublicUrl(storageKey: string): string {
    const storageConfig =
      'storage' in this.config ? this.config.storage : this.config;

    // For R2, construct public URL
    if (storageConfig.adapter === 'r2') {
      // Extract account ID from endpoint if available
      const endpoint = storageConfig.endpoint || '';
      const match = endpoint.match(
        /https:\/\/([^.]+)\.r2\.cloudflarestorage\.com/
      );
      if (match) {
        const accountId = match[1];
        return `https://${storageConfig.bucket}.${accountId}.r2.cloudflarestorage.com/${storageKey}`;
      }
    }

    // Default S3 public URL format
    return `https://${storageConfig.bucket}.s3.${storageConfig.region}.amazonaws.com/${storageKey}`;
  }

  /**
   * Helper methods for Drizzle operations
   */
  private eq(column: unknown, value: unknown) {
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle's overloaded helper needs the runtime column type.
    return eq(column as any, value);
  }

  private and(...conditions: unknown[]) {
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle's overloaded helper needs the runtime conditions.
    return and(...(conditions as any[]));
  }

  /**
   * Get schema table with type assertion
   */
  private getImagesTable() {
    // biome-ignore lint/suspicious/noExplicitAny: The schema is supplied dynamically at runtime.
    return (this.schema as any).images;
  }

  /**
   * Get column references with type assertion
   */
  private getImageColumns() {
    const table = this.getImagesTable();
    return {
      id: table.id,
      ownerId: table.ownerId,
      storageKey: table.storageKey,
      status: table.status,
      entityType: table.entityType,
      entityId: table.entityId,
      createdAt: table.createdAt,
    };
  }
}

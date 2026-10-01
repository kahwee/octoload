import { createHash } from 'node:crypto';
import { z } from 'zod';
// Import proper Drizzle types and functions
import { and, eq, lt, or } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type { UploadSchema as SQLiteUploadSchema } from '../templates/upload-schema-sqlite.js';
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
import { finalizeRequestSchema, presignRequestSchema } from '../types/index.js';
import { generateServerUUID } from '../utils/uuid.js';

// Only the common, awaited query operations are used by the core.
type PostgresOperations = Pick<
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle's database generics vary by driver and schema.
  PgDatabase<any, any, any>,
  'insert' | 'select' | 'update' | 'delete'
>;
type SQLiteOperations = Pick<
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle drivers have different result and schema generics.
  BaseSQLiteDatabase<'sync' | 'async', any, any, any>,
  'insert' | 'select' | 'update' | 'delete'
>;
export type DrizzleDB = PostgresOperations | SQLiteOperations;

// Use the proper schema type from our template, but allow flexible structure for testing
export type DrizzleSchema =
  | UploadSchema
  | SQLiteUploadSchema
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
  private db: PostgresOperations;
  private schema: TSchema;
  private storage: S3StorageAdapter;
  private limits?: { maxFileSize?: number; allowedTypes?: string[] };

  constructor(config: OctoloadConfigLike, db: TDb, schema: TSchema) {
    // Both dialects implement this awaited query-builder subset. Their generic
    // overloads differ, so normalize once without changing the supplied instance.
    this.db = db as PostgresOperations;
    this.schema = schema;
    this.limits = config.limits;

    // Initialize storage adapter based on config
    const storageConfig =
      'storage' in config
        ? config.storage
        : {
            adapter: config.adapter || 's3',
            bucket: config.bucket || '',
            region: config.region || 'us-east-1',
            endpoint: config.endpoint,
            publicBaseUrl: config.publicBaseUrl,
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
    request = presignRequestSchema.parse(request);
    if (request.strategy === 'multipart') {
      throw new Error(
        'Multipart uploads are not supported by the core upload flow'
      );
    }
    if (!request.ownerId && !request.isPublic) {
      throw new Error('Authentication required');
    }
    if (
      this.limits?.maxFileSize !== undefined &&
      request.byteSize > this.limits.maxFileSize
    ) {
      throw new Error('File exceeds the configured size limit');
    }
    if (
      this.limits?.allowedTypes &&
      !this.limits.allowedTypes.includes(request.contentType)
    ) {
      throw new Error('File type is not allowed');
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
    if (request.isPublic) this.storage.getPublicUrl(storageKey);

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
    await this.db.insert(this.getImagesTable()).values(imageData).returning();

    // Generate presigned URL using storage adapter
    const uploadResult = await this.storage.getPresignedPutUrl(
      storageKey,
      request.contentType,
      3600, // 1 hour
      request.byteSize
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
    request = finalizeRequestSchema.parse(request);
    if (request.parts !== undefined) {
      throw new Error(
        'Multipart uploads are not supported by the core upload flow'
      );
    }
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
    if (image.status !== 'processing') {
      throw new Error('Upload is no longer processing');
    }

    // HeadObject checks the stored metadata without downloading the file.
    let object: Awaited<ReturnType<S3StorageAdapter['headObject']>>;
    try {
      object = await this.storage.headObject(request.storageKey);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        (('name' in error &&
          (error.name === 'NotFound' || error.name === 'NoSuchKey')) ||
          ('$metadata' in error &&
            error.$metadata &&
            typeof error.$metadata === 'object' &&
            'httpStatusCode' in error.$metadata &&
            error.$metadata.httpStatusCode === 404))
      ) {
        throw new Error(
          'Upload verification failed - file not found in storage'
        );
      }
      throw error;
    }
    if (object.ContentLength !== image.byteSize) {
      throw new Error('Upload verification failed - file size does not match');
    }
    if (object.ContentType?.toLowerCase() !== image.contentType.toLowerCase()) {
      throw new Error(
        'Upload verification failed - content type does not match'
      );
    }

    // Update image status to 'ready'
    const updatedResults = await this.db
      .update(this.getImagesTable())
      .set({
        status: 'ready',
        checksum: request.checksum || null,
        publicUrl: image.isPublic
          ? this.storage.getPublicUrl(request.storageKey)
          : null,
        updatedAt: new Date(),
      })
      .where(
        this.and(this.eq(cols.id, image.id), this.eq(cols.status, 'processing'))
      )
      .returning();
    const updatedImage = updatedResults[0] as ImageRecord;

    if (!updatedImage) {
      throw new Error('Upload is no longer processing');
    }

    return updatedImage;
  }

  /** Remove expired single-PUT uploads from S3 or R2 and their database rows. */
  async cleanupAbandonedUploads(
    options: { olderThanMs?: number; limit?: number } = {}
  ): Promise<{
    scanned: number;
    cleaned: number;
    skipped: number;
    errors: { imageId: string; message: string }[];
  }> {
    const olderThanMs = options.olderThanMs ?? 2 * 60 * 60 * 1000;
    const limit = options.limit ?? 100;
    if (!Number.isFinite(olderThanMs) || olderThanMs < 60 * 60 * 1000) {
      throw new Error('olderThanMs must be at least one hour');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error('limit must be an integer between 1 and 1000');
    }

    const cols = this.getImageColumns();
    const cutoff = new Date(Date.now() - olderThanMs);
    const candidates = (await this.db
      .select()
      .from(this.getImagesTable())
      .where(
        this.and(
          lt(cols.createdAt, cutoff),
          or(this.eq(cols.status, 'processing'), this.eq(cols.status, 'failed'))
        )
      )
      .orderBy(cols.createdAt)
      .limit(limit)) as ImageRecord[];

    const result = {
      scanned: candidates.length,
      cleaned: 0,
      skipped: 0,
      errors: [] as { imageId: string; message: string }[],
    };

    for (const image of candidates) {
      try {
        if (image.status === 'processing') {
          // Finalize and cleanup race on this status. Only one may claim it.
          const claimed = await this.db
            .update(this.getImagesTable())
            .set({ status: 'failed', updatedAt: new Date() })
            .where(
              this.and(
                this.eq(cols.id, image.id),
                this.eq(cols.status, 'processing'),
                lt(cols.createdAt, cutoff)
              )
            )
            .returning();
          if (claimed.length === 0) {
            result.skipped++;
            continue;
          }
        }

        // DeleteObject is safe to retry if the object was never uploaded.
        await this.storage.deleteObject(image.storageKey);
        await this.db
          .delete(this.getImagesTable())
          .where(
            this.and(this.eq(cols.id, image.id), this.eq(cols.status, 'failed'))
          );
        result.cleaned++;
      } catch (error) {
        result.errors.push({
          imageId: image.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
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

    // Unverified or failed uploads must never receive a download URL.
    if (image.status !== 'ready') {
      throw new Error('Image not found');
    }

    // Generate download URL
    const url = image.isPublic
      ? this.storage.getPublicUrl(image.storageKey)
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

    // TypeScript annotations do not constrain JavaScript or request bodies.
    const safeMetadata = z
      .object({
        alt: z.string().max(500).optional(),
        title: z.string().max(255).optional(),
      })
      .strict()
      .parse(metadata);

    // Update only the validated metadata fields.
    const updateResults = await this.db
      .update(this.getImagesTable())
      .set({
        ...safeMetadata,
        updatedAt: new Date(),
      })
      .where(this.eq(cols.id, imageId))
      .returning();
    const updatedImage = updateResults[0] as ImageRecord;

    return updatedImage;
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

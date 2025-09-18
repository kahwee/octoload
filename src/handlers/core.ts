import type {
  FinalizeRequest,
  ImageRecord,
  OctoloadConfigLike,
  PresignRequest,
  PresignResponse,
} from '../types/index.js';

// Use proper Drizzle types for better type safety

// Use a permissive type for tests and user implementations
// Specific projects can narrow this when integrating.
// Use a permissive unknown-based type instead of `any` to satisfy lint rules
export type DrizzleDB = Record<string, unknown> | unknown;

export interface DrizzleSchema {
  [key: string]: unknown;
}

/**
 * Core implementation of Octoload functionality.
 * This is a stub implementation that provides proper TypeScript types
 * but throws errors when used. Users should use the generated route
 * handlers from `npx octoload init` for actual functionality.
 */
export class OctoloadCore {
  private config: OctoloadConfigLike;
  private db: DrizzleDB;
  private schema: DrizzleSchema;

  constructor(
    config: OctoloadConfigLike,
    db: DrizzleDB,
    schema: DrizzleSchema
  ) {
    this.config = config;
    this.db = db;
    this.schema = schema;
  }

  async presign(_request: PresignRequest): Promise<PresignResponse> {
    throw new Error(
      'OctoloadCore.presign() is not implemented. This is a stub implementation. ' +
        'Please use the generated route handlers from `npx octoload init` instead.'
    );
  }

  async finalize(_request: FinalizeRequest): Promise<ImageRecord> {
    throw new Error(
      'OctoloadCore.finalize() is not implemented. This is a stub implementation. ' +
        'Please use the generated route handlers from `npx octoload init` instead.'
    );
  }

  async getImage(
    _imageId: string,
    _userId?: string
  ): Promise<{
    image: ImageRecord;
    url: string;
  }> {
    throw new Error(
      'OctoloadCore.getImage() is not implemented. This is a stub implementation. ' +
        'Please use the generated route handlers from `npx octoload init` instead.'
    );
  }

  async deleteImage(_imageId: string, _userId?: string): Promise<void> {
    throw new Error(
      'OctoloadCore.deleteImage() is not implemented. This is a stub implementation. ' +
        'Please use the generated route handlers from `npx octoload init` instead.'
    );
  }
}

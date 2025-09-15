import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type {
  FinalizeRequest,
  ImageRecord,
  OctoloadConfig,
  PresignRequest,
  PresignResponse,
} from '../types/index.js';

// Use proper Drizzle types for better type safety
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DrizzleDB = PgDatabase<any> | NodePgDatabase<any>;

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
  private config: OctoloadConfig;
  private db: DrizzleDB;
  private schema: DrizzleSchema;

  constructor(config: OctoloadConfig, db: DrizzleDB, schema: DrizzleSchema) {
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

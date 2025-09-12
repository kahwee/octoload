import type {
  FinalizeRequest,
  ImageRecord,
  OctoloadConfig,
  PresignRequest,
  PresignResponse,
} from '../types/index.js';
import type { DrizzleDB, DrizzleSchema } from './core.js';

/**
 * Stub implementation of OctoloadCore for type checking and development.
 * This provides proper TypeScript interfaces but throws errors when used.
 * Users need to implement the actual database operations in their integration.
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

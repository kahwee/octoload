import type { StorageAdapter } from '../types/index.js';
import { S3StorageAdapter } from './s3-adapter.js';

export function createStorageAdapter(config: StorageAdapter): S3StorageAdapter {
  switch (config.adapter) {
    case 's3':
    case 'r2':
      return new S3StorageAdapter(config);
    default:
      throw new Error(`Unsupported storage adapter: ${config.adapter}`);
  }
}

export { S3StorageAdapter };

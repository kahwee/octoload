import { z } from 'zod';

// Configuration types
export interface StorageAdapter {
  adapter: 's3' | 'r2';
  bucket: string;
  region: string;
  endpoint?: string; // For R2
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  };
}

export interface OctoloadLimits {
  maxFileSize: number;
  allowedTypes: string[];
  maxVariants: number;
}

export interface OctoloadHooks {
  beforePresign?: (context: PresignContext) => Promise<PresignContext>;
  afterFinalize?: (image: ImageRecord) => Promise<void>;
  onDelete?: (image: ImageRecord) => Promise<void>;
  onProcessVariant?: (variant: VariantRecord) => Promise<void>;
}

export interface OctoloadConfig {
  storage: StorageAdapter;
  limits: OctoloadLimits;
  hooks?: OctoloadHooks;
  db?: {
    schema?: string;
    tablePrefix?: string;
  };
}

// Request/Response types
export interface PresignRequest {
  filename: string;
  contentType: string;
  byteSize: number;
  strategy?: 'single' | 'multipart';
  ownerId?: string;
  orgId?: string;
  isPublic?: boolean;
  alt?: string;
  title?: string;
  tags?: string[];
}

export interface PresignResponse {
  storageKey: string;
  uploadUrl?: string;
  multipart?: {
    uploadId: string;
    parts: { partNumber: number; uploadUrl: string }[];
  };
  headers?: Record<string, string>;
  fields?: Record<string, string>;
  expiresAt: Date;
}

export interface FinalizeRequest {
  storageKey: string;
  checksum?: string;
  parts?: { partNumber: number; etag: string }[];
}

export interface PresignContext extends PresignRequest {
  user?: { id: string; [key: string]: unknown }; // Framework-specific user object
}

// Database record types
export interface ImageRecord {
  id: string;
  ownerId?: string;
  orgId?: string;
  filename: string;
  contentType: string;
  byteSize: number;
  status: 'processing' | 'ready' | 'failed';
  storageKey: string;
  publicUrl?: string;
  checksum?: string;
  alt?: string;
  title?: string;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UploadSessionRecord {
  id: string;
  imageId: string;
  uploadId?: string;
  partCount: number;
  expiresAt: Date;
  createdAt: Date;
}

export interface VariantRecord {
  id: string;
  imageId: string;
  variant:
    | 'original'
    | 'thumb'
    | 'webp'
    | 'avif'
    | 'small'
    | 'medium'
    | 'large';
  width?: number;
  height?: number;
  byteSize: number;
  storageKey: string;
  publicUrl?: string;
  createdAt: Date;
}

// Validation schemas
export const presignRequestSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z
    .string()
    .regex(/^image\/[a-z0-9+\-.]+$/i, 'Invalid content type'),
  byteSize: z.number().min(1),
  strategy: z.enum(['single', 'multipart']).default('single'),
  ownerId: z.string().uuid().optional(),
  orgId: z.string().uuid().optional(),
  isPublic: z.boolean().default(false),
  alt: z.string().max(500).optional(),
  title: z.string().max(255).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
});

export const finalizeRequestSchema = z.object({
  storageKey: z.string().min(1),
  checksum: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(), // SHA-256
  parts: z
    .array(
      z.object({
        partNumber: z.number().min(1),
        etag: z.string(),
      })
    )
    .optional(),
});

// Re-export AWS SDK types for storage operations
export type {
  S3ClientConfig,
  HeadObjectCommandOutput,
  CompleteMultipartUploadCommandOutput,
} from '@aws-sdk/client-s3';

// Framework handler types - simplified for compatibility
export type FrameworkRequest = Request;
export type FrameworkResponse = Response;

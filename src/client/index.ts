import { z } from 'zod';
import type {
  FinalizeRequest,
  ImageRecord,
  PresignRequest,
  PresignResponse,
} from '../types/index.js';

export interface OctoloadClientConfig {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

export interface UploadOptions extends Omit<
  PresignRequest,
  'filename' | 'contentType' | 'byteSize'
> {
  onProgress?: (progress: ProgressInfo) => void;
  onStateChange?: (
    state: 'presigning' | 'uploading' | 'finalizing' | 'completed' | 'error'
  ) => void;
}

export interface UploadResult {
  image: ImageRecord;
  url?: string;
}

// Custom error types for better error handling
export class OctoloadError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'OctoloadError';
  }
}

export class ValidationError extends OctoloadError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class NetworkError extends OctoloadError {
  constructor(message: string, statusCode?: number, details?: unknown) {
    super(message, 'NETWORK_ERROR', statusCode, details);
    this.name = 'NetworkError';
  }
}

export class UploadError extends OctoloadError {
  constructor(message: string, details?: unknown) {
    super(message, 'UPLOAD_ERROR', 500, details);
    this.name = 'UploadError';
  }
}

// Zod schemas for API response validation
// More permissive schema for backward compatibility with existing tests
const ImageRecordSchema = z
  .object({
    id: z.string(),
    ownerId: z.string().optional(),
    orgId: z.string().optional(),
    entityType: z.string().optional(),
    entityId: z.string().optional(),
    filename: z.string().optional(),
    contentType: z.string().optional(),
    byteSize: z.number().optional(),
    status: z.enum(['processing', 'ready', 'failed']).optional(),
    storageKey: z.string().optional(),
    publicUrl: z.string().optional(),
    checksum: z.string().optional(),
    alt: z.string().optional(),
    title: z.string().optional(),
    isPublic: z.boolean().optional(),
    createdAt: z.coerce.date().optional(),
    updatedAt: z.coerce.date().optional(),
  })
  .passthrough(); // Allow additional fields

const PresignResponseSchema = z.object({
  storageKey: z.string(),
  uploadUrl: z.string().optional(),
  multipart: z
    .object({
      uploadId: z.string(),
      parts: z.array(
        z.object({
          partNumber: z.number(),
          uploadUrl: z.string(),
        })
      ),
    })
    .optional(),
  headers: z.record(z.string(), z.string()).optional(),
  fields: z.record(z.string(), z.string()).optional(),
  expiresAt: z.coerce.date(),
});

const GetImageResponseSchema = z.object({
  image: ImageRecordSchema,
  url: z.string().optional(),
});

const ErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  details: z.unknown().optional(),
});

interface ProgressInfo {
  loaded: number;
  total: number;
  percentage: number;
  fileIndex?: number;
  totalFiles?: number;
}

export class OctoloadClient {
  private config: OctoloadClientConfig;

  constructor(config: OctoloadClientConfig) {
    this.config = config;
  }

  async uploadFile(
    file: File,
    options: UploadOptions = {}
  ): Promise<UploadResult> {
    const { onProgress, onStateChange, ...presignOptions } = options;

    try {
      onStateChange?.('presigning');

      // Step 1: Get presigned URL
      const presignRequest: PresignRequest = {
        filename: file.name,
        contentType: file.type,
        byteSize: file.size,
        ...presignOptions,
      };

      const presignResponse = await this.presign(presignRequest);

      onStateChange?.('uploading');

      // Step 2: Upload file
      let completedParts: { partNumber: number; etag: string }[] | undefined;
      if (presignResponse.multipart) {
        const result = await this.uploadMultipart(
          file,
          presignResponse,
          onProgress
        );
        completedParts = result.completedParts;
      } else {
        await this.uploadSingle(file, presignResponse, onProgress);
      }

      onStateChange?.('finalizing');

      // Step 3: Finalize upload
      const finalizeRequest: FinalizeRequest = {
        storageKey: presignResponse.storageKey,
        checksum: await this.calculateChecksum(file),
        ...(completedParts && { parts: completedParts }),
      };

      const image = await this.finalize(finalizeRequest);

      onStateChange?.('completed');

      return { image };
    } catch (error) {
      onStateChange?.('error');
      throw error;
    }
  }

  async uploadMultiple(
    files: File[],
    options: UploadOptions = {}
  ): Promise<UploadResult[]> {
    // Upload files in parallel with concurrency limit
    const concurrency = 3;
    const results: UploadResult[] = [];

    for (let i = 0; i < files.length; i += concurrency) {
      const batch = files.slice(i, i + concurrency);
      const batchPromises = batch.map((file, index) =>
        this.uploadFile(file, {
          ...options,
          onProgress: options.onProgress
            ? (progress) => {
                const extendedProgress: ProgressInfo = {
                  ...progress,
                  fileIndex: i + index,
                  totalFiles: files.length,
                };
                options.onProgress!(extendedProgress);
              }
            : undefined,
        })
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  async getImage(
    imageId: string
  ): Promise<{ image: ImageRecord; url: string }> {
    const response = await this.fetch(`/api/images/${imageId}`, {
      method: 'GET',
    });

    if (!response.ok) {
      throw await this.handleErrorResponse(response, 'Failed to get image');
    }

    const result = await response.json();
    try {
      const parsed = GetImageResponseSchema.parse(result);
      return parsed as { image: ImageRecord; url: string };
    } catch (error) {
      throw new ValidationError('Invalid image response format', error);
    }
  }

  async deleteImage(imageId: string): Promise<void> {
    const response = await this.fetch(`/api/images/${imageId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw await this.handleErrorResponse(response, 'Failed to delete image');
    }
  }

  private async presign(request: PresignRequest): Promise<PresignResponse> {
    const response = await this.fetch('/api/uploads/presign', {
      method: 'POST',
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw await this.handleErrorResponse(response, 'Presign failed');
    }

    const result = await response.json();
    try {
      return PresignResponseSchema.parse(result) as PresignResponse;
    } catch (error) {
      throw new ValidationError('Invalid presign response format', error);
    }
  }

  private async finalize(request: FinalizeRequest): Promise<ImageRecord> {
    const response = await this.fetch('/api/uploads/finalize', {
      method: 'POST',
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw await this.handleErrorResponse(response, 'Finalize failed');
    }

    const result = await response.json();
    try {
      const parsed = ImageRecordSchema.parse(result);
      return parsed as ImageRecord;
    } catch (error) {
      throw new ValidationError('Invalid finalize response format', error);
    }
  }

  private async uploadSingle(
    file: File,
    presignResponse: PresignResponse,
    onProgress?: (progress: ProgressInfo) => void
  ): Promise<void> {
    if (!presignResponse.uploadUrl) {
      throw new ValidationError('No upload URL provided for single upload');
    }

    if (typeof XMLHttpRequest === 'undefined') {
      throw new UploadError(
        'XMLHttpRequest not available in this environment. Use Node.js polyfill for server-side uploads.'
      );
    }

    const xhr = new XMLHttpRequest();

    return new Promise((resolve, reject) => {
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && onProgress) {
          onProgress({
            loaded: event.loaded,
            total: event.total,
            percentage: Math.round((event.loaded / event.total) * 100),
          });
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(
            new UploadError(`Single upload failed: ${xhr.statusText}`, {
              status: xhr.status,
            })
          );
        }
      });

      xhr.addEventListener('error', () => {
        reject(new NetworkError('Network error during upload'));
      });

      if (!presignResponse.uploadUrl) {
        reject(
          new ValidationError('No upload URL provided in presign response')
        );
        return;
      }

      xhr.open('PUT', presignResponse.uploadUrl);

      // Set headers if provided
      if (presignResponse.headers) {
        Object.entries(presignResponse.headers).forEach(([key, value]) => {
          if (typeof value === 'string') {
            xhr.setRequestHeader(key, value);
          }
        });
      }

      xhr.send(file);
    });
  }

  private async uploadMultipart(
    file: File,
    presignResponse: PresignResponse,
    onProgress?: (progress: ProgressInfo) => void
  ): Promise<{ completedParts: { partNumber: number; etag: string }[] }> {
    if (!presignResponse.multipart) {
      throw new ValidationError('No multipart upload configuration provided');
    }

    const { parts } = presignResponse.multipart;
    const chunkSize = Math.ceil(file.size / parts.length);
    const completedParts: { partNumber: number; etag: string }[] = [];
    let totalUploaded = 0;

    // Upload each part
    for (const part of parts) {
      const start = (part.partNumber - 1) * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);

      const response = await fetch(part.uploadUrl, {
        method: 'PUT',
        body: chunk,
      });

      if (!response.ok) {
        throw new UploadError(`Part ${part.partNumber} upload failed`, {
          partNumber: part.partNumber,
          status: response.status,
          statusText: response.statusText,
        });
      }

      const etag = response.headers.get('ETag');
      if (!etag) {
        throw new UploadError(`No ETag returned for part ${part.partNumber}`, {
          partNumber: part.partNumber,
        });
      }

      completedParts.push({
        partNumber: part.partNumber,
        etag: etag.replace(/"/g, ''),
      });

      totalUploaded += chunk.size;

      if (onProgress) {
        onProgress({
          loaded: totalUploaded,
          total: file.size,
          percentage: Math.round((totalUploaded / file.size) * 100),
        });
      }
    }

    // Return completed parts for finalize step instead of mutating response
    return { completedParts };
  }

  private async calculateChecksum(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  private async handleErrorResponse(
    response: Response,
    defaultMessage: string
  ): Promise<never> {
    let errorData: unknown;
    try {
      errorData = await response.json();
    } catch {
      // Response doesn't contain JSON
      throw new NetworkError(
        `${defaultMessage}: ${response.statusText}`,
        response.status
      );
    }

    // Try to parse structured error response
    try {
      const parsed = ErrorResponseSchema.parse(errorData);
      throw new OctoloadError(
        parsed.error,
        parsed.code || 'UNKNOWN_ERROR',
        response.status,
        parsed.details
      );
    } catch {
      // Fallback to generic error
      throw new NetworkError(
        `${defaultMessage}: ${response.statusText}`,
        response.status,
        errorData
      );
    }
  }

  private async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const url = `${this.config.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
      ...(init.headers as Record<string, string>),
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    try {
      return await fetch(url, {
        ...init,
        headers,
      });
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new NetworkError('Network request failed', undefined, error);
      }
      throw error;
    }
  }
}

// Utility functions for React/frameworks
export function createUploadClient(
  config: OctoloadClientConfig
): OctoloadClient {
  return new OctoloadClient(config);
}

// File validation utilities
export function validateFile(
  file: File,
  options: {
    maxSize?: number;
    allowedTypes?: string[];
  } = {}
): string | null {
  const { maxSize = 10 * 1024 * 1024, allowedTypes = ['image/*'] } = options;

  if (file.size > maxSize) {
    return `File size ${Math.round(file.size / 1024 / 1024)}MB exceeds limit of ${Math.round(maxSize / 1024 / 1024)}MB`;
  }

  const isTypeAllowed = allowedTypes.some((type) => {
    if (type.endsWith('/*')) {
      return file.type.startsWith(type.replace('/*', '/'));
    }
    return file.type === type;
  });

  if (!isTypeAllowed) {
    return `File type ${file.type} is not allowed`;
  }

  return null; // Valid
}

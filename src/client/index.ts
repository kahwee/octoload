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

export interface UploadOptions
  extends Omit<PresignRequest, 'filename' | 'contentType' | 'byteSize'> {
  onProgress?: (progress: {
    loaded: number;
    total: number;
    percentage: number;
  }) => void;
  onStateChange?: (
    state: 'presigning' | 'uploading' | 'finalizing' | 'completed' | 'error'
  ) => void;
}

export interface UploadResult {
  image: ImageRecord;
  url?: string;
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
      if (presignResponse.multipart) {
        await this.uploadMultipart(file, presignResponse, onProgress);
      } else {
        await this.uploadSingle(file, presignResponse, onProgress);
      }

      onStateChange?.('finalizing');

      // Step 3: Finalize upload
      const finalizeRequest: FinalizeRequest = {
        storageKey: presignResponse.storageKey,
        checksum: await this.calculateChecksum(file),
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
                const extendedProgress = progress as typeof progress & {
                  fileIndex: number;
                  totalFiles: number;
                };
                extendedProgress.fileIndex = i + index;
                extendedProgress.totalFiles = files.length;
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
      throw new Error(`Failed to get image: ${response.statusText}`);
    }

    const result = await response.json();
    return result as { image: ImageRecord; url: string };
  }

  async deleteImage(imageId: string): Promise<void> {
    const response = await this.fetch(`/api/images/${imageId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`Failed to delete image: ${response.statusText}`);
    }
  }

  private async presign(request: PresignRequest): Promise<PresignResponse> {
    const response = await this.fetch('/api/uploads/presign', {
      method: 'POST',
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`Presign failed: ${response.statusText}`);
    }

    const result = await response.json();
    return result as PresignResponse;
  }

  private async finalize(request: FinalizeRequest): Promise<ImageRecord> {
    const response = await this.fetch('/api/uploads/finalize', {
      method: 'POST',
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`Finalize failed: ${response.statusText}`);
    }

    const result = await response.json();
    return result as ImageRecord;
  }

  private async uploadSingle(
    file: File,
    presignResponse: PresignResponse,
    onProgress?: (progress: {
      loaded: number;
      total: number;
      percentage: number;
    }) => void
  ): Promise<void> {
    if (!presignResponse.uploadUrl) {
      throw new Error('No upload URL provided');
    }

    if (typeof XMLHttpRequest === 'undefined') {
      throw new Error('XMLHttpRequest not available in this environment');
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
          reject(new Error(`Upload failed: ${xhr.statusText}`));
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Upload failed'));
      });

      if (!presignResponse.uploadUrl) {
        reject(new Error('No upload URL provided'));
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
    onProgress?: (progress: {
      loaded: number;
      total: number;
      percentage: number;
    }) => void
  ): Promise<void> {
    if (!presignResponse.multipart) {
      throw new Error('No multipart upload configuration provided');
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
        throw new Error(`Part ${part.partNumber} upload failed`);
      }

      const etag = response.headers.get('ETag');
      if (!etag) {
        throw new Error(`No ETag returned for part ${part.partNumber}`);
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

    // Store completed parts for finalize step
    (
      presignResponse as PresignResponse & {
        completedParts: typeof completedParts;
      }
    ).completedParts = completedParts;
  }

  private async calculateChecksum(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
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

    return fetch(url, {
      ...init,
      headers,
    });
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

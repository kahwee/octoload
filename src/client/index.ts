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
  /** API request timeout; defaults to 30 seconds. */
  requestTimeoutMs?: number;
  /** Single PUT timeout; defaults to 120 seconds. */
  uploadTimeoutMs?: number;
}

export interface UploadOptions
  extends Omit<PresignRequest, 'filename' | 'contentType' | 'byteSize'> {
  onProgress?: (progress: ProgressInfo) => void;
  onEvent?: (event: UploadEvent) => void | Promise<void>;
  onError?: (error: UploadFailure) => void | Promise<void>;
  signal?: AbortSignal;
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

export type UploadPhase = 'presign' | 'put' | 'checksum' | 'finalize';
export type UploadRetry =
  | 'never'
  | 'restart-upload'
  | 'retry-finalize'
  | 'reconcile';

/** Safe metadata only: no filenames, storage keys, URLs, or exception causes. */
export interface UploadEvent {
  type: 'phase.started' | 'phase.succeeded' | 'phase.failed';
  uploadId: string;
  attempt: number;
  phase: UploadPhase;
  durationMs: number;
  code?: string;
  status?: number;
  requestId?: string;
  retry?: UploadRetry;
}

export class UploadFailure extends OctoloadError {
  readonly status?: number;
  constructor(
    message: string,
    code: string,
    public readonly uploadId: string,
    public readonly phase: UploadPhase,
    public readonly retry: UploadRetry,
    status?: number,
    public readonly requestId?: string,
    cause?: unknown
  ) {
    super(message, code, status);
    this.name = 'UploadFailure';
    this.status = status;
    // Retain debugging context without including it in JSON telemetry.
    Object.defineProperty(this, 'cause', { value: cause, enumerable: false });
  }
}

function notify<T>(hook: ((value: T) => unknown) | undefined, value: T): void {
  try {
    void Promise.resolve(hook?.(value)).catch(() => {});
  } catch {
    // Observers must never change the upload outcome.
  }
}

interface UploadAttempt {
  uploadId: string;
  attempt: number;
  file: File;
  presign?: PresignResponse;
  checksum?: string;
  parts?: { partNumber: number; etag: string }[];
  requestId?: string;
}

// Zod schemas for API response validation
// More permissive schema for backward compatibility with existing tests
const ImageRecordSchema = z
  .object({
    id: z.string(),
    ownerId: z.string().nullish(),
    orgId: z.string().nullish(),
    entityType: z.string().nullish(),
    entityId: z.string().nullish(),
    filename: z.string().optional(),
    contentType: z.string().optional(),
    byteSize: z.number().optional(),
    status: z.enum(['processing', 'ready', 'failed']).optional(),
    storageKey: z.string().optional(),
    publicUrl: z.string().nullish(),
    checksum: z.string().nullish(),
    alt: z.string().nullish(),
    title: z.string().nullish(),
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
  private recoveries = new WeakMap<UploadFailure, UploadAttempt>();

  constructor(config: OctoloadClientConfig) {
    for (const value of [config.requestTimeoutMs, config.uploadTimeoutMs]) {
      if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
        throw new ValidationError(
          'Timeouts must be positive finite milliseconds'
        );
      }
    }
    this.config = config;
  }

  async uploadFile(
    file: File,
    options: UploadOptions = {}
  ): Promise<UploadResult> {
    const attempt: UploadAttempt = {
      uploadId:
        globalThis.crypto?.randomUUID?.() ??
        `upload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      attempt: 1,
      file,
    };
    const {
      onProgress,
      onStateChange,
      onEvent,
      onError,
      signal,
      ...presignOptions
    } = options;
    notify(onStateChange, 'presigning');
    attempt.presign = await this.phase(attempt, 'presign', options, () =>
      this.presign(
        {
          filename: file.name,
          contentType: file.type,
          byteSize: file.size,
          ...presignOptions,
        },
        attempt,
        signal
      )
    );
    notify(onStateChange, 'uploading');
    await this.phase(attempt, 'put', options, async () => {
      if (attempt.presign!.multipart) {
        const result = await this.uploadMultipart(
          file,
          attempt.presign!,
          (progress) => notify(onProgress, progress),
          signal
        );
        attempt.parts = result.completedParts;
      } else {
        await this.uploadSingle(
          file,
          attempt.presign!,
          (progress) => notify(onProgress, progress),
          signal
        );
      }
    });
    return this.finish(attempt, options, false);
  }

  /** Reconcile a failed single PUT/finalize without replaying PUT. Same client instance required. */
  async recoverUpload(
    error: UploadFailure,
    options: UploadOptions = {}
  ): Promise<UploadResult> {
    const previous = this.recoveries.get(error);
    if (
      !previous ||
      error.retry === 'never' ||
      error.retry === 'restart-upload'
    ) {
      throw new ValidationError(
        'This failure cannot be recovered; start a new upload'
      );
    }
    return this.finish(
      { ...previous, attempt: previous.attempt + 1 },
      options,
      true
    );
  }

  private async finish(
    attempt: UploadAttempt,
    options: UploadOptions,
    reconcile: boolean
  ): Promise<UploadResult> {
    notify(options.onStateChange, 'finalizing');
    if (!attempt.checksum) {
      attempt.checksum = await this.phase(attempt, 'checksum', options, () =>
        this.calculateChecksum(attempt.file)
      );
    }
    const image = await this.phase(attempt, 'finalize', options, () =>
      this.finalize(
        {
          storageKey: attempt.presign!.storageKey,
          checksum: attempt.checksum,
          ...(attempt.parts && { parts: attempt.parts }),
          ...(reconcile && { reconcile: true }),
        },
        attempt,
        options.signal
      )
    );
    notify(options.onStateChange, 'completed');
    return { image };
  }

  private async phase<T>(
    attempt: UploadAttempt,
    phase: UploadPhase,
    options: UploadOptions,
    run: () => Promise<T>
  ): Promise<T> {
    const started = performance.now();
    attempt.requestId = undefined;
    const event = {
      uploadId: attempt.uploadId,
      attempt: attempt.attempt,
      phase,
    };
    notify(options.onEvent, { ...event, type: 'phase.started', durationMs: 0 });
    try {
      options.signal?.throwIfAborted();
      const result = await run();
      options.signal?.throwIfAborted();
      notify(options.onEvent, {
        ...event,
        type: 'phase.succeeded',
        durationMs: performance.now() - started,
        requestId: attempt.requestId,
      });
      return result;
    } catch (cause) {
      const source = cause instanceof OctoloadError ? cause : undefined;
      const status = source?.statusCode;
      const aborted =
        options.signal?.aborted ||
        (cause instanceof Error && cause.name === 'AbortError') ||
        source?.code === 'UPLOAD_ABORTED';
      const code = aborted
        ? 'UPLOAD_ABORTED'
        : (source?.code ??
          (phase === 'checksum' ? 'CHECKSUM_FAILED' : 'NETWORK_ERROR'));
      let retry: UploadRetry = 'never';
      if (
        !aborted &&
        phase === 'presign' &&
        (!status || status >= 500 || status === 429)
      )
        retry = 'restart-upload';
      if (
        !aborted &&
        phase === 'put' &&
        (!status || status >= 500 || status === 412)
      )
        retry = 'reconcile';
      if (
        !aborted &&
        phase === 'finalize' &&
        (!status || status >= 500 || status === 429 || status === 401)
      )
        retry = 'retry-finalize';
      if (code === 'UPLOAD_MISSING') retry = 'restart-upload';
      if (attempt.presign?.multipart) retry = 'never';
      const message =
        source?.message ??
        (aborted
          ? 'Upload aborted'
          : phase === 'checksum'
            ? 'Could not calculate upload checksum; use a secure browser context'
            : 'Network request failed');
      const failure = new UploadFailure(
        message,
        code,
        attempt.uploadId,
        phase,
        retry,
        status,
        attempt.requestId,
        cause
      );
      if (attempt.presign && retry !== 'never' && retry !== 'restart-upload')
        this.recoveries.set(failure, attempt);
      notify(options.onEvent, {
        ...event,
        type: 'phase.failed',
        durationMs: performance.now() - started,
        code,
        status,
        retry,
        requestId: attempt.requestId,
      });
      notify(options.onStateChange, 'error');
      notify(options.onError, failure);
      throw failure;
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

  private async presign(
    request: PresignRequest,
    attempt: UploadAttempt,
    signal?: AbortSignal
  ): Promise<PresignResponse> {
    const response = await this.fetch('/api/uploads/presign', {
      method: 'POST',
      body: JSON.stringify(request),
      signal,
      headers: { 'X-Octoload-Upload-Id': attempt.uploadId },
    });
    attempt.requestId = response.headers?.get('X-Request-Id') ?? undefined;

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

  private async finalize(
    request: FinalizeRequest,
    attempt: UploadAttempt,
    signal?: AbortSignal
  ): Promise<ImageRecord> {
    const response = await this.fetch('/api/uploads/finalize', {
      method: 'POST',
      body: JSON.stringify(request),
      signal,
      headers: { 'X-Octoload-Upload-Id': attempt.uploadId },
    });
    attempt.requestId = response.headers?.get('X-Request-Id') ?? undefined;

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
    onProgress?: (progress: ProgressInfo) => void,
    signal?: AbortSignal
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
            new OctoloadError(
              'Storage rejected the upload',
              'STORAGE_REJECTED',
              xhr.status
            )
          );
        }
      });

      xhr.addEventListener('error', () => {
        reject(new NetworkError('Network error during upload'));
      });

      xhr.addEventListener('abort', () => {
        reject(new OctoloadError('Upload aborted', 'UPLOAD_ABORTED'));
      });
      xhr.addEventListener('timeout', () => {
        reject(new OctoloadError('Upload timed out', 'UPLOAD_TIMEOUT'));
      });

      if (!presignResponse.uploadUrl) {
        reject(
          new ValidationError('No upload URL provided in presign response')
        );
        return;
      }

      xhr.open('PUT', presignResponse.uploadUrl);
      xhr.timeout = this.config.uploadTimeoutMs ?? 120_000;
      const abort = () => xhr.abort();
      xhr.addEventListener('loadend', () =>
        signal?.removeEventListener('abort', abort)
      );
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) {
        signal.removeEventListener('abort', abort);
        reject(new OctoloadError('Upload aborted', 'UPLOAD_ABORTED'));
        return;
      }

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
    onProgress?: (progress: ProgressInfo) => void,
    signal?: AbortSignal
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
        signal,
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

    // Parse the response separately so the error below is not caught here.
    let parsed: z.infer<typeof ErrorResponseSchema>;
    try {
      parsed = ErrorResponseSchema.parse(errorData);
    } catch {
      throw new NetworkError(
        `${defaultMessage}: ${response.statusText}`,
        response.status,
        errorData
      );
    }

    throw new OctoloadError(
      parsed.error,
      parsed.code ||
        response.headers?.get('X-Octoload-Error-Code') ||
        'UNKNOWN_ERROR',
      response.status,
      parsed.details
    );
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

    const controller = new AbortController();
    const abort = () => controller.abort(init.signal?.reason);
    init.signal?.addEventListener('abort', abort, { once: true });
    if (init.signal?.aborted) abort();
    const timer = setTimeout(
      () =>
        controller.abort(new DOMException('Request timed out', 'TimeoutError')),
      this.config.requestTimeoutMs ?? 30_000
    );
    try {
      const response = await fetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      });
      // Keep the timeout active while reading the small API response body too.
      if (response.body) {
        return new Response(await response.arrayBuffer(), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }
      return response;
    } catch (error) {
      if (controller.signal.aborted && !init.signal?.aborted) {
        throw new OctoloadError('API request timed out', 'REQUEST_TIMEOUT');
      }
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new NetworkError('Network request failed', undefined, error);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', abort);
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

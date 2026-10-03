import { randomUUID } from 'node:crypto';
import type {
  FinalizeRequest,
  OctoloadConfigLike,
  PresignRequest,
} from '../types/index.js';
import type { DrizzleDB, DrizzleSchema } from './core.js';
import { OctoloadCore } from './core.js';
import { DrizzleError, DrizzleQueryError } from 'drizzle-orm';
import { ZodError } from 'zod';

export interface HandlerContext {
  request: Request;
  user?: { id: string; [key: string]: unknown };
  params?: Record<string, string>;
}

export interface HandlerOptions<
  TDb extends DrizzleDB = DrizzleDB,
  TSchema extends DrizzleSchema = DrizzleSchema,
> {
  config: OctoloadConfigLike;
  db: TDb;
  schema: TSchema;
  // Optional storage adapter can be provided directly for testing or integration
  storage?: unknown;
  requireAuth?: boolean;
  getUser?: (context: HandlerContext) => Promise<{ id: string } | null>;
  /** Safe lifecycle metadata suitable for metrics and structured logs. */
  onEvent?: (event: HandlerEvent) => void | Promise<void>;
  /** Trusted server debugging only; underlying causes can contain secrets. */
  onError?: (error: unknown, event: HandlerEvent) => void | Promise<void>;
}

export interface HandlerEvent {
  type: 'request.started' | 'request.succeeded' | 'request.failed';
  operation: 'presign' | 'finalize' | 'get' | 'delete' | 'list';
  requestId: string;
  uploadId?: string;
  durationMs: number;
  status?: number;
  code?: string;
}

function notify(hook: (() => unknown) | undefined): void {
  try {
    void Promise.resolve(hook?.()).catch(() => {});
  } catch {
    /* Observer isolation. */
  }
}

function errorCode(message: string, status: number): string {
  if (status === 401) return 'AUTHENTICATION_REQUIRED';
  if (status === 404) return 'IMAGE_NOT_FOUND';
  if (status >= 500) return 'INTERNAL_ERROR';
  if (message === 'Upload verification failed - file not found in storage')
    return 'UPLOAD_MISSING';
  if (message.startsWith('Upload verification failed'))
    return 'UPLOAD_MISMATCH';
  if (message === 'Upload is no longer processing')
    return 'UPLOAD_STATE_CONFLICT';
  return 'VALIDATION_ERROR';
}

/** Wrap every response, including early auth failures, with safe correlation. */
function observe<T extends [Request, ...unknown[]]>(
  options: HandlerOptions,
  operation: HandlerEvent['operation'],
  handler: (...args: T) => Promise<Response>
): (...args: T) => Promise<Response> {
  return async (...args) => {
    const started = performance.now();
    const incoming = args[0].headers.get('X-Octoload-Upload-Id');
    const uploadId =
      incoming && /^[a-zA-Z0-9_-]{1,64}$/.test(incoming) ? incoming : undefined;
    const base = { operation, requestId: randomUUID(), uploadId };
    notify(() =>
      options.onEvent?.({ ...base, type: 'request.started', durationMs: 0 })
    );
    let response: Response;
    let cause: unknown;
    try {
      response = await handler(...args);
    } catch (error) {
      cause = error;
      response = errorResponse(error);
    }
    let code: string | undefined;
    if (!response.ok) {
      const body = (await response.clone().json()) as { error?: string };
      code = errorCode(body.error ?? '', response.status);
      response.headers.set('X-Octoload-Error-Code', code);
    }
    response.headers.set('X-Request-Id', base.requestId);
    if (uploadId) response.headers.set('X-Octoload-Upload-Id', uploadId);
    const event: HandlerEvent = {
      ...base,
      type: response.ok ? 'request.succeeded' : 'request.failed',
      durationMs: performance.now() - started,
      status: response.status,
      code,
    };
    notify(() => options.onEvent?.(event));
    if (cause !== undefined) notify(() => options.onError?.(cause, event));
    return response;
  };
}

class InvalidRequestError extends Error {}

async function parseBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new InvalidRequestError('Invalid request');
  }
}

async function resolveUser(
  options: HandlerOptions,
  context?: HandlerContext
): Promise<{ id: string } | undefined> {
  if (options.getUser) {
    try {
      return context
        ? (await options.getUser(context)) || undefined
        : undefined;
    } catch (cause) {
      // Provider error classes cannot turn an authentication outage into a
      // validation failure or reveal their messages through the HTTP boundary.
      throw new Error('Authentication provider failed', { cause });
    }
  }
  return context?.user;
}

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

function authErrorStatus(message: string): number {
  if (message === 'Authentication required') return 401;
  if (
    message === 'Image not found' ||
    message === 'Access denied' ||
    message === 'Image record not found for storage key'
  )
    return 404;
  return 400;
}

function authErrorMessage(message: string): string {
  return authErrorStatus(message) === 404 ? 'Image not found' : message;
}

// Only fixed application errors may be sent to callers. SDKs, drivers and
// authentication callbacks can include credentials, queries or signed URLs.
const publicErrors = new Set([
  'Authentication required',
  'Image not found',
  'Access denied',
  'Image record not found for storage key',
  'Multipart uploads are not supported by the core upload flow',
  'File exceeds the configured size limit',
  'File type is not allowed',
  'Upload is no longer processing',
  'Upload verification failed - file not found in storage',
  'Upload verification failed - file size does not match',
  'Upload verification failed - content type does not match',
]);

function errorResponse(error: unknown): Response {
  let status = 500;
  let message = 'Internal server error';
  if (error instanceof DrizzleError || error instanceof DrizzleQueryError) {
    message = 'Database operation failed';
  } else if (
    error instanceof ZodError ||
    error instanceof InvalidRequestError
  ) {
    status = 400;
    message = 'Invalid request';
  } else if (error instanceof Error && publicErrors.has(error.message)) {
    status = authErrorStatus(error.message);
    message = authErrorMessage(error.message);
  }
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: jsonHeaders,
  });
}

export function createPresignHandler<
  TDb extends DrizzleDB = DrizzleDB,
  TSchema extends DrizzleSchema = DrizzleSchema,
>(options: HandlerOptions<TDb, TSchema>) {
  const core = new OctoloadCore<TDb, TSchema>(
    options.config,
    options.db,
    options.schema
  );

  return observe(
    options,
    'presign',
    async (request: Request, context?: HandlerContext) => {
      try {
        // Check authentication if required
        const user = await resolveUser(options, context);
        if (options.requireAuth) {
          if (!user) {
            return new Response(
              JSON.stringify({ error: 'Authentication required' }),
              {
                status: 401,
                headers: jsonHeaders,
              }
            );
          }
        }

        const body = await parseBody(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          return new Response(JSON.stringify({ error: 'Invalid request' }), {
            status: 400,
            headers: jsonHeaders,
          });
        }
        const presignRequest = body as PresignRequest;

        // Never trust an owner ID supplied in the request body.
        presignRequest.ownerId = user?.id;
        if (!user && !presignRequest.isPublic) {
          return new Response(
            JSON.stringify({ error: 'Authentication required' }),
            {
              status: 401,
              headers: jsonHeaders,
            }
          );
        }

        const result = await core.presign(presignRequest);

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: jsonHeaders,
        });
      } catch (error) {
        throw error;
      }
    }
  );
}

export function createFinalizeHandler<
  TDb extends DrizzleDB = DrizzleDB,
  TSchema extends DrizzleSchema = DrizzleSchema,
>(options: HandlerOptions<TDb, TSchema>) {
  const core = new OctoloadCore<TDb, TSchema>(
    options.config,
    options.db,
    options.schema
  );

  return observe(
    options,
    'finalize',
    async (request: Request, context?: HandlerContext) => {
      try {
        const user = await resolveUser(options, context);
        if (options.requireAuth && !user) {
          return new Response(
            JSON.stringify({ error: 'Authentication required' }),
            {
              status: 401,
              headers: jsonHeaders,
            }
          );
        }
        const body = await parseBody(request);
        const finalizeRequest = body as FinalizeRequest;

        const result = await core.finalize(finalizeRequest, user?.id);

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: jsonHeaders,
        });
      } catch (error) {
        throw error;
      }
    }
  );
}

export function createGetImageHandler<
  TDb extends DrizzleDB = DrizzleDB,
  TSchema extends DrizzleSchema = DrizzleSchema,
>(options: HandlerOptions<TDb, TSchema>) {
  const core = new OctoloadCore<TDb, TSchema>(
    options.config,
    options.db,
    options.schema
  );

  return observe(
    options,
    'get',
    async (_request: Request, imageId: string, context?: HandlerContext) => {
      try {
        const user = await resolveUser(options, context);
        if (options.requireAuth && !user) {
          return new Response(
            JSON.stringify({ error: 'Authentication required' }),
            {
              status: 401,
              headers: jsonHeaders,
            }
          );
        }
        const result = await core.getImage(imageId, user?.id);

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: jsonHeaders,
        });
      } catch (error) {
        throw error;
      }
    }
  );
}

export function createDeleteImageHandler<
  TDb extends DrizzleDB = DrizzleDB,
  TSchema extends DrizzleSchema = DrizzleSchema,
>(options: HandlerOptions<TDb, TSchema>) {
  const core = new OctoloadCore<TDb, TSchema>(
    options.config,
    options.db,
    options.schema
  );

  return observe(
    options,
    'delete',
    async (_request: Request, imageId: string, context?: HandlerContext) => {
      try {
        const user = await resolveUser(options, context);
        if (!user) {
          return new Response(
            JSON.stringify({ error: 'Authentication required' }),
            {
              status: 401,
              headers: jsonHeaders,
            }
          );
        }
        await core.deleteImage(imageId, user.id);

        return new Response(null, {
          status: 204,
          headers: { 'Cache-Control': 'no-store' },
        });
      } catch (error) {
        throw error;
      }
    }
  );
}

export function createGetImagesForEntityHandler<
  TDb extends DrizzleDB = DrizzleDB,
  TSchema extends DrizzleSchema = DrizzleSchema,
>(options: HandlerOptions<TDb, TSchema>) {
  const core = new OctoloadCore<TDb, TSchema>(
    options.config,
    options.db,
    options.schema
  );

  return observe(
    options,
    'list',
    async (
      _request: Request,
      entityType: string,
      entityId: string,
      context?: HandlerContext
    ) => {
      try {
        const user = await resolveUser(options, context);
        if (!user) {
          return new Response(
            JSON.stringify({ error: 'Authentication required' }),
            {
              status: 401,
              headers: jsonHeaders,
            }
          );
        }

        const result = await core.getImagesForEntity(
          entityType,
          entityId,
          user.id
        );

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: jsonHeaders,
        });
      } catch (error) {
        throw error;
      }
    }
  );
}

export { OctoloadCore };

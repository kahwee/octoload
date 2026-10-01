import type {
  FinalizeRequest,
  OctoloadConfigLike,
  PresignRequest,
} from '../types/index.js';
import type { DrizzleDB, DrizzleSchema } from './core.js';
import { OctoloadCore } from './core.js';
import { DrizzleError, DrizzleQueryError } from 'drizzle-orm';

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
}

async function resolveUser(
  options: HandlerOptions,
  context?: HandlerContext
): Promise<{ id: string } | undefined> {
  if (options.getUser) {
    return context ? (await options.getUser(context)) || undefined : undefined;
  }
  return context?.user;
}

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

function errorMessage(error: unknown): string {
  if (error instanceof DrizzleError || error instanceof DrizzleQueryError) {
    return 'Database operation failed';
  }
  return error instanceof Error ? error.message : 'Unknown error';
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

  return async (request: Request, context?: HandlerContext) => {
    try {
      // Check authentication if required
      const user = await resolveUser(options, context);
      if (options.requireAuth) {
        if (!user) {
          return new Response(
            JSON.stringify({ error: 'Authentication required' }),
            {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }
      }

      const body = await request.json();
      const presignRequest = body as PresignRequest;

      // Never trust an owner ID supplied in the request body.
      presignRequest.ownerId = user?.id;
      if (!user && !presignRequest.isPublic) {
        return new Response(
          JSON.stringify({ error: 'Authentication required' }),
          {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      const result = await core.presign(presignRequest);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      const message = errorMessage(error);
      return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };
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

  return async (request: Request, context?: HandlerContext) => {
    try {
      const user = await resolveUser(options, context);
      if (options.requireAuth && !user) {
        return new Response(
          JSON.stringify({ error: 'Authentication required' }),
          {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      const body = await request.json();
      const finalizeRequest = body as FinalizeRequest;

      const result = await core.finalize(finalizeRequest, user?.id);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      const message = errorMessage(error);
      return new Response(
        JSON.stringify({ error: authErrorMessage(message) }),
        {
          status: authErrorStatus(message),
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  };
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

  return async (
    _request: Request,
    imageId: string,
    context?: HandlerContext
  ) => {
    try {
      const user = await resolveUser(options, context);
      if (options.requireAuth && !user) {
        return new Response(
          JSON.stringify({ error: 'Authentication required' }),
          {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      const result = await core.getImage(imageId, user?.id);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      const message = errorMessage(error);
      const status = authErrorStatus(message);

      return new Response(
        JSON.stringify({ error: authErrorMessage(message) }),
        {
          status,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  };
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

  return async (
    _request: Request,
    imageId: string,
    context?: HandlerContext
  ) => {
    try {
      const user = await resolveUser(options, context);
      if (!user) {
        return new Response(
          JSON.stringify({ error: 'Authentication required' }),
          {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      await core.deleteImage(imageId, user.id);

      return new Response(null, { status: 204 });
    } catch (error) {
      const message = errorMessage(error);
      const status = authErrorStatus(message);

      return new Response(
        JSON.stringify({ error: authErrorMessage(message) }),
        {
          status,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  };
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

  return async (
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
            headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      const message = errorMessage(error);
      return new Response(
        JSON.stringify({ error: authErrorMessage(message) }),
        {
          status: authErrorStatus(message),
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  };
}

export { OctoloadCore };

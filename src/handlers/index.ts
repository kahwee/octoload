import type {
  FinalizeRequest,
  OctoloadConfigLike,
  PresignRequest,
} from '../types/index.js';
import type { DrizzleDB, DrizzleSchema } from './core.js';
import { OctoloadCore } from './stub.js';

export interface HandlerContext {
  request: Request;
  user?: { id: string; [key: string]: unknown };
  params?: Record<string, string>;
}

export interface HandlerOptions {
  config: OctoloadConfigLike;
  db: DrizzleDB;
  schema: DrizzleSchema;
  // Optional storage adapter can be provided directly for testing or integration
  storage?: unknown;
  requireAuth?: boolean;
  getUser?: (context: HandlerContext) => Promise<{ id: string } | null>;
}

export function createPresignHandler(options: HandlerOptions) {
  const core = new OctoloadCore(options.config, options.db, options.schema);

  return async (request: Request, context?: HandlerContext) => {
    try {
      // Check authentication if required
      if (options.requireAuth) {
        let user = context?.user;
        if (options.getUser && context) {
          const authUser = await options.getUser(context);
          user = authUser || undefined;
        }
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

      // Get user if auth is configured
      if (options.getUser && context) {
        const user = await options.getUser(context);
        if (user) {
          presignRequest.ownerId = user.id;
        }
      } else if (context?.user) {
        presignRequest.ownerId = context.user.id;
      }

      const result = await core.presign(presignRequest);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };
}

export function createFinalizeHandler(options: HandlerOptions) {
  const core = new OctoloadCore(options.config, options.db, options.schema);

  return async (request: Request) => {
    try {
      const body = await request.json();
      const finalizeRequest = body as FinalizeRequest;

      const result = await core.finalize(finalizeRequest);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };
}

export function createGetImageHandler(options: HandlerOptions) {
  const core = new OctoloadCore(options.config, options.db, options.schema);

  return async (
    _request: Request,
    imageId: string,
    context?: HandlerContext
  ) => {
    try {
      let userId: string | undefined;

      // Get user if auth is configured
      if (options.getUser && context) {
        const user = await options.getUser(context);
        userId = user?.id;
      } else if (context?.user) {
        userId = context.user.id;
      }

      const result = await core.getImage(imageId, userId);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const status =
        message === 'Image not found' || message === 'Access denied'
          ? 404
          : 400;

      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };
}

export function createDeleteImageHandler(options: HandlerOptions) {
  const core = new OctoloadCore(options.config, options.db, options.schema);

  return async (
    _request: Request,
    imageId: string,
    context?: HandlerContext
  ) => {
    try {
      // Check authentication if required
      if (options.requireAuth) {
        let user = context?.user;
        if (options.getUser && context) {
          const authUser = await options.getUser(context);
          user = authUser || undefined;
        }
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

      let userId: string | undefined;

      // Get user if auth is configured
      if (options.getUser && context) {
        const user = await options.getUser(context);
        userId = user?.id;
      } else if (context?.user) {
        userId = context.user.id;
      }

      await core.deleteImage(imageId, userId);

      return new Response(null, { status: 204 });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const status =
        message === 'Image not found' || message === 'Access denied'
          ? 404
          : 400;

      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };
}

export { OctoloadCore };

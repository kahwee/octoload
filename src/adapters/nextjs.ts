// Conditional type definition for Next.js compatibility
type NextRequest = Request & {
  nextUrl?: {
    pathname: string;
    searchParams: URLSearchParams;
  };
  geo?: {
    country?: string;
    region?: string;
    city?: string;
  };
};

import type { HandlerContext, HandlerOptions } from '../handlers/index.js';
import {
  createDeleteImageHandler,
  createFinalizeHandler,
  createGetImageHandler,
  createPresignHandler,
} from '../handlers/index.js';

export interface NextJSHandlerOptions extends Omit<HandlerOptions, 'getUser'> {
  getUser?: (request: NextRequest) => Promise<{ id: string } | null>;
}

export function createNextJSPresignHandler(options: NextJSHandlerOptions) {
  const { getUser, ...baseOptions } = options;
  const baseHandler = createPresignHandler({
    ...baseOptions,
    getUser: getUser
      ? (context) => getUser(context.request as NextRequest)
      : undefined,
  });

  return async (request: NextRequest) => {
    const context: HandlerContext = {
      request,
    };

    return baseHandler(request, context);
  };
}

export function createNextJSFinalizeHandler(options: NextJSHandlerOptions) {
  const { getUser, ...baseOptions } = options;
  const baseHandler = createFinalizeHandler({
    ...baseOptions,
    getUser: getUser
      ? (context) => getUser(context.request as NextRequest)
      : undefined,
  });

  return async (request: NextRequest) => {
    return baseHandler(request, {
      request,
    });
  };
}

export function createNextJSGetImageHandler(options: NextJSHandlerOptions) {
  const { getUser, ...baseOptions } = options;
  const baseHandler = createGetImageHandler({
    ...baseOptions,
    getUser: getUser
      ? (context) => getUser(context.request as NextRequest)
      : undefined,
  });

  return async (
    request: NextRequest,
    { params }: { params: { imageId: string } | Promise<{ imageId: string }> }
  ) => {
    try {
      const resolvedParams = await params;
      const context: HandlerContext = {
        request,
        params: resolvedParams,
      };
      return await baseHandler(request, resolvedParams.imageId, context);
    } catch {
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    }
  };
}

export function createNextJSDeleteImageHandler(options: NextJSHandlerOptions) {
  const { getUser, ...baseOptions } = options;
  const baseHandler = createDeleteImageHandler({
    ...baseOptions,
    getUser: getUser
      ? (context) => getUser(context.request as NextRequest)
      : undefined,
  });

  return async (
    request: NextRequest,
    { params }: { params: { imageId: string } | Promise<{ imageId: string }> }
  ) => {
    try {
      const resolvedParams = await params;
      const context: HandlerContext = {
        request,
        params: resolvedParams,
      };
      return await baseHandler(request, resolvedParams.imageId, context);
    } catch {
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    }
  };
}

// Re-export for backward compatibility with the CLI templates
export {
  createNextJSDeleteImageHandler as createDeleteImageHandler,
  createNextJSFinalizeHandler as createFinalizeHandler,
  createNextJSGetImageHandler as createGetImageHandler,
  createNextJSPresignHandler as createPresignHandler,
};

export type { HandlerEvent } from '../handlers/index.js';

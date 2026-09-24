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
  const baseHandler = createPresignHandler(baseOptions);

  return async (request: NextRequest) => {
    const user = getUser ? await getUser(request) : null;
    const context: HandlerContext = {
      request,
      user: user ? { ...user } : undefined,
    };

    return baseHandler(request, context);
  };
}

export function createNextJSFinalizeHandler(options: NextJSHandlerOptions) {
  const { getUser, ...baseOptions } = options;
  const baseHandler = createFinalizeHandler(baseOptions);

  return async (request: NextRequest) => {
    const user = getUser ? await getUser(request) : null;
    return baseHandler(request, {
      request,
      user: user ? { ...user } : undefined,
    });
  };
}

export function createNextJSGetImageHandler(options: NextJSHandlerOptions) {
  const { getUser, ...baseOptions } = options;
  const baseHandler = createGetImageHandler(baseOptions);

  return async (
    request: NextRequest,
    { params }: { params: { imageId: string } | Promise<{ imageId: string }> }
  ) => {
    const resolvedParams = await params;
    const user = getUser ? await getUser(request) : null;
    const context: HandlerContext = {
      request,
      user: user ? { ...user } : undefined,
      params: resolvedParams,
    };

    return baseHandler(request, resolvedParams.imageId, context);
  };
}

export function createNextJSDeleteImageHandler(options: NextJSHandlerOptions) {
  const { getUser, ...baseOptions } = options;
  const baseHandler = createDeleteImageHandler(baseOptions);

  return async (
    request: NextRequest,
    { params }: { params: { imageId: string } | Promise<{ imageId: string }> }
  ) => {
    const resolvedParams = await params;
    const user = getUser ? await getUser(request) : null;
    const context: HandlerContext = {
      request,
      user: user ? { ...user } : undefined,
      params: resolvedParams,
    };

    return baseHandler(request, resolvedParams.imageId, context);
  };
}

// Re-export for backward compatibility with the CLI templates
export {
  createNextJSDeleteImageHandler as createDeleteImageHandler,
  createNextJSFinalizeHandler as createFinalizeHandler,
  createNextJSGetImageHandler as createGetImageHandler,
  createNextJSPresignHandler as createPresignHandler,
};

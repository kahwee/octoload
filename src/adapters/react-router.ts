import { observeRequest } from '../handlers/observability.js';
import type { HandlerContext, HandlerOptions } from '../handlers/index.js';
import {
  createDeleteImageHandler,
  createFinalizeHandler,
  createGetImageHandler,
  createPresignHandler,
} from '../handlers/index.js';

// Custom types that match React Router's function signature without extra properties
type ActionFunctionArgs = {
  request: Request;
  params?: Record<string, string | undefined>;
};

type LoaderFunctionArgs = {
  request: Request;
  params?: Record<string, string | undefined>;
};
export interface ReactRouterHandlerOptions
  extends Omit<HandlerOptions, 'getUser'> {
  getUser?: (
    args: ActionFunctionArgs | LoaderFunctionArgs
  ) => Promise<{ id: string } | null>;
}

export function createReactRouterPresignHandler(
  options: ReactRouterHandlerOptions
) {
  const { getUser, ...baseOptions } = options;
  const baseHandler = createPresignHandler({
    ...baseOptions,
    getUser: getUser
      ? (context) =>
          getUser({ request: context.request, params: context.params })
      : undefined,
  });

  return async ({ request, params }: ActionFunctionArgs) => {
    const context: HandlerContext = {
      request,
      params: params as Record<string, string>,
    };

    return baseHandler(request, context);
  };
}

export function createReactRouterFinalizeHandler(
  options: ReactRouterHandlerOptions
) {
  const { getUser, ...baseOptions } = options;
  const baseHandler = createFinalizeHandler({
    ...baseOptions,
    getUser: getUser
      ? (context) =>
          getUser({ request: context.request, params: context.params })
      : undefined,
  });

  return async ({ request, params }: ActionFunctionArgs) => {
    return baseHandler(request, {
      request,
      params: params as Record<string, string>,
    });
  };
}

export function createReactRouterGetImageHandler(
  options: ReactRouterHandlerOptions
) {
  const { getUser, ...baseOptions } = options;
  const baseHandler = createGetImageHandler({
    ...baseOptions,
    getUser: getUser
      ? (context) =>
          getUser({ request: context.request, params: context.params })
      : undefined,
  });

  return async ({ request, params }: LoaderFunctionArgs) => {
    const imageId = params?.imageId;
    if (!imageId) {
      return observeRequest(
        options,
        'get',
        async () =>
          new Response('Image ID required', {
            status: 400,
            headers: { 'Cache-Control': 'no-store' },
          })
      )(request);
    }

    const context: HandlerContext = {
      request,
      params: params as Record<string, string>,
    };

    return baseHandler(request, imageId, context);
  };
}

export function createReactRouterDeleteImageHandler(
  options: ReactRouterHandlerOptions
) {
  const { getUser, ...baseOptions } = options;
  const baseHandler = createDeleteImageHandler({
    ...baseOptions,
    getUser: getUser
      ? (context) =>
          getUser({ request: context.request, params: context.params })
      : undefined,
  });

  return async ({ request, params }: ActionFunctionArgs) => {
    if (request.method !== 'DELETE') {
      return observeRequest(
        options,
        'delete',
        async () =>
          new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: {
              Allow: 'DELETE',
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
            },
          })
      )(request);
    }
    const imageId = params?.imageId;
    if (!imageId) {
      return observeRequest(
        options,
        'delete',
        async () =>
          new Response('Image ID required', {
            status: 400,
            headers: { 'Cache-Control': 'no-store' },
          })
      )(request);
    }

    const context: HandlerContext = {
      request,
      params: params as Record<string, string>,
    };

    return baseHandler(request, imageId, context);
  };
}

// Re-export for backward compatibility with the CLI templates
export {
  createReactRouterDeleteImageHandler as createDeleteImageHandler,
  createReactRouterFinalizeHandler as createFinalizeHandler,
  createReactRouterGetImageHandler as createGetImageHandler,
  createReactRouterPresignHandler as createPresignHandler,
};

export type { HandlerEvent } from '../handlers/index.js';

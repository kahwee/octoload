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
export interface ReactRouterHandlerOptions extends Omit<
  HandlerOptions,
  'getUser'
> {
  getUser?: (
    args: ActionFunctionArgs | LoaderFunctionArgs
  ) => Promise<{ id: string } | null>;
}

export function createReactRouterPresignHandler(
  options: ReactRouterHandlerOptions
) {
  const { getUser, ...baseOptions } = options;
  const baseHandler = createPresignHandler(baseOptions);

  return async ({ request, params }: ActionFunctionArgs) => {
    const user = getUser ? await getUser({ request, params }) : null;
    const context: HandlerContext = {
      request,
      user: user ? { ...user } : undefined,
      params: params as Record<string, string>,
    };

    return baseHandler(request, context);
  };
}

export function createReactRouterFinalizeHandler(
  options: ReactRouterHandlerOptions
) {
  const { getUser, ...baseOptions } = options;
  const baseHandler = createFinalizeHandler(baseOptions);

  return async ({ request }: ActionFunctionArgs) => {
    return baseHandler(request);
  };
}

export function createReactRouterGetImageHandler(
  options: ReactRouterHandlerOptions
) {
  const { getUser, ...baseOptions } = options;
  const baseHandler = createGetImageHandler(baseOptions);

  return async ({ request, params }: LoaderFunctionArgs) => {
    const imageId = params?.imageId;
    if (!imageId) {
      return new Response('Image ID required', { status: 400 });
    }

    const user = getUser ? await getUser({ request, params }) : null;
    const context: HandlerContext = {
      request,
      user: user ? { ...user } : undefined,
      params: params as Record<string, string>,
    };

    return baseHandler(request, imageId, context);
  };
}

export function createReactRouterDeleteImageHandler(
  options: ReactRouterHandlerOptions
) {
  const { getUser, ...baseOptions } = options;
  const baseHandler = createDeleteImageHandler(baseOptions);

  return async ({ request, params }: ActionFunctionArgs) => {
    const imageId = params?.imageId;
    if (!imageId) {
      return new Response('Image ID required', { status: 400 });
    }

    const user = getUser ? await getUser({ request, params }) : null;
    const context: HandlerContext = {
      request,
      user: user ? { ...user } : undefined,
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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNextJSDeleteImageHandler,
  createNextJSFinalizeHandler,
  createNextJSGetImageHandler,
  createNextJSPresignHandler,
} from '../adapters/nextjs.js';
import {
  createReactRouterDeleteImageHandler,
  createReactRouterFinalizeHandler,
  createReactRouterGetImageHandler,
  createReactRouterPresignHandler,
} from '../adapters/react-router.js';

// Preserve framework argument mapping while simulating base-handler auth resolution.
// Full response/error boundary coverage lives in adversarial-http.test.ts.
vi.mock('../handlers/index.js', () => {
  const factory = (body: string) =>
    vi.fn(
      (options: {
        getUser?: (context: {
          request: Request;
          params?: Record<string, string>;
        }) => Promise<unknown>;
      }) =>
        vi.fn(async (...args: unknown[]) => {
          const context = args.at(-1) as {
            request: Request;
            params?: Record<string, string>;
          };
          await options.getUser?.(context);
          return new Response(body);
        })
    );
  return {
    createPresignHandler: factory('presign-response'),
    createFinalizeHandler: factory('finalize-response'),
    createGetImageHandler: factory('get-response'),
    createDeleteImageHandler: factory('delete-response'),
  };
});

describe('Framework Adapters', () => {
  const mockHandlerOptions = {
    storage: {
      getPresignedPutUrl: vi.fn(),
      getMultipartUpload: vi.fn(),
      completeMultipartUpload: vi.fn(),
      getPublicUrl: vi.fn(),
      getPrivateUrl: vi.fn(),
      headObject: vi.fn(),
      deleteObject: vi.fn(),
    },
    db: {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn(),
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      query: {},
    },
    schema: {
      images: {},
      uploadSessions: {},
      assetVariants: {},
      imageTags: {},
      imageStatusEnum: {},
      assetVariantEnum: {},
      tableNames: {},
    },
    config: {
      adapter: 's3',
      bucket: 'test-bucket',
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('React Router Adapter', () => {
    describe('createReactRouterPresignHandler', () => {
      it('should handle request with user context', async () => {
        const getUser = vi.fn().mockResolvedValue({ id: 'user-123' });
        const handler = createReactRouterPresignHandler({
          ...mockHandlerOptions,
          getUser,
        });

        const request = new Request('http://localhost/api/uploads/presign', {
          method: 'POST',
          body: JSON.stringify({ filename: 'test.jpg' }),
        });

        const args = {
          request,
          params: { userId: 'user-123' },
        };

        const response = await handler(args);

        expect(getUser).toHaveBeenCalledWith(args);
        expect(response).toBeInstanceOf(Response);
      });

      it('should handle request without user context', async () => {
        const handler = createReactRouterPresignHandler(mockHandlerOptions);

        const request = new Request('http://localhost/api/uploads/presign', {
          method: 'POST',
          body: JSON.stringify({ filename: 'test.jpg' }),
        });

        const args = {
          request,
          params: {},
        };

        const response = await handler(args);
        expect(response).toBeInstanceOf(Response);
      });

      it('should pass correct context to base handler', async () => {
        const getUser = vi.fn().mockResolvedValue({ id: 'user-456' });
        const handler = createReactRouterPresignHandler({
          ...mockHandlerOptions,
          getUser,
        });

        const request = new Request('http://localhost/api/uploads/presign');
        const params = { folder: 'uploads' };

        await handler({ request, params });

        expect(getUser).toHaveBeenCalledWith({ request, params });
      });
    });

    describe('createReactRouterFinalizeHandler', () => {
      it('should handle finalize request', async () => {
        const handler = createReactRouterFinalizeHandler(mockHandlerOptions);

        const request = new Request('http://localhost/api/uploads/finalize', {
          method: 'POST',
          body: JSON.stringify({ storageKey: 'uploads/test.jpg' }),
        });

        const response = await handler({ request });
        expect(response).toBeInstanceOf(Response);
      });

      it('should work with user context', async () => {
        const getUser = vi.fn().mockResolvedValue({ id: 'user-789' });
        const handler = createReactRouterFinalizeHandler({
          ...mockHandlerOptions,
          getUser,
        });

        const request = new Request('http://localhost/api/uploads/finalize');

        const response = await handler({ request });
        expect(response).toBeInstanceOf(Response);
      });
    });

    describe('createReactRouterGetImageHandler', () => {
      it('should handle get image request with imageId', async () => {
        const getUser = vi.fn().mockResolvedValue({ id: 'user-123' });
        const handler = createReactRouterGetImageHandler({
          ...mockHandlerOptions,
          getUser,
        });

        const request = new Request('http://localhost/api/images/img-123');
        const params = { imageId: 'img-123' };

        const response = await handler({ request, params });

        expect(getUser).toHaveBeenCalledWith({ request, params });
        expect(response).toBeInstanceOf(Response);
      });

      it('should return 400 when imageId is missing', async () => {
        const handler = createReactRouterGetImageHandler(mockHandlerOptions);

        const request = new Request('http://localhost/api/images/');
        const params = {}; // No imageId

        const response = await handler({ request, params });

        expect(response.status).toBe(400);
        expect(await response.text()).toBe('Image ID required');
      });

      it('should handle undefined imageId', async () => {
        const handler = createReactRouterGetImageHandler(mockHandlerOptions);

        const request = new Request('http://localhost/api/images/');
        const params = { imageId: undefined };

        const response = await handler({ request, params });
        expect(response.status).toBe(400);
      });
    });

    describe('createReactRouterDeleteImageHandler', () => {
      it('should handle delete image request', async () => {
        const getUser = vi.fn().mockResolvedValue({ id: 'user-456' });
        const handler = createReactRouterDeleteImageHandler({
          ...mockHandlerOptions,
          getUser,
        });

        const request = new Request('http://localhost/api/images/img-456', {
          method: 'DELETE',
        });
        const params = { imageId: 'img-456' };

        const response = await handler({ request, params });

        expect(getUser).toHaveBeenCalledWith({ request, params });
        expect(response).toBeInstanceOf(Response);
      });

      it('should return 400 when imageId is missing', async () => {
        const handler = createReactRouterDeleteImageHandler(mockHandlerOptions);

        const request = new Request('http://localhost/api/images/', {
          method: 'DELETE',
        });
        const params = {};

        const response = await handler({ request, params });

        expect(response.status).toBe(400);
        expect(await response.text()).toBe('Image ID required');
      });
    });
  });

  describe('Next.js Adapter', () => {
    describe('createNextJSPresignHandler', () => {
      it('should handle Next.js request format', async () => {
        const getUser = vi.fn().mockResolvedValue({ id: 'nextjs-user' });
        const handler = createNextJSPresignHandler({
          ...mockHandlerOptions,
          getUser,
        });

        const request = new Request('http://localhost/api/uploads/presign', {
          method: 'POST',
          body: JSON.stringify({ filename: 'nextjs-test.jpg' }),
        });

        const response = await handler(request);

        expect(getUser).toHaveBeenCalledWith(request);
        expect(response).toBeInstanceOf(Response);
      });

      it('should work without user context', async () => {
        const handler = createNextJSPresignHandler(mockHandlerOptions);

        const request = new Request('http://localhost/api/uploads/presign');

        const response = await handler(request);
        expect(response).toBeInstanceOf(Response);
      });
    });

    describe('createNextJSFinalizeHandler', () => {
      it('should handle Next.js finalize request', async () => {
        const handler = createNextJSFinalizeHandler(mockHandlerOptions);

        const request = new Request('http://localhost/api/uploads/finalize', {
          method: 'POST',
          body: JSON.stringify({ storageKey: 'nextjs/test.jpg' }),
        });

        const response = await handler(request);
        expect(response).toBeInstanceOf(Response);
      });

      it('passes the current user to finalize', async () => {
        const getUser = vi.fn().mockResolvedValue({ id: 'nextjs-user-2' });
        const handler = createNextJSFinalizeHandler({
          ...mockHandlerOptions,
          getUser,
        });

        const request = new Request('http://localhost/api/uploads/finalize');

        await handler(request);

        expect(getUser).toHaveBeenCalledWith(request);
      });
    });

    describe('createNextJSGetImageHandler', () => {
      it('should handle Next.js get image request', async () => {
        const getUser = vi.fn().mockResolvedValue({ id: 'nextjs-user-3' });
        const handler = createNextJSGetImageHandler({
          ...mockHandlerOptions,
          getUser,
        });

        const request = new Request(
          'http://localhost/api/images/nextjs-img-123'
        );
        const context = { params: { imageId: 'nextjs-img-123' } };

        const response = await handler(request, context);

        expect(getUser).toHaveBeenCalledWith(request);
        expect(response).toBeInstanceOf(Response);
      });

      it('should handle missing imageId gracefully', async () => {
        const handler = createNextJSGetImageHandler(mockHandlerOptions);

        const request = new Request('http://localhost/api/images/');
        const context = { params: { imageId: undefined as unknown as string } };

        const response = await handler(request, context);

        // Since the base handler is mocked, this will return the mock response
        expect(response).toBeInstanceOf(Response);
      });

      it('should handle Next.js dynamic routes', async () => {
        const handler = createNextJSGetImageHandler(mockHandlerOptions);

        const request = new Request('http://localhost/api/images/dynamic-123');
        const context = {
          params: { imageId: 'dynamic-123' },
        };

        const response = await handler(request, context);
        expect(response).toBeInstanceOf(Response);
      });
    });

    describe('createNextJSDeleteImageHandler', () => {
      it('should handle Next.js delete request', async () => {
        const getUser = vi.fn().mockResolvedValue({ id: 'nextjs-deleter' });
        const handler = createNextJSDeleteImageHandler({
          ...mockHandlerOptions,
          getUser,
        });

        const request = new Request('http://localhost/api/images/delete-me', {
          method: 'DELETE',
        });
        const context = { params: { imageId: 'delete-me' } };

        const response = await handler(request, context);

        expect(getUser).toHaveBeenCalledWith(request);
        expect(response).toBeInstanceOf(Response);
      });

      it('should handle missing imageId in delete', async () => {
        const handler = createNextJSDeleteImageHandler(mockHandlerOptions);

        const request = new Request('http://localhost/api/images/', {
          method: 'DELETE',
        });
        const context = { params: { imageId: undefined as unknown as string } };

        const response = await handler(request, context);

        // Since the base handler is mocked, this will return the mock response
        expect(response).toBeInstanceOf(Response);
      });
    });
  });

  describe('Cross-framework compatibility', () => {
    it('should have consistent response formats between adapters', async () => {
      const rrHandler = createReactRouterPresignHandler(mockHandlerOptions);
      const nextHandler = createNextJSPresignHandler(mockHandlerOptions);

      const request = new Request('http://localhost/api/uploads/presign', {
        method: 'POST',
        body: JSON.stringify({ filename: 'cross-test.jpg' }),
      });

      const rrResponse = await rrHandler({ request, params: {} });
      const nextResponse = await nextHandler(request);

      // Both should return Response objects
      expect(rrResponse).toBeInstanceOf(Response);
      expect(nextResponse).toBeInstanceOf(Response);

      // Both should handle the same core functionality
      expect(rrResponse.status).toBe(nextResponse.status);
    });

    it('should handle user authentication consistently', async () => {
      const getUser = vi.fn().mockResolvedValue({ id: 'cross-user' });

      const rrHandler = createReactRouterGetImageHandler({
        ...mockHandlerOptions,
        getUser,
      });

      const nextHandler = createNextJSGetImageHandler({
        ...mockHandlerOptions,
        getUser,
      });

      const request = new Request('http://localhost/api/images/cross-123');

      await rrHandler({ request, params: { imageId: 'cross-123' } });
      await nextHandler(request, { params: { imageId: 'cross-123' } });

      // getUser should be called with proper context for both
      expect(getUser).toHaveBeenCalledTimes(2);
    });

    it('should handle base functionality consistently across frameworks', async () => {
      const rrDeleteHandler =
        createReactRouterDeleteImageHandler(mockHandlerOptions);
      const nextDeleteHandler =
        createNextJSDeleteImageHandler(mockHandlerOptions);

      const request = new Request('http://localhost/api/images/test-123', {
        method: 'DELETE',
      });

      const rrResponse = await rrDeleteHandler({
        request,
        params: { imageId: 'test-123' },
      });
      const nextResponse = await nextDeleteHandler(request, {
        params: { imageId: 'test-123' },
      });

      // Both should return Response objects from the mocked base handler
      expect(rrResponse).toBeInstanceOf(Response);
      expect(nextResponse).toBeInstanceOf(Response);
    });
  });

  describe('Parameter handling edge cases', () => {
    it('should handle null imageId gracefully', async () => {
      const rrHandler = createReactRouterGetImageHandler(mockHandlerOptions);
      const nextHandler = createNextJSGetImageHandler(mockHandlerOptions);

      const request = new Request('http://localhost/api/images/null');

      const rrResponse = await rrHandler({
        request,
        params: { imageId: null as unknown as string },
      });

      const nextResponse = await nextHandler(request, {
        params: { imageId: null as unknown as string },
      });

      // Since the base handlers are mocked, these will return mock responses
      expect(rrResponse).toBeInstanceOf(Response);
      expect(nextResponse).toBeInstanceOf(Response);
    });

    it('should handle empty string imageId', async () => {
      const rrHandler = createReactRouterDeleteImageHandler(mockHandlerOptions);

      const request = new Request('http://localhost/api/images/', {
        method: 'DELETE',
      });

      const response = await rrHandler({
        request,
        params: { imageId: '' },
      });

      expect(response.status).toBe(400);
    });

    it('should preserve additional params', async () => {
      const getUser = vi.fn().mockResolvedValue({ id: 'param-user' });
      const rrHandler = createReactRouterPresignHandler({
        ...mockHandlerOptions,
        getUser,
      });

      const request = new Request('http://localhost/api/uploads/presign');
      const params = {
        folder: 'uploads',
        category: 'photos',
        size: 'large',
      };

      await rrHandler({ request, params });

      expect(getUser).toHaveBeenCalledWith({ request, params });
    });
  });
});

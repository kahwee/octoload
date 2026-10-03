import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import {
  createPresignHandler,
  createFinalizeHandler,
  createGetImageHandler,
  createDeleteImageHandler,
  createGetImagesForEntityHandler,
  type HandlerOptions,
} from '../handlers/index.js';
import {
  createNextJSPresignHandler,
  createNextJSFinalizeHandler,
  createNextJSGetImageHandler,
  createNextJSDeleteImageHandler,
} from '../adapters/nextjs.js';
import {
  createReactRouterPresignHandler,
  createReactRouterFinalizeHandler,
  createReactRouterGetImageHandler,
  createReactRouterDeleteImageHandler,
} from '../adapters/react-router.js';

const secret = 'private-provider-token-do-not-expose';
const config = {
  adapter: 's3',
  bucket: 'test',
  region: 'us-east-1',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
};
const options: HandlerOptions = {
  config,
  db: {} as HandlerOptions['db'],
  schema: { images: {}, uploadSessions: {}, assetVariants: {}, imageTags: {} },
  requireAuth: true,
  getUser: async () => {
    throw new Error(`Session provider failed ${secret}`);
  },
};
const frameworkOptions = {
  ...options,
  getUser: async () => {
    throw new Error(`Session provider failed ${secret}`);
  },
};
const request = (body = '{}', method = 'POST') =>
  new Request('https://app.test/api/uploads/presign', {
    method,
    body,
    headers: { 'Content-Type': 'application/json' },
  });
const context = () => ({ request: request() });

async function assertSafeFailure(response: Response) {
  expect(response.status).toBe(500);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.text()).not.toContain(secret);
}

describe('HTTP boundaries redact arbitrary provider failures', () => {
  it.each([
    ['presign', () => createPresignHandler(options)(request(), context())],
    ['finalize', () => createFinalizeHandler(options)(request(), context())],
    ['get', () => createGetImageHandler(options)(request(), 'id', context())],
    [
      'delete',
      () => createDeleteImageHandler(options)(request(), 'id', context()),
    ],
    [
      'entity listing',
      () =>
        createGetImagesForEntityHandler(options)(
          request(),
          'recipe',
          'id',
          context()
        ),
    ],
  ])(
    'redacts an auth callback failure in the generic %s handler',
    async (_name, invoke) => {
      await assertSafeFailure(await invoke());
    }
  );

  it.each([
    ['presign', createNextJSPresignHandler],
    ['finalize', createNextJSFinalizeHandler],
  ])(
    'keeps Next.js %s session failures inside the response boundary',
    async (_name, factory) => {
      await assertSafeFailure(await factory(frameworkOptions)(request()));
    }
  );

  it.each([
    ['get', createNextJSGetImageHandler],
    ['delete', createNextJSDeleteImageHandler],
  ])(
    'keeps Next.js %s session failures inside the response boundary',
    async (_name, factory) => {
      await assertSafeFailure(
        await factory(frameworkOptions)(request(), {
          params: { imageId: 'id' },
        })
      );
    }
  );

  it.each([
    ['presign', createReactRouterPresignHandler],
    ['finalize', createReactRouterFinalizeHandler],
    ['get', createReactRouterGetImageHandler],
    ['delete', createReactRouterDeleteImageHandler],
  ])(
    'keeps React Router %s session failures inside the response boundary',
    async (_name, factory) => {
      await assertSafeFailure(
        await factory(frameworkOptions)({
          request: request('{}', _name === 'delete' ? 'DELETE' : 'POST'),
          params: { imageId: 'id' },
        })
      );
    }
  );

  it.each([
    ['get', createNextJSGetImageHandler],
    ['delete', createNextJSDeleteImageHandler],
  ])('redacts rejected Next.js %s route parameters', async (_name, factory) => {
    const onEvent = vi.fn();
    const onError = vi.fn();
    const response = await factory({ ...frameworkOptions, onEvent, onError })(
      request(),
      {
        params: Promise.reject(
          new Error(`Parameter resolution failed ${secret}`)
        ),
      }
    );
    expect(response.headers.get('X-Request-Id')).toBeTruthy();
    expect(onEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        operation: _name,
        type: 'request.failed',
        code: 'INTERNAL_ERROR',
      })
    );
    expect(onError).toHaveBeenCalledOnce();
    expect(JSON.stringify(onEvent.mock.calls)).not.toContain(secret);
    await assertSafeFailure(response);
  });

  it.each([
    ['get', createReactRouterGetImageHandler],
    ['delete', createReactRouterDeleteImageHandler],
  ])(
    'observes missing React Router %s parameters without changing its response',
    async (operation, factory) => {
      const onEvent = vi.fn();
      const response = await factory({ ...frameworkOptions, onEvent })({
        request: request('{}', operation === 'delete' ? 'DELETE' : 'POST'),
        params: {},
      });
      expect(response.status).toBe(400);
      expect(await response.text()).toBe('Image ID required');
      expect(response.headers.get('X-Request-Id')).toBeTruthy();
      expect(onEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({
          operation,
          type: 'request.failed',
          code: 'VALIDATION_ERROR',
        })
      );
    }
  );

  it('prevents caching successful private metadata and signed download URLs', async () => {
    const image = {
      id: 'image',
      ownerId: 'owner',
      isPublic: false,
      status: 'ready',
      storageKey: 'private/pixel.png',
    };
    const db = {
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [image] }) }),
      }),
    } as unknown as HandlerOptions['db'];
    const response = await createGetImageHandler({
      ...options,
      db,
      getUser: async () => ({ id: 'owner' }),
    })(request(), image.id, context());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect((await response.json()).image.id).toBe(image.id);
  });

  it('classifies an authentication provider SyntaxError as a redacted server failure', async () => {
    const response = await createPresignHandler({
      ...options,
      getUser: async () => {
        throw new SyntaxError(`Private auth response ${secret}`);
      },
    })(request(), context());
    await assertSafeFailure(response);
  });

  it('classifies an authentication provider ZodError as a redacted server failure', async () => {
    const response = await createPresignHandler({
      ...options,
      getUser: async () => {
        throw new ZodError([{ code: 'custom', path: [], message: secret }]);
      },
    })(request(), context());
    await assertSafeFailure(response);
  });

  it('classifies a provider SyntaxError as a redacted server failure', async () => {
    const insert = () => {
      throw new SyntaxError(`Private driver response ${secret}`);
    };
    const response = await createPresignHandler({
      ...options,
      getUser: async () => ({ id: 'owner' }),
      db: { insert } as unknown as HandlerOptions['db'],
    })(
      request(
        JSON.stringify({
          filename: 'pixel.png',
          contentType: 'image/png',
          byteSize: 68,
        })
      ),
      context()
    );
    await assertSafeFailure(response);
  });

  it('redacts a non-Drizzle database driver Error', async () => {
    const insert = vi.fn(() => {
      throw new Error(`raw driver connection string ${secret}`);
    });
    const handler = createPresignHandler({
      ...options,
      getUser: async () => ({ id: 'owner' }),
      db: { insert } as unknown as HandlerOptions['db'],
    });
    await assertSafeFailure(
      await handler(
        request(
          JSON.stringify({
            filename: 'pixel.png',
            contentType: 'image/png',
            byteSize: 68,
          })
        ),
        context()
      )
    );
  });
});

describe('malformed presign JSON cannot leak JavaScript implementation errors', () => {
  it('redacts malformed JSON parser fragments containing sensitive values', async () => {
    const handler = createPresignHandler({
      ...options,
      getUser: async () => ({ id: 'owner' }),
    });
    const response = await handler(
      request(`{"private": ${secret}}`),
      context()
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid request' });
  });
  it.each(['null', '42', 'true', '"text"', '[]'])(
    'rejects %s before mutating the owner field',
    async (body) => {
      const handler = createPresignHandler({
        ...options,
        getUser: async () => ({ id: 'owner' }),
      });
      const response = await handler(request(body), context());
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).not.toMatch(
        /Cannot set|Cannot create property|ownerId|TypeError/
      );
    }
  );
});

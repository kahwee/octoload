import { randomUUID } from 'node:crypto';

export interface HandlerObserverOptions {
  onEvent?: (event: HandlerEvent) => void | Promise<void>;
  /** Trusted sink only: raw exceptions may include secrets. */
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
  if (status === 405) return 'METHOD_NOT_ALLOWED';
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
export function observeRequest<T extends [Request, ...unknown[]]>(
  options: HandlerObserverOptions,
  operation: HandlerEvent['operation'],
  handler: (...args: T) => Promise<Response>,
  mapError: (error: unknown) => Response = () =>
    new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    })
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
      response = mapError(error);
    }
    let code: string | undefined;
    if (!response.ok) {
      const body = (await response
        .clone()
        .json()
        .catch(() => ({}))) as { error?: string };
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

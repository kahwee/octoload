import { afterEach, describe, expect, it, vi } from 'vitest';
import { OctoloadClient, UploadFailure } from '../client/index.js';
import type { UploadEvent } from '../client/index.js';

class XHR {
  static mode = 'load';
  static sends = 0;
  status = 200;
  timeout = 0;
  upload = {
    addEventListener: (
      _name: string,
      callback: (event: {
        lengthComputable: boolean;
        loaded: number;
        total: number;
      }) => void
    ) => {
      queueMicrotask(() =>
        callback({ lengthComputable: true, loaded: 3, total: 3 })
      );
    },
  };
  listeners = new Map<string, () => void>();
  addEventListener(name: string, callback: () => void) {
    this.listeners.set(name, callback);
  }
  open() {}
  setRequestHeader() {}
  abort() {
    this.listeners.get('abort')?.();
    this.listeners.get('loadend')?.();
  }
  send() {
    XHR.sends++;
    queueMicrotask(() => {
      this.listeners.get(XHR.mode)?.();
      this.listeners.get('loadend')?.();
    });
  }
}
const file = () => new File(['png'], 'private-name.png', { type: 'image/png' });
const presign = () =>
  new Response(
    JSON.stringify({
      storageKey: 'secret/key',
      uploadUrl: 'https://bucket.test/?signature=secret',
      expiresAt: new Date(Date.now() + 3600000),
    }),
    { headers: { 'X-Request-Id': 'presign-request' } }
  );
const finalized = () =>
  new Response(JSON.stringify({ id: 'image', status: 'ready' }), {
    headers: { 'X-Request-Id': 'finalize-request' },
  });
function setup() {
  XHR.mode = 'load';
  XHR.sends = 0;
  vi.stubGlobal('XMLHttpRequest', XHR);
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  return { fetch, client: new OctoloadClient({ baseUrl: 'https://app.test' }) };
}
afterEach(() => vi.unstubAllGlobals());

describe('upload observability and recovery', () => {
  it('isolates all hooks and emits timed, redacted phase events', async () => {
    const { fetch, client } = setup();
    fetch.mockResolvedValueOnce(presign()).mockResolvedValueOnce(finalized());
    const events: UploadEvent[] = [];
    await expect(
      client.uploadFile(file(), {
        onEvent: async (event) => {
          events.push(event);
          throw new Error('telemetry down');
        },
        onStateChange: () => {
          throw new Error('view failed');
        },
        onProgress: () => {
          throw new Error('progress failed');
        },
      })
    ).resolves.toMatchObject({ image: { status: 'ready' } });
    expect(events.map((event) => `${event.phase}:${event.type}`)).toEqual([
      'presign:phase.started',
      'presign:phase.succeeded',
      'put:phase.started',
      'put:phase.succeeded',
      'checksum:phase.started',
      'checksum:phase.succeeded',
      'finalize:phase.started',
      'finalize:phase.succeeded',
    ]);
    expect(events.at(-1)).toMatchObject({
      requestId: 'finalize-request',
      attempt: 1,
    });
    for (const event of events)
      expect(event.durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(events)).not.toMatch(
      /private-name|secret|signature|bucket/
    );
    expect(fetch.mock.calls[0][1].headers['X-Octoload-Upload-Id']).toBe(
      events[0].uploadId
    );
  });

  it.each(['put', 'finalize'])(
    'recovers an ambiguous %s without replaying PUT',
    async (phase) => {
      const { fetch, client } = setup();
      fetch.mockResolvedValueOnce(presign());
      if (phase === 'put') XHR.mode = 'error';
      else fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const onError = vi.fn(() => {
        throw new Error('hook failure');
      });
      const error = await client
        .uploadFile(file(), { onError })
        .catch((e) => e);
      expect(error).toBeInstanceOf(UploadFailure);
      expect(error).toMatchObject({
        phase,
        retry: phase === 'put' ? 'reconcile' : 'retry-finalize',
      });
      expect(onError).toHaveBeenCalledWith(error);
      const events: UploadEvent[] = [];
      fetch.mockResolvedValueOnce(finalized());
      await client.recoverUpload(error, {
        onEvent: (event) => {
          events.push(event);
        },
      });
      expect(XHR.sends).toBe(1);
      expect(JSON.parse(fetch.mock.calls.at(-1)![1].body)).toMatchObject({
        reconcile: true,
        storageKey: 'secret/key',
      });
      expect(events.at(-1)).toMatchObject({
        uploadId: error.uploadId,
        attempt: 2,
      });
      expect(Object.keys(error)).not.toContain('cause');
    }
  );

  it('instructs restart only after reconciliation establishes a missing object', async () => {
    const { fetch, client } = setup();
    XHR.mode = 'error';
    fetch.mockResolvedValueOnce(presign());
    const error = await client.uploadFile(file()).catch((e) => e);
    fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: 'Upload verification failed - file not found in storage',
        }),
        { status: 400, headers: { 'X-Octoload-Error-Code': 'UPLOAD_MISSING' } }
      )
    );
    const missing = await client.recoverUpload(error).catch((e) => e);
    expect(missing).toMatchObject({
      phase: 'finalize',
      code: 'UPLOAD_MISSING',
      retry: 'restart-upload',
    });
    await expect(client.recoverUpload(missing)).rejects.toThrow(
      'cannot be recovered'
    );
    expect(XHR.sends).toBe(1);
  });

  it('isolates rejected async progress hooks in batched uploads', async () => {
    const { fetch, client } = setup();
    fetch.mockImplementation((url: string) =>
      Promise.resolve(url.endsWith('presign') ? presign() : finalized())
    );
    const onProgress = vi.fn(async () => {
      throw new Error('async telemetry failure');
    });
    await expect(
      client.uploadMultiple([file(), file()], { onProgress })
    ).resolves.toHaveLength(2);
    expect(onProgress).toHaveBeenCalledTimes(2);
  });

  it('accepts a browser 204 response with an exposed empty body stream', async () => {
    const { fetch, client } = setup();
    const arrayBuffer = vi.fn();
    fetch.mockResolvedValue({
      status: 204,
      ok: true,
      body: new ReadableStream(),
      arrayBuffer,
    });
    await expect(client.deleteImage('image')).resolves.toBeUndefined();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('retains independent correlation during concurrent uploads', async () => {
    const { fetch, client } = setup();
    fetch.mockImplementation((url: string) =>
      Promise.resolve(url.endsWith('presign') ? presign() : finalized())
    );
    const events: UploadEvent[] = [];
    await client.uploadMultiple([file(), file(), file()], {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(new Set(events.map((event) => event.uploadId)).size).toBe(3);
    expect(
      events.filter(
        (event) =>
          event.phase === 'finalize' && event.type === 'phase.succeeded'
      )
    ).toHaveLength(3);
  });

  it('identifies checksum failure and prevents finalization', async () => {
    const { fetch, client } = setup();
    vi.stubGlobal('crypto', {});
    fetch.mockResolvedValueOnce(presign());
    await expect(client.uploadFile(file())).rejects.toMatchObject({
      phase: 'checksum',
      code: 'CHECKSUM_FAILED',
      retry: 'never',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('bounds API requests and identifies cancellation', async () => {
    const { fetch } = setup();
    fetch.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener('abort', () =>
            reject(init.signal.reason)
          )
        )
    );
    const client = new OctoloadClient({
      baseUrl: 'https://app.test',
      requestTimeoutMs: 5,
    });
    await expect(client.uploadFile(file())).rejects.toMatchObject({
      phase: 'presign',
      code: 'REQUEST_TIMEOUT',
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.uploadFile(file(), { signal: controller.signal })
    ).rejects.toMatchObject({ code: 'UPLOAD_ABORTED', retry: 'never' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

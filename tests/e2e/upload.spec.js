import { test as base, expect } from '@playwright/test';
const test = base.extend({
  request: async ({ context }, use) => {
    await use(context.request);
  },
});
const pixel = {
  name: 'pixel.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
    'base64'
  ),
};
async function forwardInjectedRequest(route) {
  try {
    return await route.fetch({ timeout: 15000 });
  } catch {
    throw new Error('Fault-injection request did not complete');
  }
}
const token = () => ({ 'X-Test-Token': process.env.OCTOLOAD_E2E_TOKEN });
async function login(request, user = 'alice') {
  const response = await request.post('/test/session', {
    headers: token(),
    data: { user },
  });
  expect(response.status()).toBe(200);
}
async function upload(page, query = '') {
  await page.goto(`/${query}`);
  await page.getByLabel('Upload image').setInputFiles(pixel);
}
async function state(page) {
  return page.evaluate(() => window.uploadState());
}
async function ready(page) {
  // Report only safe client events on failure, never a presigned URL.
  await expect(page.locator('#status')).toHaveText('ready', { timeout: 20000 });
  await expect
    .poll(() =>
      page
        .locator('img')
        .evaluate((img) => img.complete && img.naturalWidth === 1)
    )
    .toBe(true);
}
async function rows(request) {
  return (await request.get('/test/rows', { headers: token() })).json();
}

test.beforeEach(async ({ request }) => {
  await login(request);
});

test('real browser private upload, read, ownership, correlation, and delete', async ({
  page,
  request,
  browser,
  baseURL,
}) => {
  await upload(page);
  await ready(page);
  const result = await state(page);
  expect(result.progress).toContain(100);
  expect(
    result.events
      .filter((event) => event.type === 'phase.succeeded')
      .map((event) => event.phase)
  ).toEqual(['presign', 'put', 'checksum', 'finalize']);
  const bytes = await page.locator('img').evaluate(async (img) => {
    const response = await fetch(img.src);
    return [...new Uint8Array(await response.arrayBuffer())];
  });
  expect(Buffer.from(bytes)).toEqual(pixel.buffer);
  const dbRow = (await rows(request)).find((row) => row.id === result.imageId);
  expect(dbRow).toMatchObject({ status: 'ready', ownerId: 'alice' });
  const other = await browser.newContext({ baseURL });
  try {
    await login(other.request, 'bob');
    expect(
      (await other.request.get(`/api/images/${result.imageId}`)).status()
    ).toBe(404);
    expect(
      (await other.request.delete(`/api/images/${result.imageId}`)).status()
    ).toBe(404);
  } finally {
    await other.close();
  }
  const serverEvents = await (
    await request.get('/test/events', { headers: token() })
  ).json();
  for (const phase of ['presign', 'finalize']) {
    const clientEvent = result.events.find(
      (event) => event.phase === phase && event.type === 'phase.succeeded'
    );
    expect(serverEvents).toContainEqual(
      expect.objectContaining({
        uploadId: clientEvent.uploadId,
        requestId: clientEvent.requestId,
        operation: phase,
        status: 200,
      })
    );
  }
  expect(JSON.stringify(result.events)).not.toMatch(
    /X-Amz|pixel\.png|storageKey/
  );
  await page.locator('#delete').click();
  await expect(page.locator('#status')).toHaveText('deleted');
  expect((await request.get(`/api/images/${result.imageId}`)).status()).toBe(
    404
  );
  expect((await rows(request)).some((row) => row.id === result.imageId)).toBe(
    false
  );
});

test('throwing telemetry and state hooks do not break upload', async ({
  page,
}) => {
  await upload(page, '?throw=1');
  await ready(page);
});

test('interrupted PUT reports uncertainty and reconciliation establishes missing storage', async ({
  page,
}) => {
  await page.route('**/*', (route) =>
    route.request().method() === 'PUT'
      ? route.abort('connectionreset')
      : route.continue()
  );
  await upload(page);
  await expect(page.locator('#status')).toHaveText('error:put:NETWORK_ERROR');
  const failed = await state(page);
  expect(failed.events.some((event) => event.phase === 'finalize')).toBe(false);
  expect(failed.failure.retry).toBe('reconcile');
  await page.locator('#recover').click();
  await expect(page.locator('#status')).toHaveText(
    'error:finalize:UPLOAD_MISSING'
  );
  expect((await state(page)).failure.retry).toBe('restart-upload');
});

test('lost successful finalize response recovers without a second PUT', async ({
  page,
}) => {
  let puts = 0;
  page.on('request', (request) => {
    if (request.method() === 'PUT') puts++;
  });
  await page.route(
    '**/api/uploads/finalize',
    async (route) => {
      const response = await forwardInjectedRequest(route);
      expect(response.status()).toBe(200);
      await route.abort('connectionreset');
    },
    { times: 1 }
  );
  await upload(page);
  await expect(page.locator('#status')).toHaveText(
    'error:finalize:NETWORK_ERROR'
  );
  const failed = await state(page);
  await page.locator('#recover').click();
  await ready(page);
  const recovered = await state(page);
  expect(puts).toBe(1);
  expect(recovered.events.at(-1)).toMatchObject({
    phase: 'finalize',
    type: 'phase.succeeded',
    uploadId: failed.failure.uploadId,
    attempt: 2,
  });
});

test('session expiry between PUT and finalize is identifiable and recoverable after login', async ({
  page,
  context,
  request,
}) => {
  await page.route(
    '**/api/uploads/finalize',
    async (route) => {
      await context.clearCookies();
      const headers = { ...route.request().headers() };
      delete headers.cookie;
      await route.continue({ headers });
    },
    { times: 1 }
  );
  await upload(page);
  await expect(page.locator('#status')).toHaveText(
    'error:finalize:AUTHENTICATION_REQUIRED'
  );
  expect((await state(page)).failure.retry).toBe('retry-finalize');
  await login(request);
  await page.locator('#recover').click();
  await ready(page);
});

test('three concurrent uploads retain separate IDs and successful outcomes', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByLabel('Upload image')
    .setInputFiles([
      pixel,
      { ...pixel, name: 'second.png' },
      { ...pixel, name: 'third.png' },
    ]);
  await ready(page);
  const result = await state(page);
  expect(new Set(result.events.map((event) => event.uploadId)).size).toBe(3);
  expect(
    result.events.filter(
      (event) => event.phase === 'finalize' && event.type === 'phase.succeeded'
    )
  ).toHaveLength(3);
});

test('cancellation does not finalize or claim success', async ({ page }) => {
  await upload(page, '?cancel=1');
  await expect(page.locator('#status')).toHaveText('error:put:UPLOAD_ABORTED');
  expect((await state(page)).failure.retry).toBe('never');
});

test('lost successful PUT response reconciles the stored object without replay', async ({
  page,
}) => {
  let puts = 0;
  await page.route('**/*', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    puts++;
    const response = await forwardInjectedRequest(route);
    expect(response.status()).toBe(200);
    await route.abort('connectionreset');
  });
  await upload(page);
  await expect(page.locator('#status')).toHaveText('error:put:NETWORK_ERROR');
  await page.locator('#recover').click();
  await ready(page);
  expect(puts).toBe(1);
});

test('a stalled PUT times out and does not finalize', async ({ page }) => {
  let release;
  const completed = new Promise((done) => {
    release = done;
  });
  await page.route('**/*', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    await new Promise((done) => setTimeout(done, 250));
    await route.abort('timedout');
    release();
  });
  await upload(page, '?timeout=50');
  await expect(page.locator('#status')).toHaveText('error:put:UPLOAD_TIMEOUT');
  expect(
    (await state(page)).events.some((event) => event.phase === 'finalize')
  ).toBe(false);
  await completed;
});

test.afterEach(async ({ page, request }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    const result = await state(page).catch(() => null);
    if (result)
      await testInfo.attach('safe-upload-events', {
        body: JSON.stringify(result),
        contentType: 'application/json',
      });
  }
  await login(request);
  for (const row of await rows(request)) {
    expect((await request.delete(`/api/images/${row.id}`)).status()).toBe(204);
  }
  expect(await rows(request)).toEqual([]);
});

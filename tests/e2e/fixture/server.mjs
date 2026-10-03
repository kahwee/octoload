// Local-only test application. Never deploy these session/control endpoints.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../../../dist/templates/upload-schema-sqlite.js';
import {
  createPresignHandler,
  createFinalizeHandler,
  createGetImageHandler,
  createDeleteImageHandler,
} from '../../../dist/adapters/nextjs.js';

if (process.env.OCTOLOAD_E2E_ENABLED !== '1')
  throw new Error('Test fixture is disabled');
const connection = createClient({ url: process.env.OCTOLOAD_E2E_DB });
await connection.execute('PRAGMA foreign_keys = ON');
const db = drizzle(connection, { schema });
const sessions = new Map();
const events = [];
const cookieName = 'octoload-test-session';
const options = {
  config: {
    storage: {
      adapter: 'r2',
      bucket: process.env.OCTOLOAD_TEST_BUCKET,
      region: 'auto',
      endpoint: process.env.OCTOLOAD_TEST_ENDPOINT,
      credentials: {
        accessKeyId: process.env.OCTOLOAD_TEST_ACCESS_KEY_ID,
        secretAccessKey: process.env.OCTOLOAD_TEST_SECRET_ACCESS_KEY,
        ...(process.env.OCTOLOAD_TEST_SESSION_TOKEN
          ? { sessionToken: process.env.OCTOLOAD_TEST_SESSION_TOKEN }
          : {}),
      },
    },
    limits: { maxFileSize: 10 * 1024 * 1024, allowedTypes: ['image/png'] },
  },
  db,
  schema: schema.uploadSchema,
  requireAuth: true,
  getUser: async (request) => {
    const token = request.headers
      .get('cookie')
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    return sessions.get(token) ?? null;
  },
  onEvent: (event) => {
    events.push(event);
  },
};
const handlers = {
  presign: createPresignHandler(options),
  finalize: createFinalizeHandler(options),
  get: createGetImageHandler(options),
  delete: createDeleteImageHandler(options),
};
export async function dispatch(request) {
  const pathname = new URL(request.url).pathname;
  if (pathname.startsWith('/test/')) {
    if (request.headers.get('X-Test-Token') !== process.env.OCTOLOAD_E2E_TOKEN)
      return new Response(null, { status: 403 });
    if (pathname === '/test/session') {
      const { user } = await request.json();
      if (!['alice', 'bob'].includes(user))
        return new Response(null, { status: 400 });
      const token = randomUUID();
      sessions.set(token, { id: user });
      return Response.json(
        { ok: true },
        {
          headers: {
            'Set-Cookie': `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`,
          },
        }
      );
    }
    if (pathname === '/test/events') return Response.json(events);
    if (pathname === '/test/rows')
      return Response.json(
        (await db.select().from(schema.images)).map(
          ({ id, status, ownerId }) => ({ id, status, ownerId })
        )
      );
  }
  if (pathname === '/api/uploads/presign') return handlers.presign(request);
  if (pathname === '/api/uploads/finalize') return handlers.finalize(request);
  const match = /^\/api\/images\/([^/]+)$/.exec(pathname);
  if (match)
    return handlers[request.method === 'DELETE' ? 'delete' : 'get'](request, {
      params: Promise.resolve({ imageId: match[1] }),
    });
  if (pathname === '/client.js')
    return new Response(await readFile(process.env.OCTOLOAD_E2E_BUNDLE), {
      headers: { 'Content-Type': 'text/javascript' },
    });
  if (pathname === '/')
    return new Response(
      `<!doctype html><html><body>
    <input type="file" multiple aria-label="Upload image"><button id="recover">Recover</button>
    <button id="delete">Delete</button><output id="status">idle</output><img alt="Uploaded image" crossorigin="anonymous">
    <script type="module" src="/client.js"></script></body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  return new Response(null, { status: 404 });
}

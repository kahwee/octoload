# Octoload

Octoload is a TypeScript toolkit for **browser-to-S3 image uploads** with metadata stored through Drizzle ORM. It also works with Cloudflare R2 through its S3-compatible API. Your application handles the presign and finalize requests; the image bytes go from the browser directly to object storage.

This repository is an early-stage library, not a hosted upload service. It provides a browser client, storage operations, framework handler wrappers, a PostgreSQL Drizzle schema generator, and a CLI. The application supplies its own database connection, authentication, routes, bucket, and CORS policy.

## How it works

1. The browser asks your app for a presigned PUT URL.
2. The server creates a `processing` image row and signs an S3/R2 upload URL.
3. The browser uploads the file directly to the bucket.
4. The browser asks your app to finalize. The server checks that the object exists and marks the row `ready`.

The client uses `/api/uploads/presign` and `/api/uploads/finalize`. Its `getImage` and `deleteImage` methods use `/api/images/:id`. You must mount matching handlers in your app.

## Install

Requires Node.js 22 or newer for server code and a browser with `XMLHttpRequest` for uploads.

```bash
pnpm add octoload drizzle-orm
```

Generate the PostgreSQL schema, then include the generated file in your Drizzle configuration and apply your migrations using your normal Drizzle workflow:

```bash
pnpm exec octoload generate --output src/db/upload-schema.ts
```

`generate` **overwrites** its output file. Review the generated schema before using it. It defines `images`, `upload_sessions`, `asset_variants`, and `image_tags`; the current upload flow writes only image rows.

For Next.js or React Router, `octoload init --framework nextjs` (or `react-router`) creates the config, upload and image routes, and a shared server module. It preserves existing files when rerun. Follow its printed steps to generate the schema, export your Drizzle `db`, and connect the generated `getUploadUser` function to your session provider. Pass `--auth better-auth` if your app already exports a Better Auth instance from `src/lib/auth.ts` (Next.js) or `app/lib/auth.server.ts` (React Router); the generated session function will use it. Generated upload routes return 401 until session lookup returns a user.

## Server wiring

Create a config and pass it, your Drizzle database, and the generated schema to the handlers. Here is the shape of the integration; mount the returned functions in the routes for your framework:

```ts
import { createFinalizeHandler, createPresignHandler } from 'octoload';
import type { OctoloadConfig } from 'octoload';
import { db } from './db.js';
import * as schema from './db/upload-schema.js';

const config: OctoloadConfig = {
  storage: {
    adapter: 's3', // use 'r2' and set endpoint for Cloudflare R2
    bucket: process.env.S3_BUCKET!,
    region: process.env.S3_REGION!,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  },
  limits: {
    maxFileSize: 10 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxVariants: 0,
  },
};

export const presign = createPresignHandler({ config, db, schema });
export const finalize = createFinalizeHandler({ config, db, schema });
```

The framework exports `octoload/nextjs` and `octoload/react-router` provide wrappers for these handlers. Pass an options object with `config`, `db`, and `schema`; see the exported handler types for each wrapper's request signature.

**Authentication and validation belong in your app.** Supply a trusted `getUser` callback (or framework wrapper callback). The handler never accepts `ownerId` from the request body. Private reads, deletion, metadata updates, and owner-scoped lists require the matching user. Finalizing an owned upload requires its owner. Set `requireAuth: true` on presign and finalize routes to require a session for every upload. Without it, only public uploads can be created anonymously. The `limits` and hook fields exist in the config types, but the current core does not enforce file size/type limits or invoke hooks. Presigned PUT URLs expire after one hour. Configure bucket CORS to allow PUT from your application origin and the headers used for uploads.

If your app uses Better Auth, implement the generated session function with `auth.api.getSession({ headers: request.headers })` and return `session?.user ? { id: session.user.id } : null`. In a typical Next.js app, import `auth` from `src/lib/auth.ts`; in React Router, use `app/lib/auth.server.ts`. [Better Auth documents this server session API](https://better-auth.com/docs/basic-usage).

## Browser upload

```ts
import { OctoloadClient } from 'octoload/client';

const client = new OctoloadClient({ baseUrl: window.location.origin });
const result = await client.uploadFile(file, {
  onProgress: ({ percentage }) => console.log(`${percentage}%`),
});

console.log(result.image.id);
```

The client uploads one file with a presigned PUT URL, then calls finalize. `uploadMultiple` uploads files in batches of three. `getImage` and `deleteImage` need corresponding routes in your app.

## Current scope

- The active server flow is **single PUT uploads**. Multipart types and client handling exist, but the core does not currently create multipart upload sessions or complete multipart uploads.
- The schema generator emits **PostgreSQL** tables. MySQL and SQLite schemas are not implemented.
- `octoload init` creates framework routes and a fail-closed auth hook. You still connect your existing Drizzle database and session provider.
- Variant and tag tables are schema only. Image processing, tag writes, and custom storage adapters are not implemented by the upload flow.
- `isPublic` is metadata, not a bucket permission change. Configure public delivery yourself; private reads use signed GET URLs.

## Development

```bash
pnpm install
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run test:package
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution steps. Licensed under [MIT](./LICENSE).

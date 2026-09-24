# Octoload

Octoload sends images directly from the browser to **Amazon S3 or Cloudflare R2**. Your app signs the upload, stores metadata in PostgreSQL through Drizzle, and decides who may read or delete each image. Octoload provides a browser client, framework handlers, a schema generator, and an optional scaffold; it is not a hosted service.

1. The browser asks your app for a signed PUT URL. Your app creates a `processing` image row in PostgreSQL.
2. The browser PUTs the bytes directly to S3 or R2.
3. The browser asks your app to finalize. Your app checks the stored object and marks its row `ready`.

The server supports single PUT uploads. It checks the stored object's size and content type before marking an image ready. These metadata checks do not inspect image bytes or verify the client-supplied SHA-256 checksum.

## Quick start: Next.js with Better Auth

You need Node.js 22+, an existing Next.js app with PostgreSQL, a Drizzle database connection, a Better Auth instance exported from `src/lib/auth.ts`, and an S3 bucket. For Cloudflare R2, use the [R2 variant](#cloudflare-r2-variant) below.

```bash
pnpm add octoload drizzle-orm pg
pnpm add -D drizzle-kit @types/pg
pnpm exec octoload init --framework nextjs --adapter s3 --auth better-auth
pnpm exec octoload generate --output src/db/upload-schema.ts
```

`init` creates upload and image routes under `src/app/api`, plus `src/lib/octoload/{auth,config,server}.ts`, `drizzle.config.ts`, and `.env.example` when those files do not already exist. It does not overwrite existing files; it may append missing bucket variables to `.env.example`. `generate` **overwrites** its output file, so review the path before rerunning it.

Create `src/db/index.ts` if your app does not already export a Drizzle `db`:

```ts
import { drizzle } from 'drizzle-orm/node-postgres';

export const db = drizzle(process.env.DATABASE_URL!);
```

The generated `server.ts` imports that `db` and `src/db/upload-schema.ts`. If your app already has `drizzle.config.ts`, include the generated schema alongside your existing schema files. For example:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: ['./src/db/schema.ts', './src/db/upload-schema.ts'],
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

Fill in `DATABASE_URL`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` in your server environment. Then generate and apply your PostgreSQL migration with your normal Drizzle workflow, for example:

```bash
pnpm exec drizzle-kit generate
pnpm exec drizzle-kit migrate
```

The scaffold expects `auth` from `src/lib/auth.ts`. Its `getUploadUser` looks like this:

```ts
import { auth } from '../auth';

export async function getUploadUser(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user ? { id: session.user.id } : null;
}
```

The generated upload routes set `requireAuth: true`. For example, `src/app/api/uploads/presign/route.ts` contains:

```ts
import { createPresignHandler } from 'octoload/nextjs';
import { uploadHandlerOptions } from '../../../../lib/octoload/server';

export const POST = createPresignHandler({
  ...uploadHandlerOptions,
  requireAuth: true,
});
```

The scaffold also creates `/api/uploads/finalize` and `/api/images/[imageId]` routes. A valid Better Auth session is required for uploads; private reads and all deletes require the matching owner. [Better Auth documents the server session API](https://better-auth.com/docs/integrations/next).

If you generated a Next.js `server.ts` with an earlier Octoload scaffold, check its `getUser` callback. The Next.js wrapper passes a `Request` directly, so it must be `(request: Request) => getUploadUser(request)`. `init` preserves your existing file when rerun.

### Upload from a Next.js client component

For example, `src/app/components/photo-upload.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { OctoloadClient } from 'octoload/client';

export function PhotoUpload() {
  const [status, setStatus] = useState('');

  async function upload(file: File) {
    const client = new OctoloadClient({ baseUrl: window.location.origin });
    try {
      const { image } = await client.uploadFile(file, {
        alt: file.name,
        onProgress: ({ percentage }) => setStatus(`Uploading ${percentage}%`),
      });
      const { url } = await client.getImage(image.id);
      setStatus(`Uploaded: ${url}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Upload failed');
    }
  }

  return (
    <>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void upload(file);
        }}
      />
      <p>{status}</p>
    </>
  );
}
```

Uploads are private by default. The client calls your app's `/api/uploads/presign` and `/api/uploads/finalize` routes, then PUTs the file directly to the bucket. `getImage` calls `/api/images/:id` and returns a signed GET URL for a private image. `uploadMultiple(files)` uploads in batches of three.

### Bucket CORS

Apply a CORS rule to the bucket so browsers at your app origin can send the signed PUT request. Replace the origin with yours:

```json
[
  {
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"]
  }
]
```

This JSON shape works in the [S3 CORS editor](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManageCorsUsing.html) and the [R2 dashboard CORS editor](https://developers.cloudflare.com/r2/buckets/cors/). Add other headers or methods if your application sends them. If you use a local development origin, add it explicitly.

## Cloudflare R2 variant

In an existing Next.js app, replace the quick start's `init` command with:

```bash
pnpm exec octoload init --framework nextjs --adapter r2 --auth better-auth
pnpm exec octoload generate --output src/db/upload-schema.ts
```

The generated `.env.example` uses `R2_REGION=auto`. Fill in your R2 bucket, API token credentials, and S3-compatible endpoint:

```dotenv
R2_BUCKET=my-images
R2_REGION=auto
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<r2-access-key-id>
R2_SECRET_ACCESS_KEY=<r2-secret-access-key>
R2_PUBLIC_BASE_URL=
```

The R2 API endpoint signs uploads; it is not a public image URL. Private uploads work with an empty `R2_PUBLIC_BASE_URL` and use signed GET URLs. To upload public images, enable public access on the bucket and set `R2_PUBLIC_BASE_URL` to its custom domain, such as `https://images.example.com`, or its enabled `r2.dev` URL. Octoload rejects public R2 uploads without that value before creating an image row. Cloudflare recommends a custom domain for production public delivery; see [R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/) and its [S3 SDK configuration](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/).

For an S3 bucket served through your own CDN, set `storage.publicBaseUrl` in the generated `config.ts` too. The scaffold does not enable public bucket access for either provider. `isPublic` is metadata, not a bucket permission change.

## React Router variant

Use `--framework react-router` with either `--adapter s3` or `--adapter r2`:

```bash
pnpm exec octoload init --framework react-router --adapter r2 --auth better-auth
pnpm exec octoload generate --output app/db/upload-schema.ts
```

This creates `app/lib/octoload/{auth,config,server}.ts` and routes for `api.uploads.presign`, `api.uploads.finalize`, and `api.images.$imageId`. Export your Drizzle `db` from `app/db/index.ts`. The Better Auth scaffold imports `auth` from `app/lib/auth.server.ts`; adjust that import if your app uses another path. Include `app/db/upload-schema.ts` in your Drizzle config and apply its migration.

## Scheduled cleanup

Presigned PUT URLs expire after one hour. Run cleanup from a trusted scheduled server job to remove old `processing` or `failed` rows and their S3/R2 objects:

```ts
import { OctoloadCore } from 'octoload';
import { db } from './db';
import * as schema from './db/upload-schema';
import { octoloadConfig } from './lib/octoload/config';

const core = new OctoloadCore(octoloadConfig, db, schema);
const result = await core.cleanupAbandonedUploads({
  olderThanMs: 2 * 60 * 60 * 1000,
  limit: 100,
});

if (result.errors.length) console.error('Upload cleanup errors', result.errors);
```

The defaults are two hours and 100 rows; `olderThanMs` must be at least one hour, and `limit` accepts 1–1000. Schedule repeated runs while `scanned` reaches the limit. Cleanup claims a stale row before deleting its object, so it cannot turn a completed upload into a deleted one. Failed deletions remain retryable.

This cleans up single PUT uploads. If you use the storage adapter's lower-level multipart methods yourself, configure an [S3 incomplete multipart lifecycle rule](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html). [R2 aborts incomplete multipart uploads after seven days by default](https://developers.cloudflare.com/r2/objects/upload-objects/).

## Limits, access, and current scope

- The generated config allows JPEG, PNG, WebP, and GIF up to 10 MiB. Change `limits.maxFileSize` and `limits.allowedTypes` in `config.ts`. PostgreSQL's `byte_size` integer column caps an upload at 2,147,483,647 bytes. Octoload enforces configured limits at presign, then compares `HeadObject` metadata at finalize. It does not inspect file contents.
- The handler takes `ownerId` from the trusted session, never from the request body. If your app accepts `orgId`, authorize that organization membership in your app before treating the image as organization owned.
- For another session provider, use `--auth custom` and replace the generated `getUploadUser` stub. The scaffold's upload routes still require a session. To allow anonymous public uploads, change those routes' `requireAuth` setting; anonymous private uploads remain disallowed.
- The generated `images.owner_id` and `images.org_id` columns are `varchar(255)` so Better Auth's string IDs work. `images.id` and `images.entity_id` remain UUIDs. For an existing database with UUID owner or organization columns, migrate them before replacing the generated schema:

  ```sql
  ALTER TABLE images ALTER COLUMN owner_id TYPE varchar(255) USING owner_id::text;
  ALTER TABLE images ALTER COLUMN org_id TYPE varchar(255) USING org_id::text;
  ```

  Review foreign keys and indexes on those columns during the migration.
- The core upload flow uses single PUT on S3 and R2. It rejects `strategy: 'multipart'` and finalize requests with `parts`. Multipart types and low-level adapter methods exist, but there is no multipart server workflow.
- The schema generator emits PostgreSQL tables. The `upload_sessions`, `asset_variants`, and `image_tags` tables are available in the schema, but the current upload flow writes only `images`. Image processing, tag writes, hooks, custom storage adapters, MySQL, and SQLite are not implemented by the core flow.

## Development

```bash
pnpm install
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm run test:docs
pnpm run test:coverage
pnpm run build
pnpm run test:package
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution steps. Licensed under [MIT](./LICENSE).

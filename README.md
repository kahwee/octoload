# Octoload

Octoload sends images directly from the browser to **Amazon S3 or Cloudflare R2**. Your app signs the upload, stores metadata in PostgreSQL through Drizzle, and decides who may read or delete each image. Octoload provides a browser client, framework handlers, a schema generator, and an optional scaffold; it is not a hosted service.

1. The browser asks your app for a signed PUT URL. Your app creates a `processing` image row in PostgreSQL.
2. The browser PUTs the bytes directly to S3 or R2.
3. The browser asks your app to finalize. Your app checks the stored object and marks its row `ready`.

The server supports single PUT uploads. It checks the stored object's size and content type before marking an image ready. These metadata checks do not inspect image bytes or verify the client-supplied SHA-256 checksum.

## Quick start: Next.js with Better Auth

You need Node.js 24+, an existing Next.js app with PostgreSQL, a Drizzle database connection, a Better Auth instance exported from `src/lib/auth.ts`, and an S3 bucket. For Cloudflare R2, use the [R2 variant](docs/integrations.md#cloudflare-r2-variant).

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

## Other setups and cleanup

See [Cloudflare R2](docs/integrations.md#cloudflare-r2-variant),
[React Router](docs/integrations.md#react-router-variant), and
[scheduled cleanup](docs/integrations.md#scheduled-cleanup) for complete setup.

The generated config permits JPEG, PNG, WebP, and GIF up to 10 MiB. Uploads use
single PUT requests; multipart server workflows and image processing are not
implemented. The [scope and access notes](docs/integrations.md#limits-access-and-current-scope)
cover ownership, organization authorization, schema limits, and migrations.

## Develop

Use Node 24+ and the pnpm version pinned in [package.json](package.json):

```sh
pnpm install --frozen-lockfile
pnpm run test:docs
```

The [contribution guide](CONTRIBUTING.md) lists source, package, and coverage
checks. `test:docs` parses TypeScript/JSON examples and typechecks the browser
component; it does not run uploads against a bucket.

[MIT license](LICENSE).

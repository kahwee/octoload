# Next.js setup with Better Auth

This guide targets Octoload 0.2.0. Use Node.js 24+; Bun is optional.

You need Node.js 24+, an existing Next.js app with PostgreSQL, a Drizzle database connection, a Better Auth instance exported from `src/lib/auth.ts`, and an S3 bucket. For Cloudflare R2, use the [R2 variant](integrations.md#cloudflare-r2-variant).

```bash
pnpm add octoload@0.2.0 drizzle-orm pg
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

Uploads are private by default. The client calls your app's `/api/uploads/presign` route, PUTs the file directly to the bucket, then calls `/api/uploads/finalize`. `getImage` calls `/api/images/:id` and returns a signed GET URL for a private image. `uploadMultiple(files)` uploads in batches of three.

### Bucket CORS

Apply a CORS rule to the bucket so browsers at your app origin can send the signed PUT request. Replace the origin with yours:

```json
[
  {
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type", "If-None-Match"]
  }
]
```

This JSON shape works in the [S3 CORS editor](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManageCorsUsing.html) and the [R2 dashboard CORS editor](https://developers.cloudflare.com/r2/buckets/cors/). Add other headers or methods if your application sends them. If you use a local development origin, add it explicitly.


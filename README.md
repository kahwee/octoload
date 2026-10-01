# Octoload

Upload images straight from your browser to **Amazon S3 or Cloudflare R2**.
Octoload connects a lightweight browser client to your app’s authentication,
PostgreSQL or SQLite metadata, and framework handlers. You own the storage and the data.

## Release status and install

**This checkout is 0.2.0, unreleased.** The npm `latest` version is still 0.1.8
(checked 2026-10-01). Its README and generated scaffolds do not match this guide,
and it does not include the upload-hardening changes below. Pushing to GitHub
does not publish a new npm package. See the [release checklist](https://github.com/kahwee/octoload/blob/main/docs/releasing.md).

Use Node.js 24+. **Bun is not required.** PostgreSQL and SQLite are supported;
choose your database when generating the schema. To try this checkout before an npm release,
build a local package with the pnpm version pinned in `package.json`:

```bash
git clone https://github.com/kahwee/octoload.git
cd octoload
pnpm install --frozen-lockfile
pnpm run build
pnpm pack --out /tmp/octoload-0.2.0.tgz
```

In your existing Next.js app with PostgreSQL, Drizzle, and Better Auth:

```bash
pnpm add /tmp/octoload-0.2.0.tgz drizzle-orm pg
pnpm add -D drizzle-kit @types/pg
pnpm exec octoload init --framework nextjs --adapter s3 --auth better-auth
pnpm exec octoload generate --output src/db/upload-schema.ts
```

The scaffold creates authenticated upload and image routes. Connect your database,
fill in the server environment, and apply the generated schema using the
[Next.js setup guide](https://github.com/kahwee/octoload/blob/main/docs/nextjs.md). `init` preserves existing files;
`generate` replaces its output file.

For SQLite, use `--dialect sqlite` with both `init` and `generate`.
See the [database guide](https://github.com/kahwee/octoload/blob/main/docs/databases.md)
for SQLite and PGlite connections and runnable examples.

## Upload an image

With the routes configured, add this Next.js client component:

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

Uploads are private by default. The client asks your app for a signed URL,
PUTs the file directly to the bucket, then finalizes the upload. Your app checks
stored size and content type before marking the image ready. Private reads use
signed GET URLs; private reads and all deletes enforce ownership through your app’s session.

`uploadMultiple(files)` uploads in batches of three.

## Configure your app

Export your database from `src/db/index.ts`:

```ts
import { drizzle } from 'drizzle-orm/node-postgres';

export const db = drizzle(process.env.DATABASE_URL!);
```

Include the generated upload schema in your Drizzle configuration:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: ['./src/db/schema.ts', './src/db/upload-schema.ts'],
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

The generated Next.js presign route uses:

```ts
import { createPresignHandler } from 'octoload/nextjs';
import { uploadHandlerOptions } from '../../../../lib/octoload/server';

export const POST = createPresignHandler({
  ...uploadHandlerOptions,
  requireAuth: true,
});
```

Allow browser PUT requests in your bucket’s CORS configuration. Replace the origin
with yours and add your local development origin if needed:

```json
[
  {
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type", "If-None-Match"]
  }
]
```

The [setup guide](https://github.com/kahwee/octoload/blob/main/docs/nextjs.md) covers environment variables, migrations, and
session wiring. Other guides cover [Cloudflare R2](https://github.com/kahwee/octoload/blob/main/docs/integrations.md#cloudflare-r2-variant),
[React Router](https://github.com/kahwee/octoload/blob/main/docs/integrations.md#react-router-variant), and
[scheduled cleanup](https://github.com/kahwee/octoload/blob/main/docs/integrations.md#scheduled-cleanup).

The scaffold allows JPEG, PNG, WebP, and GIF up to 10 MiB. The core flow supports
single PUT uploads and checks object metadata. Image-byte validation, checksum
verification, and server multipart workflows are not yet implemented. See
[limits and access](https://github.com/kahwee/octoload/blob/main/docs/integrations.md#limits-access-and-current-scope) for
storage visibility and application authorization requirements.

## Try a credential-free example

After building the checkout, run `pnpm run example:presign`. It uses dummy
credentials to show signed single-PUT headers for S3 and R2, without a bucket,
database, or network request. It is a signing example, not an end-to-end upload.
See [the example](https://github.com/kahwee/octoload/blob/main/examples/README.md).

## Develop

Use Node 24+ and the pnpm version pinned in [package.json](https://github.com/kahwee/octoload/blob/main/package.json):

```sh
pnpm install --frozen-lockfile
pnpm run test:docs
```

CI runs type, lint, format, coverage, documentation, and packed-package checks.
The [contribution guide](https://github.com/kahwee/octoload/blob/main/CONTRIBUTING.md) lists the full verification command.
The [storage harnesses](https://github.com/kahwee/octoload/blob/main/docs/testing.md) check private R2 storage with Cloudflare
`cf`, and signed uploads and replay protection with dedicated S3/R2 credentials.
Bucket uploads and database migrations need a configured integration environment.

[MIT license](https://github.com/kahwee/octoload/blob/main/LICENSE).

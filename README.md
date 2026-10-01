# Octoload

Upload images straight from your browser to **Amazon S3 or Cloudflare R2**.
Octoload connects a lightweight browser client to your app’s authentication,
PostgreSQL metadata, and framework handlers. You own the storage and the data.

## Install

Use Node.js 24+ in an existing Next.js app with PostgreSQL, Drizzle, and Better Auth:

```bash
pnpm add octoload drizzle-orm pg
pnpm add -D drizzle-kit @types/pg
pnpm exec octoload init --framework nextjs --adapter s3 --auth better-auth
pnpm exec octoload generate --output src/db/upload-schema.ts
```

The scaffold creates authenticated upload and image routes. Connect your database,
fill in the server environment, and apply the generated schema using the
[Next.js setup guide](docs/nextjs.md). `init` preserves existing files;
`generate` replaces its output file.

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

The [setup guide](docs/nextjs.md) covers environment variables, migrations, and
session wiring. Other guides cover [Cloudflare R2](docs/integrations.md#cloudflare-r2-variant),
[React Router](docs/integrations.md#react-router-variant), and
[scheduled cleanup](docs/integrations.md#scheduled-cleanup).

The scaffold allows JPEG, PNG, WebP, and GIF up to 10 MiB. The core flow supports
single PUT uploads and checks object metadata. Image-byte validation, checksum
verification, and server multipart workflows are not yet implemented. See
[limits and access](docs/integrations.md#limits-access-and-current-scope) for
storage visibility and application authorization requirements.

## Develop

Use Node 24+ and the pnpm version pinned in [package.json](package.json):

```sh
pnpm install --frozen-lockfile
pnpm run test:docs
```

CI runs type, lint, format, coverage, documentation, and built package checks.
The [contribution guide](CONTRIBUTING.md) lists the full verification command.
The [storage harnesses](docs/testing.md) check private R2 storage with Cloudflare
`cf`, and signed uploads and replay protection with dedicated S3/R2 credentials.
Bucket uploads and database migrations need a configured integration environment.

[MIT license](LICENSE).

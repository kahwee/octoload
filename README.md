# Octoload

Upload images straight from your browser to **Amazon S3 or Cloudflare R2**.
Octoload connects a lightweight browser client to your app’s authentication,
PostgreSQL or SQLite metadata, and framework handlers. You own the storage and the data.

**0.3.0** adds upload observability, cancellation, timeouts, and recovery after lost responses.
This checkout is 0.3.0, unreleased. npm `latest` is still 0.2.1; the
[GitHub release candidate](https://github.com/kahwee/octoload/releases/tag/v0.3.0)
provides the reviewed `octoload-0.3.0.tgz` package.

## Install

Use Node.js 24+. Bun is optional. Choose PostgreSQL or SQLite for metadata.

To try the release candidate in an existing Next.js app with PostgreSQL, Drizzle, and Better Auth:

```bash
pnpm add https://github.com/kahwee/octoload/releases/download/v0.3.0/octoload-0.3.0.tgz drizzle-orm pg
pnpm add -D drizzle-kit @types/pg
pnpm exec octoload init --framework nextjs --adapter s3 --auth better-auth
pnpm exec octoload generate --output src/db/upload-schema.ts
```

The scaffold creates authenticated upload and image routes. Connect your database,
fill in the server environment, and apply the generated schema using the
[Next.js setup guide](https://github.com/kahwee/octoload/blob/main/docs/nextjs.md). `init` preserves existing files;
`generate` replaces its output file.

`pnpm exec octoload migrate` generates and applies tracked Drizzle migrations;
`--generate-only` generates SQL offline for review. Existing installations should
apply the new lookup indexes using the [database upgrade guide](https://github.com/kahwee/octoload/blob/main/docs/databases.md#tracked-migrations-and-index-upgrades).

For SQLite, use `--dialect sqlite` with both `init` and `generate`.
See the [database guide](https://github.com/kahwee/octoload/blob/main/docs/databases.md)
for SQLite and PGlite connections, `init --driver pglite`, and runnable examples.

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
Public reads omit internal metadata unless the reader is the image owner.

`uploadMultiple(files)` uploads in batches of three. If a batch fails,
`UploadBatchError.outcomes` preserves successful results, individual errors, and
files not yet started. Use `onEvent` for timed
phase events, `onError` for structured failures, and `recoverUpload` to reconcile
an uncertain upload without sending the file again. See
[observability and recovery](https://github.com/kahwee/octoload/blob/main/docs/observability.md),
including the new timeout defaults and upgrade notes.

Server policy and lifecycle hooks are awaited; see
[server lifecycle hooks](https://github.com/kahwee/octoload/blob/main/docs/integrations.md#server-lifecycle-hooks) for authorization,
deletion vetoes, and post-finalize behavior.

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
single PUT uploads and checks object metadata. To keep uploads lightweight,
Octoload does not decode images: matching size and content type do not prove
that the bytes are a valid image. Keep uploads private and authenticated; apps
needing content validation can add it separately. Decoding is future work.
Browser checksum computation is disabled by default; `calculateChecksum: true`
adds unverified SHA-256 metadata. Checksum verification and server multipart workflows are not implemented. See
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

CI runs type, lint, format, coverage, documentation, packed-package, and browser E2E checks.
The [contribution guide](https://github.com/kahwee/octoload/blob/main/CONTRIBUTING.md) lists the full verification command.
The [storage harnesses](https://github.com/kahwee/octoload/blob/main/docs/testing.md) check private R2 storage with Cloudflare
`cf`, and signed uploads and replay protection with dedicated S3/R2 credentials.
The browser suite runs without credentials against local HTTP storage, or against a dedicated R2 bucket with test credentials. See the testing guide for commands and verified boundaries.

[MIT license](https://github.com/kahwee/octoload/blob/main/LICENSE).

## CI maintenance

[GitHub Actions maintenance](https://github.com/kahwee/octoload/blob/main/.github/ACTIONS.md) covers workflows, parallel checks, action versions, and weekly updates.

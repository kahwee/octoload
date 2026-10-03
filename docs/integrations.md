# Storage, framework, and cleanup guides

Start with the [Next.js setup guide](nextjs.md).
The same upload lifecycle applies to S3 and R2.

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

For an S3 bucket served through your own CDN, set `storage.publicBaseUrl` in the generated `config.ts` too. The scaffold does not enable public bucket access for either provider. `isPublic` is metadata, not a bucket permission change. Use separate buckets and configurations for public and private uploads; keep private objects off publicly readable buckets and domains.

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

- The generated config allows JPEG, PNG, WebP, and GIF up to 10 MiB. Change `limits.maxFileSize` and `limits.allowedTypes` in `config.ts`. PostgreSQL's `byte_size` integer column caps an upload at 2,147,483,647 bytes. Octoload enforces configured limits at presign, then compares `HeadObject` metadata at finalize. The PUT signature binds the declared byte size and content type and requires `If-None-Match: *`, so an existing object cannot be overwritten through that URL. Custom clients must send every returned upload header; browsers set `Content-Length` automatically from the file body. Add `If-None-Match` to bucket CORS allowed headers. It does not inspect file contents.
- The handler takes `ownerId` from the trusted session, never from the request body. If your app accepts `orgId`, authorize that organization membership in your app before treating the image as organization owned.
- For another session provider, use `--auth custom` and replace the generated `getUploadUser` stub. The scaffold's upload routes still require a session. To allow anonymous public uploads, change those routes' `requireAuth` setting; anonymous private uploads remain disallowed.
- The generated `images.owner_id` and `images.org_id` columns are `varchar(255)` so Better Auth's string IDs work. `images.id` and `images.entity_id` remain UUIDs. For an existing database with UUID owner or organization columns, migrate them before replacing the generated schema:

  ```sql
  ALTER TABLE images ALTER COLUMN owner_id TYPE varchar(255) USING owner_id::text;
  ALTER TABLE images ALTER COLUMN org_id TYPE varchar(255) USING org_id::text;
  ```

  Review foreign keys and indexes on those columns during the migration.
- The core upload flow uses single PUT on S3 and R2. It rejects `strategy: 'multipart'` and finalize requests with `parts`. Multipart types and low-level adapter methods exist, but there is no multipart server workflow.
- The schema generator emits PostgreSQL tables by default and SQLite tables with `--dialect sqlite`; see [database setup](databases.md). The `upload_sessions`, `asset_variants`, and `image_tags` tables are available in the schema, but the current upload flow writes only `images`. Image processing, tag writes, custom storage adapters and MySQL are not implemented by the core flow.

## Server lifecycle hooks

`config.hooks.beforePresign` is awaited before database writes or URL signing.
It receives validated upload metadata and a `user: { id }` derived from the
trusted owner (undefined for anonymous uploads). Throw to deny the upload, or
return adjusted metadata; the result is validated against the schema and limits.
The hook cannot replace the session-derived `ownerId`.

`config.hooks.onDelete` runs after ownership checks and before changing the row
or deleting storage. Throwing vetoes deletion. It can run again on retries.
`config.hooks.afterFinalize` runs after the successful transition to `ready`.
A failure is reported, but does not roll back the committed upload; owner
reconciliation returns that ready image without replaying the hook. These hooks
are awaited and errors propagate, unlike telemetry observers. HTTP responses
hide hook errors; the handler's trusted `onError` receives the underlying cause.
Hook delivery is not durable: use an application outbox for guaranteed downstream
work. Scheduled abandoned-upload cleanup does not invoke `onDelete`.
Variant processing is unsupported; configuring `onProcessVariant` throws.

## Content-validation tradeoff

Octoload checks declared size and content type, without downloading or decoding
image bytes. This keeps the direct-upload flow lightweight and avoids image
processing dependencies, server bandwidth, and decoder resource management.
An authenticated uploader can therefore store arbitrary bytes with the expected
size and an allowed image content type; even a `ready` image can be unreadable.
Private ownership checks and size limits still apply, but do not validate content.

Keep upload routes authenticated, use private storage by default, and set size
and type limits appropriate for your app. Applications that process or publish
untrusted images should add their own bounded validation before those operations.
Image-byte decoding and validation are not implemented. Add an application-level
validator before publishing content when that guarantee is required.

## Upload integrity and upgrades

Single-PUT upload URLs now require a signed `If-None-Match: *` header. A repeat PUT
to an existing key fails rather than replacing its bytes. Upload attempts with a
different declared size or content type fail signature validation. Update bucket
CORS to allow `Content-Type` and `If-None-Match`; the browser client forwards both.
Custom clients must forward the returned `headers` (or adapter `fields`) unchanged.
The low-level adapter accepts an optional fourth `byteSize` argument; the core
always supplies it.

Reads through Octoload require a `ready` record. Metadata updates accept only
`alt` (up to 500 characters) and `title` (up to 255), rejecting extra fields at runtime.
Public reads by guests or other users return only ID, content type, byte size,
status, public URL, alt text, title, visibility, and timestamps. Owner IDs,
organization/entity associations, filenames, storage keys, and checksums are
omitted. Owners still receive the full record, including for their public images.
The core and browser `getImage` return `ImageReadRecord`; owner-only fields are
optional in that type. Upload/finalize results still use `ImageRecord`.

These changes protect newly issued URLs. Previously issued URLs remain usable
until their original expiry. Conditional PUT prevents replacement while an object
exists; deleting the object permits its recreation until the PUT URL expires.
Database deletion removes application access, but this is not token revocation.
Keep private buckets private and use storage lifecycle rules for orphan cleanup.
Public bucket URLs bypass application readiness and ownership checks entirely.

Run the [adversarial storage harness](testing.md) against a disposable bucket
when upgrading or changing provider configuration.

Upload event hooks, structured failures, timeouts, and recovery are covered in
[observability and recovery](observability.md).

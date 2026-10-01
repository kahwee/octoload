# Examples

From the repository root, after installing the pinned pnpm dependencies:

```sh
pnpm run build
pnpm run example:presign
```

`presign.mjs` imports the public package and signs a single-PUT URL for both S3
and R2. It uses intentionally fake credentials, prints the required headers,
and checks that byte size, content type, and create-only behavior are signed.
It sends no requests and requires no account or bucket.

For a real upload application, follow the [Next.js setup](../docs/nextjs.md).
That path requires PostgreSQL or SQLite, session authentication, server-side storage
credentials, a dedicated bucket, and bucket CORS. The browser client needs
`XMLHttpRequest` and Web Crypto; this Node example does not exercise browser
uploads, database migrations, or provider acceptance of the signed URL.

You can also run this example with `bun examples/presign.mjs` after a Node/pnpm
build. See the [runtime verification notes](../docs/testing.md#runtime-coverage)
for the exact compatibility scope. Bun does not replace the pinned pnpm workflow.

## Disposable database examples

```sh
node examples/database.mjs sqlite
node examples/database.mjs pglite
```

These apply the generated schema to real in-memory databases and create a private
processing record through Octoload with dummy storage credentials. They send no
upload requests. See [database connections](../docs/databases.md) and
[actual upload testing](../docs/testing.md).

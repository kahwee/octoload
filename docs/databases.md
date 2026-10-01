# PostgreSQL and SQLite

Octoload uses your Drizzle connection. Generate the schema for the database you
run; the upload client and framework routes stay the same. PostgreSQL remains
the default. PGlite uses the PostgreSQL schema.

| Database | Schema flag | Tested connection |
| --- | --- | --- |
| PostgreSQL / PGlite | `--dialect postgresql` | `drizzle-orm/pglite` for local tests |
| SQLite | `--dialect sqlite` | `drizzle-orm/libsql` with local SQLite |

## SQLite in an existing app

```sh
pnpm add @libsql/client drizzle-orm
pnpm add -D drizzle-kit
pnpm exec octoload init --framework nextjs --adapter r2 --dialect sqlite
pnpm exec octoload generate --dialect sqlite --output src/db/upload-schema.ts
```

Export your database from `src/db/index.ts`:

```ts
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './upload-schema';

const client = createClient({ url: process.env.DATABASE_URL! });
await client.execute('PRAGMA foreign_keys = ON');
export const db = drizzle(client, { schema });
```

Set `DATABASE_URL=file:./uploads.db`, then generate and apply migrations with
your usual Drizzle workflow. `init` emits a SQLite Drizzle config; if you already
have a config it preserves it, so update its dialect, schema paths and URL yourself.
Enable foreign keys on every connection so child rows cascade when images are
deleted. Keep local database files outside source control. Store storage credentials
on the server and connect the generated auth callback to your session provider.

SQLite IDs are UUID text, booleans are integers, and dates are milliseconds
mapped to JavaScript `Date` values. CHECK constraints enforce enum and boolean
rules; text-length and UUID validation run at the API boundary, unlike PostgreSQL
column constraints. The two schemas share the upload row shape, not interchangeable migrations.
SQLite writes serialize; test contention under your application's workload.

## PGlite for PostgreSQL development

```ts
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from './upload-schema';

const client = new PGlite();
export const db = drizzle(client, { schema });
```

Install `@electric-sql/pglite` in that application and apply PostgreSQL migrations
before serving routes. `new PGlite()` is disposable; choose persistent storage
when needed. Our PGlite tests exercise the PostgreSQL engine and SQL, but do not
establish network PostgreSQL pooling or multi-process locking behavior.

## Runnable examples and checks

From this repository, after `pnpm install --frozen-lockfile` and `pnpm build`:

```sh
node examples/database.mjs sqlite
node examples/database.mjs pglite
pnpm test:db:pglite
```

Both examples create an in-memory database, apply migrations derived from the
actual schema, and use Octoload to create a private processing record. They sign
with dummy credentials and send no upload requests. For actual uploads and
adversarial coverage, see [testing](testing.md).

Choose the dialect for a new database. Switching an existing PostgreSQL app to
SQLite requires a reviewed export/import, foreign-key ordering, date conversion,
and row-count checks; `generate` does not migrate existing data between engines.
MySQL and hosted SQLite-specific runtimes are outside the verified support matrix.

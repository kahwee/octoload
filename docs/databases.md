# PostgreSQL, PGlite and SQLite

Octoload uses your Drizzle connection. Generate the schema for the database you
run; the upload client and framework routes stay the same. PostgreSQL remains
the default. PGlite uses the PostgreSQL schema.

| Database | Schema flag | Connection |
| --- | --- | --- |
| PostgreSQL | `--dialect postgresql` (default) | Network PostgreSQL through Drizzle |
| PGlite | `--driver pglite` with PostgreSQL schema | `drizzle-orm/pglite` |
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

## PGlite in an existing app

PGlite uses the PostgreSQL schema. The explicit scaffold below is available in
0.2.1; install it as described in the [README](../README.md#install).
The 0.2.0 core already accepts a manually connected PGlite Drizzle database.

```sh
pnpm add @electric-sql/pglite drizzle-orm
pnpm add -D drizzle-kit
pnpm exec octoload init --framework nextjs --adapter r2 --driver pglite
pnpm exec octoload generate --output src/db/upload-schema.ts
```

Set `DATABASE_URL=./uploads-pglite` in `.env`, then run `pnpm exec octoload migrate`
with your application stopped. The scaffold emits a persistent PGlite database
module, a PostgreSQL Drizzle config with `driver: 'pglite'`, and an ignore rule
for the default data directory. It loads `.env` for migrations without requiring
an extra dotenv package. Existing database modules, config and environment
values are preserved; merge the shown settings yourself when they already exist.

The connection is:

```ts
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from './upload-schema';

const dataDir = process.env.DATABASE_URL;
if (!dataDir) throw new Error('DATABASE_URL must identify a persistent PGlite directory');
export const client = new PGlite(dataDir);
export const db = drizzle(client, { schema });
```

Use one application process and one PGlite instance per data directory; stop it
before migrations. `new PGlite()` without a directory is disposable, so the
scaffold rejects a missing path. Choose persistent storage and backups for
non-test data, and add ignore rules for custom paths. PGlite is an embedded
PostgreSQL engine; its tests do not establish network pooling, multiple server
processes sharing a directory, or browser-hosted upload handlers.

## Runnable examples and checks

From this repository, after `pnpm install --frozen-lockfile` and `pnpm build`:

```sh
node examples/database.mjs sqlite
node examples/database.mjs pglite
node examples/persistent-database.mjs sqlite
node examples/persistent-database.mjs pglite
pnpm test:db:pglite
```

The `database.mjs` examples create an in-memory database, apply migrations derived from the
actual schema, and use Octoload to create a private processing record. They sign
with dummy credentials and send no upload requests. For actual uploads and
adversarial coverage, see [testing](testing.md). The persistence examples create
a temporary disk database, close and reopen it, verify the same private record
and Date/boolean values, and remove it afterward. They send no upload requests.

Choose the dialect for a new database. Switching an existing PostgreSQL app to
SQLite requires a reviewed export/import, foreign-key ordering, date conversion,
and row-count checks; `generate` does not migrate existing data between engines.
MySQL and hosted SQLite-specific runtimes are outside the verified support matrix.

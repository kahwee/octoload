# Testing Octoload

Run the [full verification command](../CONTRIBUTING.md#development-commands)
before pushing. Unit and handler tests exercise ownership, metadata validation,
upload state, and client behavior; package smoke tests check built exports and
generated scaffolds. Coverage shows exercised branches, not provider fidelity.

## Authenticated Cloudflare CLI smoke test

With the authenticated `cf` CLI installed, set `CLOUDFLARE_ACCOUNT_ID` and
`OCTOLOAD_TEST_BUCKET` to an explicit account and dedicated private test bucket,
then run:

```bash
pnpm test:storage:cf
```

This uses `cf`, not Wrangler. It checks that r2.dev and custom domain public
access are disabled, uploads a small PNG, downloads and compares every binary
byte, deletes the test object, and requires provider HTTP 404/code 10007 on the
next read. Each run uses a random `octoload-cli-harness/` key and a temporary
file with mode 0600. Cleanup runs after failed uploads or byte comparisons;
cleanup failures report only the key for manual removal. CLI output is captured,
and unexpected provider errors are suppressed. Each CLI call has a 15-second
timeout; checks share a 45-second budget with a separate cleanup allowance.

The CLI smoke test proves real authenticated R2 REST upload/read/delete behavior.
It does not exercise Octoload's adapter, S3 presigned URLs, conditional writes,
browser CORS, or handlers. Use the storage harness below for those signatures.
`pnpm test:harness` also checks the CLI harness against a fake executable for
public-bucket refusal, successful cleanup, byte mismatch, and authorization
failure after deletion. These checks test the harness, not Cloudflare itself.

## Real storage harness

Use a dedicated test bucket with an account allowed to put, read, and delete
objects. Build first, then run:

```bash
pnpm build
pnpm test:storage:live
```

Set these environment variables through your local secret manager or CI secrets:

| Variable | Value |
| --- | --- |
| `OCTOLOAD_TEST_ADAPTER` | `s3` or `r2` |
| `OCTOLOAD_TEST_BUCKET` | Dedicated test bucket |
| `OCTOLOAD_TEST_REGION` | AWS region, or `auto` for R2 |
| `OCTOLOAD_TEST_ENDPOINT` | R2 account S3 endpoint; required for R2 |
| `OCTOLOAD_TEST_ACCESS_KEY_ID` | Test account access key |
| `OCTOLOAD_TEST_SECRET_ACCESS_KEY` | Test account secret |
| `OCTOLOAD_TEST_SESSION_TOKEN` | Optional temporary credential token |

The harness uses the built adapter and actual HTTP requests. It uploads a small
PNG, verifies its bytes, checks that replay with different bytes returns HTTP
412, and verifies the original bytes again. Separate fresh keys test missing and
tampered conditional headers and a different byte size, avoiding false positives
from an already occupied key. Unsupported provider behavior fails the run.

Each run uses a random `octoload-harness/` prefix and attempts cleanup even on
failure. Requests time out after 15 seconds, the checks share a 45-second budget,
and cleanup has a separate 10-second budget. Failed cleanup reports the prefix
for manual removal. Signed URLs, credentials, and provider response bodies are
never printed. No default AWS profile or implicit bucket is used.

This harness needs live credentials; a missing configuration fails before any
storage requests. Run it against each supported provider before a storage release.
It does not exercise browser CORS, the database, or framework handlers.

## Database adversaries

`pnpm test` includes real local SQLite tests using libSQL and migrations generated
from the SQLite template. They exercise the private lifecycle, ownership, rejected
metadata escalation, timestamp and boolean decoding, competing finalizations,
cleanup retries, enum checks, foreign keys, and cascading deletes. Storage is
stubbed in these tests.

After building, run `pnpm test:db:pglite`. This uses PGlite's PostgreSQL engine,
with migrations generated from the PostgreSQL template. Tests cover real SQL
constraints, hostile owner strings as bound parameters, cross-user isolation,
12 competing finalizations, cleanup/finalize races and cleanup retries. Storage
is stubbed unless the live mode below is explicitly enabled.

For a real R2 upload through the database-backed core:

```sh
OCTOLOAD_DB_TEST_LIVE_R2=1 node --env-file=.env.r2-test --test scripts/test-db-pglite.js
```

For the matching SQLite + R2 lifecycle, run:

```sh
node --env-file=.env.r2-test --test scripts/test-db-sqlite-live.js
```

Both live database tests upload an actual PNG, finalize via R2 HeadObject and database
SQL, download and compare bytes, check replay rejection, and delete both
object and database row. Use a local ignored credentials file with mode 0600;
never commit it. PGlite runs an actual PostgreSQL engine without a network server,
so these checks do not prove connection pooling or multi-process isolation.

## Bounded live R2 attacks

```sh
node --env-file=.env.r2-test scripts/test-storage-adversarial.js
```

This opt-in harness uses only random keys in the dedicated test bucket. It sends
64 single-position signature mutations, changes expiry/date/credential/key/type,
tries an empty body and unsigned/forged reads, and races 12 PUTs against one key.
Exactly one PUT must win; the other eleven must return 412 and leave winning
bytes unchanged. Rejected mutations must leave their fresh object absent. It
also confirms the content-validation boundary: same-size non-image bytes are
accepted. This is an intentional lightweight-upload tradeoff, documented in
[content validation](integrations.md#content-validation-tradeoff), rather than a
claim that accepted files are decodable images. This is a bounded mutation suite, not exhaustive brute force or load
testing. Requests have 15-second timeouts, a 90-second overall budget and separate
cleanup time. The harness prints only case results, never signed URLs or keys.

## Review regressions in 0.2.1

The main Vitest suite runs fault and race tests against both SQLite and PGlite.
A SQL deletion failure or storage outage must leave an image failed and hidden,
never ready with a deleted object; retry must remove it. Deletion must claim the
row before storage effects and prevent a concurrent finalize from restoring
ready status. Metadata updates losing a deletion race must return not-found.
These ten cases fail against the prior core and pass with the fixes.

HTTP regressions exercise primitive/malformed JSON, provider/driver/authentication
errors, both framework adapters and rejected route parameters. Unexpected errors
return a generic 500; client validation returns 400; private missing/denied reads
share a 404. Responses containing signed URLs or private metadata use `no-store`.
The 0.2.1 regressions check that XHR abort and timeout events reject the upload
and skip finalization. Version 0.3.0 adds an AbortSignal cancellation API and
configurable timeout durations; see [observability](observability.md).

Disk reopen examples verify persistence for both databases. The packed-package
smoke test also runs the actual CLI against persistent SQLite and PGlite databases:
offline generation without `DATABASE_URL`, a tracked upgrade from the previous
unindexed schema, execution of custom migration SQL, repeat application, row
preservation, unique storage-key enforcement, and installed index checks. SQLite
query plans verify index usage for upload lookups, listings, and cleanup.
Applying migrations requires a configured connection.

## Browser E2E

Build the package, install Chromium once, then run the browser suite:

```sh
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

This launches a real Next.js app on `http://localhost:4317`, applies the generated
SQLite migrations to a disposable database, and uses opaque HttpOnly session
cookies with two test users. The browser uses the built client and Next.js
adapters. The default storage endpoint is a local HTTP fixture: it exercises
CORS and conditional PUT, but does not validate SigV4 signatures. CI runs this
suite on Node 24. Test session/control endpoints are local fixtures, not code to
deploy or a replacement for testing your application's authentication provider.

To run the same suite against the dedicated private R2 bucket:

```sh
OCTOLOAD_E2E_ENV_FILE=.env.r2-test pnpm test:e2e:live
# Repeat all scenarios to look for intermittent failures; no automatic retries.
OCTOLOAD_E2E_ENV_FILE=.env.r2-test pnpm test:e2e:live --repeat-each=5
```

Use the `OCTOLOAD_TEST_*` variables documented above. Live mode requires
`OCTOLOAD_TEST_ADAPTER=r2` and fails if configuration is missing. Environment
files are never loaded by default. Keep the credentials file ignored and private.
The harness does not change bucket configuration. Configure bucket CORS to allow
`http://localhost:4317`, methods `PUT`, `GET`, and `HEAD`, and headers
`Content-Type` and `If-None-Match`. `OCTOLOAD_E2E_PORT` changes the port; adjust
CORS to match. A passing Node storage test does not prove browser CORS works.

Scenarios cover private upload/read/delete, byte comparison, cross-user denial,
request/upload correlation, throwing hooks, interruption, cancellation, timeout,
session expiry, three concurrent uploads, and lost successful PUT/finalize
responses. Fault tests deliberately interrupt selected requests; the successful
live path makes actual browser requests to R2 without interception. Recovery
must not replay PUT or announce success before finalize.

Each test deletes its own isolated database's uploads. A shutdown cleanup pass
attempts removal of leftover objects with a separate ten-second storage budget;
failed cleanup preserves the temporary database and reports its path. Never
point this harness at your application database. Build output and test results
stay in ignored `tmp/`. Failures attach safe upload event JSON; raw network
tracing is off because traces contain credentials and signed URLs. Only enable
traces locally when you can protect those artifacts.

Network PostgreSQL pooling, multiple application processes, a full React Router
application, and deployed third-party session providers remain separate
integration checks. PGlite and SQLite core tests cover both SQL dialects; browser
E2E currently uses Next.js and SQLite with a test session provider.

After building, `pnpm test:harness` checks the harness itself against a local HTTP
fixture: missing configuration, a successful lifecycle, detection of incorrectly
accepted replay, and cleanup after failure. The fixture checks HTTP behavior and
signed-header declarations; it does not verify SigV4 cryptography or establish
that S3/R2 enforce the signatures. Live provider runs remain necessary.

Conditional writes protect objects while their keys exist. Deleting an object
does not revoke its signed PUT URL: it can recreate that key until expiry.
Applications needing revocation should retain a key/tombstone through expiry or
use a server-controlled upload path. The harness does not claim to solve this
provider limitation or validate image bytes.

## Runtime coverage

Node.js 24+ is the documented runtime. Bun is not required. Development and
release builds use the exact pnpm version in `package.json` and its lockfile.

The credential-free example and packed-package smoke can also be run under Bun:

```sh
pnpm run build
bun examples/presign.mjs
bun scripts/smoke-built.js
```

These commands passed with Bun 1.4.2 on 2026-10-01 after a Node 24.19.0 build.
Keep `pnpm` on PATH for the smoke test's pack step. This verifies Bun package
imports, CLI scaffolding, and local S3/R2 signing only. It does not establish
Bun-hosted Next.js/React Router, PostgreSQL driver, browser upload, or live bucket
compatibility. The browser upload client uses `XMLHttpRequest` and Web Crypto;
Node/Bun server scripts do not provide its full browser environment.

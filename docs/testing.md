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
SQL, download and compares bytes, check replay rejection, and delete both
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
Browser XHR abort and timeout events reject the upload and skip finalization;
this does not add a cancellation API or configure a timeout duration.

Disk reopen examples verify persistence for both databases. The PGlite scaffold
has also been checked with real `drizzle-kit generate` and `push` using only
`.env`, then reopening all four tables. Offline migration generation still works
without `DATABASE_URL`; applying migrations requires a configured connection.

## Remaining integration layers

Browser CORS, framework routes with a real session provider, network PostgreSQL
pooling, and multiple application processes still need deployment-level checks.
Add browser tests against that stack for progress, cancellation, required headers,
and CORS. The current real database plus R2 lifecycle runs through the core, not
an HTTP framework handler or browser.

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

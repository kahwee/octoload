# Testing Octoload

Run the [full verification command](../CONTRIBUTING.md#development-commands)
before pushing. Unit and handler tests exercise ownership, metadata validation,
upload state, and client behavior; package smoke tests check built exports and
generated scaffolds. Coverage shows exercised branches, not provider fidelity.

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

## Next harness layers

Add a disposable PostgreSQL database and run presign → PUT → finalize → read →
delete through real handlers, including cross-user access and failed storage
responses. Then add browser tests against that stack for progress, cancellation,
required headers, and CORS. Those layers complement the provider harness and the
fast offline regression suite.

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

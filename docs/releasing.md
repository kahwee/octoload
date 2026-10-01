# Release checklist

## 0.2.0 release scope

**0.2.0 was published on 2026-10-01 and verified as npm `latest`.** The registry
tarball matched the reviewed artifact byte-for-byte, and a fresh Node 24 consumer
installed it and passed ESM/CJS imports, CLI version and both dialect scaffolds.
The GitHub release is [v0.2.0](https://github.com/kahwee/octoload/releases/tag/v0.2.0).

0.2.0 adds SQLite alongside PostgreSQL and includes the earlier upload hardening.
The source and release artifact are verified separately from npm publication.
Mark the changelog released only after the registry confirms success.

Current scope is single-PUT S3/R2 image uploads, PostgreSQL/SQLite metadata, and
Next.js/React Router scaffolds. Decoding, checksum verification, multipart server
workflows, hooks, tag writes, custom storage providers and MySQL remain future
work. See [accepted tradeoffs](#accepted-scope-and-future-work).

## Before an authorized release

1. Use Node 24+ and the exact pnpm version in `package.json`. Install with the
   frozen lockfile and run the full [contribution checks](../CONTRIBUTING.md).
2. Review the actual tarball with `pnpm pack --out /tmp/octoload-0.2.0.tgz`.
   `test:package` packs, extracts, and loads the public exports from a temporary
   consumer, checks the CLI version/scaffolds, and verifies shipped guides and
   the signing example. It does not contact a bucket or publish anything.
3. Verify the [live storage harness](testing.md) and real browser CORS flow with
   dedicated S3/R2 test resources. Offline tests cannot establish provider or
   deployment compatibility. Do not use customer or production data for a test.
4. Check `pnpm view octoload version` and `pnpm view octoload dist-tags` again.
   Decide the release version and update `package.json`, this page, the README,
   install examples, and the changelog together. Mark the changelog released only
   when publication actually succeeds.
5. Obtain explicit authorization to publish the reviewed artifact. Use the
   account's normal npm authentication flow; never put credentials in the repo.
6. After publication, verify the npm version/dist-tag, downloaded tarball,
   rendered README, package exports, and CLI version. Verify the install instructions match the published version.

A successful publish can precede install availability while npm runs its
[publish-time scan](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/).
Wait for the version and tarball to appear, verify integrity, and then finalize
release status. Do not retry publication merely because the first read is 404.

## Repository About text

Suggested description: “Browser-to-S3/R2 single-PUT image uploads with PostgreSQL or SQLite
metadata and Next.js/React Router scaffolds.”

Suggested topics: `image-upload`, `s3`, `cloudflare-r2`, `postgresql`, `sqlite`, `drizzle`,
`nextjs`, `react-router`, `typescript`.

Changing the GitHub About panel requires repository settings access; committing
this file does not update those settings.

## 0.2.0 database release plan

1. Prepare one additive feature release: keep PostgreSQL as the default, add
   `--dialect sqlite` to initialization and generation, and preserve all four
   public entry points. Include the unreleased 0.1.9 security changes.
2. Gate on the full checks, SQLite and PGlite migrations/lifecycle/race tests,
   runnable examples, and packed CLI generation for both dialects on Node 24/26.
   Review the Drizzle database type declarations from an external consumer.
3. Run signed upload and database-backed lifecycle tests against private R2.
   Verify browser CORS and real framework session wiring before recommending a
   deployment. Test network PostgreSQL connection pooling separately; PGlite is
   engine coverage, not a server topology test. Repeat the provider harness on S3
   before claiming live S3 parity.
4. Review the tarball and install it in a clean application for each dialect.
   Driver packages belong to the application; adding SQLite must not force
   PostgreSQL users to install a SQLite driver. Review FK enablement, timestamp
   representation, cleanup retries, and upgrade instructions.
5. Publish only after explicit authorization and successful gates. Verify npm's
   artifact, imports, CLI version and generated schemas, then tag/changelog using
   the repository's release convention. Keep release candidates distinct from published versions.

Existing PostgreSQL applications keep their schema and migrations. SQLite is a
choice for new databases; cross-engine data migration needs a separate reviewed
export/import. Image decoding, checksum verification and upload revocation after
object deletion remain outside this feature. See [database setup](databases.md)
and [test coverage](testing.md) for the verified boundaries.

## Publishing setup verified

The `kahwee` npm account is listed as the maintainer. Use interactive npm authentication for local publishing. The 0.2.0 tarball passed this non-publishing rehearsal:

```sh
pnpm pack --out /tmp/octoload-0.2.0.tgz
pnpm publish /tmp/octoload-0.2.0.tgz --dry-run --ignore-scripts --access public --tag next
```

Use the pinned pnpm to publish: direct `npm publish` in this checkout fails the
intentional `devEngines.packageManager` requirement. `--ignore-scripts` here is
for a built, previously verified tarball; it does not replace the full checks.
After release authorization and an interactive npm login/2FA, the corresponding
publish command removes `--dry-run`. Publishing with `--tag next` leaves `latest`
on the existing version for preview evaluation; promotion is a separate action.
A dry run does not prove that registry authentication or publication will succeed.

For repeatable releases, configure [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
for this repository and a dedicated manual GitHub Actions workflow. It provides
short-lived OIDC credentials and automatic provenance. The workflow and npm
trusted-publisher binding are not configured yet. Do not add persistent R2 or npm
credentials to the repository while setting this up.

## Accepted scope and future work

0.2.0 deliberately validates object metadata rather than decoding image bytes.
Same-size non-image payloads can be accepted; the live adversarial harness proves
this boundary. Keeping the flow lightweight avoids decoder dependencies, server
downloads and resource policies. See the [content-validation tradeoff](integrations.md#content-validation-tradeoff).
Decoding is future work, not a gate for this release. Keep private defaults,
authentication, and configured size/type limits; applications can add validation
before processing or publishing untrusted content.

Focus remaining integration work on browser CORS and real session-authenticated
framework routes through upload, finalize, read and delete. Consider an optional,
bounded image validator later, with explicit pixel/frame/time limits and failure
handling, when applications need it.

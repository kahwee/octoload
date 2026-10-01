# Release checklist

## Source and npm are separate

The source manifest and changelog target **0.2.0 (unreleased)**. npm `latest` is
**0.1.8**, verified on 2026-10-01. The npm README still describes unsupported
features and older CLI output. A GitHub push does not update that README or
publish the fixes. Until a release is explicitly approved, use the source
package steps in the [README](../README.md#release-status-and-install).

Current scope is browser single-PUT uploads to S3/R2, PostgreSQL or SQLite metadata, and
Next.js/React Router scaffolds. Multipart server workflows, checksum verification,
image-byte validation, hooks, tag writes, custom storage providers and MySQL are not implemented. A client-supplied checksum is metadata, not proof
that the uploaded bytes match it.

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
   rendered README, package exports, and CLI version. Then replace the temporary
   source-package install instructions with the verified npm release.

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
   the repository's release convention. Until then, 0.2.0 is prepared and unreleased.

Existing PostgreSQL applications keep their schema and migrations. SQLite is a
choice for new databases; cross-engine data migration needs a separate reviewed
export/import. Image decoding, checksum verification and upload revocation after
object deletion remain outside this feature. See [database setup](databases.md)
and [test coverage](testing.md) for the verified boundaries.

# Release checklist

## Source and npm are separate

The source manifest and changelog target **0.1.9 (unreleased)**. npm `latest` is
**0.1.8**, verified on 2026-10-01. The npm README still describes unsupported
features and older CLI output. A GitHub push does not update that README or
publish the fixes. Until a release is explicitly approved, use the source
package steps in the [README](../README.md#release-status-and-install).

Current scope is browser single-PUT uploads to S3/R2, PostgreSQL metadata, and
Next.js/React Router scaffolds. Multipart server workflows, checksum verification,
image-byte validation, hooks, tag writes, custom storage providers, MySQL, and
SQLite are not implemented. A client-supplied checksum is metadata, not proof
that the uploaded bytes match it.

## Before an authorized release

1. Use Node 24+ and the exact pnpm version in `package.json`. Install with the
   frozen lockfile and run the full [contribution checks](../CONTRIBUTING.md).
2. Review the actual tarball with `pnpm pack --out /tmp/octoload-0.1.9.tgz`.
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

Suggested description: “Browser-to-S3/R2 single-PUT image uploads with PostgreSQL
metadata and Next.js/React Router scaffolds.”

Suggested topics: `image-upload`, `s3`, `cloudflare-r2`, `postgresql`, `drizzle`,
`nextjs`, `react-router`, `typescript`.

Changing the GitHub About panel requires repository settings access; committing
this file does not update those settings.

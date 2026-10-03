# Releasing Octoload

## Current candidate

The 0.3.0 candidate adds upload observability, cancellation, configurable
timeouts, and explicit recovery. It includes browser E2E coverage through
Next.js, test sessions, SQLite, and real R2. See the [changelog](../CHANGELOG.md)
and [upgrade notes](observability.md#upgrading-from-02x).

npm `latest` remains 0.2.1 until registry publication is verified. A GitHub
release candidate and attached tarball do not imply npm publication. Keep the
changelog marked unreleased and document tarball installation while npm is
pending. Previous npm releases are [0.2.1](https://github.com/kahwee/octoload/releases/tag/v0.2.1)
and [0.2.0](https://github.com/kahwee/octoload/releases/tag/v0.2.0).

## Prepare and audit

1. Use Node 24+ and the exact pnpm version in `package.json`. Install with
   `pnpm install --frozen-lockfile`, install Chromium with
   `pnpm exec playwright install chromium`, and run the full
   [contribution checks](../CONTRIBUTING.md#development-commands).
2. Run `pnpm audit --prod` and `pnpm audit`. Investigate findings; an empty
   advisory report does not replace a source or authorization review.
3. Review ownership, private defaults, conditional PUT, finalize races, error
   redaction, observer isolation, cancellation, and recovery. Check package
   exports and generated scaffolds for both frameworks and SQL dialects.
4. Run [live storage/database and browser tests](testing.md) with dedicated test
   resources. R2 results do not establish live S3 parity. Browser tests use a
   local test session provider; check deployed authentication and network
   PostgreSQL separately.
5. Check `pnpm view octoload version dist-tags` and existing GitHub tags before
   choosing a version. Update the manifest, README, setup guide, changelog, and
   upgrade notes together. Keep historical version references when meaningful.
6. Pack and review the exact artifact:

   ```sh
   pnpm pack --out /tmp/octoload-0.3.0.tgz
   tar -tzf /tmp/octoload-0.3.0.tgz
   sha512sum /tmp/octoload-0.3.0.tgz
   pnpm publish /tmp/octoload-0.3.0.tgz --dry-run --ignore-scripts --access public --tag next
   ```

   `test:package` checks packed exports, declarations, CLI version, scaffolds,
   shipped guides, and the signing example. Also install the reviewed tarball
   into a clean temporary consumer. Confirm that no credentials, test fixtures,
   QA logs, or source maps containing private data are present.
7. Commit the reviewed source and docs and wait for CI. A GitHub candidate may
   attach the tarball and SHA512 checksum under an explicitly marked prerelease.
   Tag the exact tested commit. Keep generated `dist/` and QA logs out of git.

## Publish to npm when authorized

Use the account's normal npm login/2FA flow; never store credentials in the
repository. `pnpm whoami` verifies the current authenticated account. A dry run
does not prove publish authorization. Use pinned pnpm because this repository's
`devEngines.packageManager` rejects a different package manager.

Publish the previously built and verified tarball with `--ignore-scripts` only
after explicit npm publication authorization. `--tag next` leaves `latest` on
the existing version; promotion to `latest` is a separate authorized choice.
Do not change tags or claim stable availability as a side effect of preparing
a GitHub candidate.

After publication:

1. Verify the registry version and intended dist-tag. Allow registry propagation;
   do not repeat publication just because the first read is 404.
2. Download the registry tarball and compare bytes and SHA512 integrity with the
   reviewed artifact. Install it into a clean consumer and verify all four
   exports, CLI version, and scaffold generation.
3. Verify the npm README and installation instructions. Mark npm publication
   complete in the changelog and release status, and update install commands to
   the published version. Keep GitHub candidate/stable status accurate.

A manual trusted-publishing workflow and npm publisher binding are not currently
configured. If added later, use the [npm trusted-publisher setup](https://docs.npmjs.com/trusted-publishers/)
and short-lived credentials rather than committing tokens.

## Scope to preserve

Octoload uses single PUT uploads and verifies stored size/content type. It does
not decode image bytes, verify checksums, implement a multipart server workflow,
or revoke a signed PUT URL when an object is deleted. Keep those limits explicit
in release notes; see [integration scope](integrations.md#limits-access-and-current-scope).
PostgreSQL remains the CLI default. SQLite and PGlite retain foreign-key,
Date/boolean, migration, and disk-persistence checks. Do not modify an application's
existing database during release tests.

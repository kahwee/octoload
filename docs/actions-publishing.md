# Actions publishing

The release guard validates stable `v<package.json version>` tags, refuses private
packages and mismatched npm lock metadata, and stops on registry errors. A 200
response means the version is immutable; it never forces another upload.

Run `node --test scripts/check-release-guard.mjs` and
`node scripts/release-check.mjs v<version>` without publishing.
`--registry` adds a read-only check of the exact public npm version.

## Isolated release publishing

The active workflow is [publish.yml](../.github/workflows/publish.yml).
Published GitHub releases trigger three jobs: build, publish, and verify.
The build job requires successful CI on the exact tagged main-branch source,
installs the frozen lockfile, checks and builds, and uploads a checked archive.
It has read-only repository permissions and no OIDC permission.

The fresh publish job downloads the archive, checks its SHA-256 digest, and runs
npm with lifecycle scripts disabled. Only this job has id-token write permission;
it performs no checkout, dependency installation, or repository-script execution.
The read-only verify job checks registry identity, archive integrity, and dist-tag.
The workflow does not create versions, tags, or GitHub releases.

The approved npm trusted-publisher binding is:

- npm package: `octoload`
- GitHub owner: `kahwee`
- repository: `octoload`
- workflow filename: `publish.yml`
- environment: blank
- allowed action: direct `npm publish` only; no extra dist-tag management grant

Use GitHub-hosted runners and npm >=11.5.1; no npm secret is needed. Configure and
read back the binding in the package owner's npm settings after approval. Existing
secret presence and a local login do not prove CI publish access. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

Run the full existing CI before releasing. Authentication is validated only by a
successful real publication; a package dry run does not validate OIDC exchange.

The workflow serializes releases with `queue: max`: GitHub holds up to
100 pending runs and cancels additional arrivals when full. Waiting order does
not guarantee version order. The archive-aware preflight rejects a new version
that would downgrade `latest`, and skips an existing version only if its SHA-512
integrity matches the checked tarball. A newer `latest` is preserved.

Readback verifies registry identity, integrity and the selected dist-tag. It makes
at most six reads, five seconds apart, each with a 15-second timeout. Only a missing
package/version or a missing or older selected tag is retried; other HTTP errors,
malformed metadata, and identity or integrity mismatches fail immediately.
Exhaustion fails the job.

The workflow accepts a published GitHub release marked as a prerelease, but still
requires a stable version tag; such a release uses and verifies `next`, while other
releases use and verify `latest`.

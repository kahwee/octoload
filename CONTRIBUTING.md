# Contributing to Octoload

Octoload is a TypeScript package with a schema/scaffold CLI, browser client,
and Next.js and React Router handlers.

## Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/kahwee/octoload.git
   cd octoload
   ```

2. **Use Node.js 24 or newer**, then install dependencies with the pnpm version
   pinned in `package.json`:
   ```bash
   pnpm install --frozen-lockfile
   ```

3. **Run development mode:**
   ```bash
   pnpm run dev  # Watch mode for development
   ```

## Development Commands

```bash
# Build the project
pnpm run build

# Run tests
pnpm test

# Type checking
pnpm run typecheck

# Lint and formatting checks
pnpm run lint
pnpm run format:check

# Coverage report
pnpm run test:coverage

# Check the README's TypeScript and JSON examples
pnpm run test:docs

# Check built package exports and generated scaffolds (after build)
pnpm run test:package

# Check storage harness locally without credentials (after build)
pnpm run test:harness

# Full verification (before submitting PR)
pnpm run typecheck && pnpm run lint && pnpm run format:check && pnpm run test:docs && pnpm run test:coverage && pnpm run build && pnpm run test:package && pnpm run test:harness
```

For dependency maintenance, run `pnpm update --latest`, review the manifest and
lockfile diff, then run `pnpm install --frozen-lockfile` and the full verification
command above. Dependabot tracks GitHub Actions; pnpm package updates are
maintained in the repository.

For provider-backed upload integrity checks, see the [adversarial test harness](docs/testing.md).
The live harness is opt-in and requires a disposable S3 or R2 bucket.

## Code and reviews

Keep TypeScript strict and use the repository's Biome commands. Add behavior
checks for new functionality and regressions, then run the verification command
above. Update the [README](README.md) and [integration guide](docs/integrations.md)
when public behavior changes.

The CLI and generated templates must agree: `src/commands/init.ts` generates
framework scaffolds, and `src/templates/upload-schema.ts` supplies the schema. The build
regenerates `schema-template.ts` from that source. Package smoke tests
exercise the built exports and generated scaffolds. `test:docs` parses README
TypeScript/JSON examples and typechecks the browser component; it does not run
bucket uploads or database migrations.

Use a focused branch from `main` and describe the behavior and actual checks in
your pull request. Bug reports should include runtime versions, a minimal
reproduction, expected behavior, and the error output.

# Changelog

## 0.1.9 — Unreleased

The published npm `latest` remains 0.1.8 as checked on 2026-10-01. This section describes the current source, not a published release.

- Accept nullable PostgreSQL image metadata in browser finalize/read responses.
- Clarify Node requirements, PostgreSQL-only scope, and source-versus-npm installation.
- Ship setup guides and a credential-free signing example; smoke-test the packed consumer artifact.
- Reject unexpected metadata fields and validate alt/title lengths at runtime.
- Serve download URLs only for finalized, ready images.
- Sign single PUTs with a create-only condition, content type, and the core’s declared byte size. Existing objects cannot be overwritten with the upload URL.
- Add adversarial regression tests, an opt-in live S3/R2 signed-upload harness, and a private R2 storage harness using Cloudflare `cf`.

Upgrade bucket CORS to allow `If-None-Match` alongside `Content-Type`. Custom upload clients must forward returned headers. Previously issued upload URLs retain their original behavior until expiry. No 0.1.9 package release has been published.

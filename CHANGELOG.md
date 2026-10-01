# Changelog

## 0.2.0 — Release candidate

- Add SQLite schemas and database support alongside PostgreSQL; PostgreSQL remains the CLI default.
- Add `--dialect sqlite` scaffolding, runnable database examples, and a database release checklist.
- Exercise real SQLite and PGlite databases for ownership, metadata escalation, constraints, and lifecycle races.
- Add a bounded live R2 adversarial harness for signature mutation, concurrent PUTs, private reads, and content-validation limits.
- Preserve consumer dependency pins and environment settings in `add`; correct R2 defaults and make repeated calls idempotent.
- Reject invalid multipart part counts before allocating an upload.
- Normalize private not-found responses and redact database query errors.
- Accept nullable PostgreSQL image metadata in browser finalize/read responses.
- Refresh concise setup and release documentation for the supported runtimes and databases.
- Ship setup guides and a credential-free signing example; smoke-test the packed consumer artifact.
- Reject unexpected metadata fields and validate alt/title lengths at runtime.
- Serve download URLs only for finalized, ready images.
- Sign single PUTs with a create-only condition, content type, and the core’s declared byte size. Existing objects cannot be overwritten with the upload URL.
- Add adversarial regression tests, an opt-in live S3/R2 signed-upload harness, and a private R2 storage harness using Cloudflare `cf`.

Upgrade bucket CORS to allow `If-None-Match` alongside `Content-Type`. Custom upload clients must forward returned headers. Previously issued upload URLs retain their original behavior until expiry. The earlier 0.1.9 work was never published separately; it is included in 0.2.0.

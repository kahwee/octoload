# Upload observability and recovery

The browser client exposes structured phase events and failures without requiring
a telemetry service. Existing `onProgress` and `onStateChange` callbacks still
work. All callbacks are isolated: throwing or returning a rejected promise does
not interrupt an upload or replace its error. Callbacks are not awaited.

```ts
import { OctoloadClient, UploadFailure } from 'octoload/client';

const client = new OctoloadClient({
  baseUrl: window.location.origin,
  requestTimeoutMs: 30_000,
  uploadTimeoutMs: 120_000,
});
const controller = new AbortController();

try {
  await client.uploadFile(file, {
    signal: controller.signal,
    onProgress: ({ percentage }) => setProgress(percentage),
    onEvent: (event) => telemetry.track(event.type, event),
    onError: (error) => setMessage(error.message),
  });
} catch (error) {
  if (error instanceof UploadFailure) {
    // Display retry UI based on error.retry; keep the error for recovery.
    setFailedUpload(error);
  }
}
// controller.abort() cancels this attempt; it does not delete stored bytes.
```

`file`, `telemetry`, and the UI setters above belong to your application.
The returned promise still rejects on failure even when `onError` is provided.
Do not record the same failure from both the hook and catch block.

Events report `phase.started`, `phase.succeeded`, or `phase.failed` for `presign`,
`put`, `checksum`, and `finalize`. They include `uploadId`, `attempt`, and phase
`durationMs`. Completed API phases also include the server's `requestId` when
available. Failures add `code`, optional HTTP `status`, and `retry` guidance.
PUT progress reaching 100% is not completion: checksum and finalize still follow.
The legacy state callback continues to use `finalizing` during checksum work;
use `onEvent` for the more precise phase.

`UploadFailure` extends `OctoloadError` and includes those same failure fields,
`statusCode` for compatibility, and a non-enumerable original `cause` for local
debugging. Stable codes include `AUTHENTICATION_REQUIRED`, `VALIDATION_ERROR`,
`NETWORK_ERROR`, `STORAGE_REJECTED`, `UPLOAD_ABORTED`, `UPLOAD_TIMEOUT`,
`REQUEST_TIMEOUT`, `CHECKSUM_FAILED`, `UPLOAD_MISSING`, `UPLOAD_MISMATCH`,
`UPLOAD_STATE_CONFLICT`, and `INTERNAL_ERROR`. A browser network error can mean
CORS or a connection problem; it does not identify which one.

The API timeout covers the response body as well as headers; the PUT timeout
covers the single XHR. Both timeout settings must be positive finite milliseconds.
Defaults are 30 seconds and 120 seconds respectively; adjust for large uploads.
Checksum computation needs Web Crypto in a secure browser context. Cancellation
is checked around checksum computation but cannot interrupt an in-flight digest.

## Explicit recovery

There are no automatic upload retries. Keep the same client and failure object
in memory, then call `client.recoverUpload(failure, options)` after the user
chooses recovery. Recovery emits new events with the original upload ID and an
incremented attempt number. Supply callbacks again for that recovery attempt.

| `retry` | Action |
| --- | --- |
| `never` | Fix input, environment, or cancellation; do not automatically repeat. |
| `restart-upload` | Start a fresh `uploadFile` attempt and obtain a new signed URL. |
| `reconcile` | PUT outcome is unknown; call `recoverUpload` to verify storage before deciding. |
| `retry-finalize` | Call `recoverUpload`; restore the session first for HTTP 401. |

Recovery never repeats PUT. It recomputes checksum if needed and sends finalize
with `reconcile: true`. An authenticated owner can receive the already-ready row
when a successful finalize response was lost. A processing row still requires
normal storage metadata verification. Failed/deleted rows cannot become ready.
If verification establishes that no object exists, recovery returns
`UPLOAD_MISSING` with `restart-upload` guidance. A `412` from conditional PUT is
not proof of success; reconcile it. Legacy multipart responses do not support
this recovery API. Recovery handles are not persisted across reloads or clients.
Anonymous already-ready uploads cannot use owner-based reconciliation.

## Server logs and metrics

Add callbacks to shared handler options for either framework:

```ts
const options = {
  ...uploadHandlerOptions,
  onEvent(event) {
    logger.info(event, 'octoload');
  },
  onError(error, event) {
    // Optional trusted debugging sink. Redact causes before exporting them.
    secureLogger.error({ error, requestId: event.requestId });
  },
};
```

The framework entrypoints export `HandlerEvent`. Server events include operation
(`presign`, `finalize`, `get`, `delete`, or `list`), request ID, optional upload ID,
duration, status, and safe error code. Authentication failures are observed too.
Unexpected exceptions retain generic HTTP responses; their original cause is
available only to the server's optional `onError` callback.

Every base-handler response returns `X-Request-Id`. Upload requests send
`X-Octoload-Upload-Id`; the server accepts only 1–64 ASCII letters, digits,
underscores, or hyphens and echoes it. This is untrusted correlation metadata,
never authorization. Error responses add `X-Octoload-Error-Code` while preserving
the existing JSON error shape. Use request/upload IDs in logs, not metric labels;
aggregate counts and duration histograms by operation, phase, and error code.

Default events contain no filenames, file bytes, storage keys, signed URLs,
cookies, or exception causes. Avoid serializing raw server exceptions or network
traces to general telemetry. Keep browser and API on the same origin for the
standard session setup. Cross-origin APIs require application-managed cookie/CORS
configuration, including allowing the upload correlation header and exposing the
response correlation/error headers. These headers are never sent to the bucket.

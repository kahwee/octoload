import assert from 'node:assert/strict';
import { S3StorageAdapter } from 'octoload';

// Deliberately fake credentials: signing is local and this script never uploads.
// Keep real storage credentials on the server, never in browser code.
for (const adapter of ['s3', 'r2']) {
  const storage = new S3StorageAdapter({
    adapter,
    bucket: 'example-images',
    region: adapter === 'r2' ? 'auto' : 'us-east-1',
    ...(adapter === 'r2' && {
      endpoint: 'https://example-account.r2.cloudflarestorage.com',
    }),
    credentials: {
      accessKeyId: 'EXAMPLE_ONLY',
      secretAccessKey: 'EXAMPLE_ONLY_NOT_A_REAL_SECRET',
    },
  });
  const { url, fields } = await storage.getPresignedPutUrl(
    'uploads/example.png',
    'image/png',
    60,
    1024
  );
  const signedHeaders = new URL(url).searchParams.get('X-Amz-SignedHeaders');
  for (const header of ['content-length', 'content-type', 'if-none-match']) {
    assert.ok(signedHeaders?.split(';').includes(header));
  }
  assert.equal(fields['If-None-Match'], '*');
  console.log(`${adapter}: signed headers = ${signedHeaders}`);
  console.log(`Browser PUT headers: ${JSON.stringify(fields)}`);
}
console.log(
  'Signing example passed. Dummy credentials only; no requests sent.'
);

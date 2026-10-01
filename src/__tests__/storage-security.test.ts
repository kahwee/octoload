import { createHmac, createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { S3StorageAdapter } from '../storage/s3-adapter.js';

const credentials = {
  accessKeyId: 'test-access-key',
  secretAccessKey: 'test-secret-key',
};

// Independently reconstruct SigV4 to prove the conditional header's value is
// authenticated, using the actual SDK signer without bucket/network access.
function signatureFor(url: URL, headers: Record<string, string>): string {
  const parameter = (name: string) => {
    const value = url.searchParams.get(name);
    if (!value) throw new Error(`Missing signature parameter: ${name}`);
    return value;
  };
  const signedHeaders = parameter('X-Amz-SignedHeaders');
  const scope = parameter('X-Amz-Credential').split('/').slice(1);
  const encode = (value: string) =>
    encodeURIComponent(value).replace(
      /[!'()*]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
    );
  const query = [...url.searchParams]
    .filter(([key]) => key !== 'X-Amz-Signature')
    .map(([key, value]) => [encode(key), encode(value)])
    .sort(([a, av], [b, bv]) =>
      a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0
    )
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const canonicalHeaders = signedHeaders
    .split(';')
    .map((name) => `${name}:${headers[name]}\n`)
    .join('');
  const canonicalRequest = [
    'PUT',
    url.pathname,
    query,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const hash = (value: string) =>
    createHash('sha256').update(value).digest('hex');
  const hmac = (key: string | Buffer, value: string) =>
    createHmac('sha256', key).update(value).digest();
  const key = scope.reduce(
    (key, value) => hmac(key, value),
    Buffer.from(`AWS4${credentials.secretAccessKey}`)
  );
  return createHmac('sha256', key)
    .update(
      [
        'AWS4-HMAC-SHA256',
        parameter('X-Amz-Date'),
        scope.join('/'),
        hash(canonicalRequest),
      ].join('\n')
    )
    .digest('hex');
}

describe('single PUT security with the real AWS signer', () => {
  it.each(['s3', 'r2'] as const)(
    '%s authenticates create-only condition, type, and expected byte size',
    async (provider) => {
      const adapter = new S3StorageAdapter({
        adapter: provider,
        bucket: 'test-bucket',
        region: provider === 'r2' ? 'auto' : 'us-east-1',
        endpoint:
          provider === 'r2'
            ? 'https://test-account.r2.cloudflarestorage.com'
            : undefined,
        credentials,
      });
      const result = await adapter.getPresignedPutUrl(
        'uploads/image.jpg',
        'image/jpeg',
        300,
        1024
      );
      expect(result.fields).toEqual({
        'If-None-Match': '*',
        'Content-Type': 'image/jpeg',
      });
      const url = new URL(result.url);
      expect(url.searchParams.has('x-amz-checksum-crc32')).toBe(false);
      expect(url.searchParams.has('x-amz-sdk-checksum-algorithm')).toBe(false);
      expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe(
        'content-length;content-type;host;if-none-match'
      );
      const headers = {
        host: url.host,
        'content-length': '1024',
        'content-type': 'image/jpeg',
        'if-none-match': '*',
      };
      const expected = url.searchParams.get('X-Amz-Signature');
      expect(signatureFor(url, headers)).toBe(expected);
      for (const [name, value] of [
        ['if-none-match', ''],
        ['if-none-match', 'different-etag'],
        ['content-length', '2048'],
        ['content-type', 'image/png'],
      ]) {
        expect(signatureFor(url, { ...headers, [name]: value })).not.toBe(
          expected
        );
      }
    }
  );

  it('preserves three-argument calls with signed create-only protection', async () => {
    const adapter = new S3StorageAdapter({
      adapter: 's3',
      bucket: 'test-bucket',
      region: 'us-east-1',
      credentials,
    });
    const result = await adapter.getPresignedPutUrl(
      'image.jpg',
      'image/jpeg',
      300
    );
    expect(new URL(result.url).searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-type;host;if-none-match'
    );
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid byte size %s before signing',
    async (byteSize) => {
      const adapter = new S3StorageAdapter({
        adapter: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
        credentials,
      });
      await expect(
        adapter.getPresignedPutUrl('image.jpg', 'image/jpeg', 300, byteSize)
      ).rejects.toThrow('Byte size must be a positive safe integer');
    }
  );
});

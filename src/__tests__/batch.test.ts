import { expect, it, vi } from 'vitest';
import {
  OctoloadClient,
  UploadBatchError,
  UploadFailure,
  type UploadResult,
} from '../client/index.js';
import type { ImageRecord } from '../types/index.js';

const files = (count: number) =>
  Array.from(
    { length: count },
    (_, i) => new File(['png'], `${i}.png`, { type: 'image/png' })
  );
const result = (id: string): UploadResult => ({ image: { id } as ImageRecord });

it('preserves earlier successes, waits for siblings, and identifies unstarted files', async () => {
  const client = new OctoloadClient({ baseUrl: '' });
  const failure = new UploadFailure(
    'Lost response',
    'NETWORK_ERROR',
    'upload-3',
    'finalize',
    'retry-finalize'
  );
  let release!: (value: UploadResult) => void;
  let started!: () => void;
  const siblingStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = new Promise<UploadResult>((resolve) => {
    release = resolve;
  });
  const upload = vi
    .spyOn(client, 'uploadFile')
    .mockImplementation(async (file) => {
      if (file.name === '3.png') throw failure;
      if (file.name === '4.png') {
        started();
        return pending;
      }
      return result(file.name);
    });
  let settled = false;
  const batch = client.uploadMultiple(files(7)).catch((error) => {
    settled = true;
    return error;
  });
  await siblingStarted;
  expect(settled).toBe(false);
  release(result('4.png'));
  const error = await batch;
  expect(error).toBeInstanceOf(UploadBatchError);
  expect(upload).toHaveBeenCalledTimes(6);
  expect(error.outcomes).toEqual([
    { fileIndex: 0, status: 'fulfilled', value: result('0.png') },
    { fileIndex: 1, status: 'fulfilled', value: result('1.png') },
    { fileIndex: 2, status: 'fulfilled', value: result('2.png') },
    { fileIndex: 3, status: 'rejected', reason: failure },
    { fileIndex: 4, status: 'fulfilled', value: result('4.png') },
    { fileIndex: 5, status: 'fulfilled', value: result('5.png') },
    { fileIndex: 6, status: 'skipped' },
  ]);
  // The exact failure object is the key needed by recoverUpload.
  expect(error.outcomes[3].reason).toBe(failure);
});

it('preserves successful return values in input order and limits concurrency to three', async () => {
  const client = new OctoloadClient({ baseUrl: '' });
  let active = 0;
  let peak = 0;
  vi.spyOn(client, 'uploadFile').mockImplementation(async (file) => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) =>
      setTimeout(resolve, file.name === '0.png' ? 10 : 0)
    );
    active--;
    return result(file.name);
  });
  expect(await client.uploadMultiple(files(5))).toEqual(
    files(5).map((file) => result(file.name))
  );
  expect(peak).toBe(3);
  expect(await client.uploadMultiple([])).toEqual([]);
});

it('retains every failure in a failed batch', async () => {
  const client = new OctoloadClient({ baseUrl: '' });
  vi.spyOn(client, 'uploadFile').mockRejectedValue(new Error('offline'));
  await expect(client.uploadMultiple(files(4))).rejects.toMatchObject({
    outcomes: [
      { fileIndex: 0, status: 'rejected' },
      { fileIndex: 1, status: 'rejected' },
      { fileIndex: 2, status: 'rejected' },
      { fileIndex: 3, status: 'skipped' },
    ],
  });
});

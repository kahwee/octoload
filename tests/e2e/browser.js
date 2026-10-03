import { OctoloadClient } from '../../dist/client/index.js';
const params = new URLSearchParams(location.search);
const client = new OctoloadClient({
  baseUrl: location.origin,
  uploadTimeoutMs: Number(params.get('timeout') || 10000),
});
const status = document.querySelector('#status');
const events = [];
const progress = [];
let failure;
let image;
const controller = new AbortController();
const options = {
  signal: controller.signal,
  onEvent(event) {
    events.push(event);
    if (
      params.has('cancel') &&
      event.phase === 'put' &&
      event.type === 'phase.started'
    )
      controller.abort();
    if (params.has('throw')) throw new Error('Deliberately broken telemetry');
  },
  onProgress(event) {
    progress.push(event.percentage);
    if (params.has('throw'))
      throw new Error('Deliberately broken progress callback');
  },
  onStateChange(state) {
    status.textContent = state;
    if (params.has('throw'))
      throw new Error('Deliberately broken view callback');
  },
  onError(error) {
    failure = error;
  },
};
async function display(result) {
  image = result.image;
  const download = await client.getImage(image.id);
  document.querySelector('img').src = download.url;
  status.textContent = 'ready';
}
function failed(error) {
  failure = error;
  status.textContent = `error:${error.phase}:${error.code}`;
}
document.querySelector('input').onchange = async (event) => {
  try {
    const files = [...event.target.files];
    const results = await client.uploadMultiple(files, options);
    await display(results[0]);
  } catch (error) {
    failed(error);
  }
};
document.querySelector('#recover').onclick = async () => {
  try {
    await display(await client.recoverUpload(failure, options));
  } catch (error) {
    failed(error);
  }
};
document.querySelector('#delete').onclick = async () => {
  try {
    await client.deleteImage(image.id);
    status.textContent = 'deleted';
  } catch (error) {
    status.textContent = `delete-error:${error.code}:${error.statusCode}`;
  }
};
// Test assertions get safe state; signed URLs and recovery handles stay private.
window.uploadState = () => ({
  events,
  progress,
  imageId: image?.id,
  failure: failure && {
    phase: failure.phase,
    code: failure.code,
    retry: failure.retry,
    uploadId: failure.uploadId,
  },
});

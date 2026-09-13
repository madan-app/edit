// =============================================================
// worker-client.js — promise wrapper around workers/image-worker.js.
// Used for full-resolution export processing so large photos never
// block the main thread / freeze the UI while exporting.
// =============================================================

import { processImageData } from './adjustments.js';

let worker = null;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./workers/image-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, ok, buffer, width, height, error } = e.data;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (ok) entry.resolve(new ImageData(new Uint8ClampedArray(buffer), width, height));
      else entry.reject(new Error(error));
    };
    worker.onerror = () => {
      // Worker failed to start (e.g. unsupported module workers) — callers
      // fall back to processing on the main thread instead.
      worker = null;
    };
  } catch (err) {
    worker = null;
  }
  return worker;
}

/** Process ImageData in the worker; falls back to the main thread on any failure. */
export function processImageDataOffThread(imageData, adjustments, timeoutMs = 8000) {
  const w = getWorker();
  if (!w) {
    return Promise.resolve(processImageData(imageData, adjustments));
  }
  return new Promise((resolve) => {
    const id = nextId++;
    const timeout = setTimeout(() => {
      pending.delete(id);
      resolve(processImageData(imageData, adjustments));
    }, timeoutMs);
    pending.set(id, {
      resolve: (result) => { clearTimeout(timeout); resolve(result); },
      reject: () => { clearTimeout(timeout); resolve(processImageData(imageData, adjustments)); }
    });
    const buffer = imageData.data.buffer.slice(0);
    w.postMessage({ id, width: imageData.width, height: imageData.height, buffer, adjustments }, [buffer]);
  });
}

// =============================================================
// workers/image-worker.js
// Runs the same pixel-processing engine as adjustments.js but off
// the main thread, so large photos don't freeze slider dragging.
// Module worker — created with `new Worker(url, { type: 'module' })`.
// =============================================================

import { processImageData } from '../adjustments.js';

self.onmessage = (e) => {
  const { id, width, height, buffer, adjustments } = e.data;
  try {
    const data = new Uint8ClampedArray(buffer);
    const imageData = new ImageData(data, width, height);
    processImageData(imageData, adjustments);
    // Transfer the underlying buffer back to avoid a copy.
    self.postMessage({ id, buffer: imageData.data.buffer, width, height, ok: true }, [imageData.data.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message });
  }
};

// =============================================================
// image-loader.js — file validation + decoding + preview scaling
// =============================================================

const ACCEPTED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
export const MAX_DIMENSION = 6000;       // hard safety cap for full-res source
export const PREVIEW_MAX_DIMENSION = 1600; // working resolution while editing

export class ImageValidationError extends Error {}

export function validateFile(file) {
  if (!file) throw new ImageValidationError('No file was provided.');
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new ImageValidationError(
      `Unsupported file type "${file.type || 'unknown'}". Please choose a JPG, PNG or WebP image.`
    );
  }
  const maxBytes = 60 * 1024 * 1024; // 60MB sanity limit
  if (file.size > maxBytes) {
    throw new ImageValidationError('That image is larger than 60MB — try a smaller file.');
  }
  return true;
}

/** Decode a File into an HTMLImageElement (or ImageBitmap when available). */
export async function decodeFile(file) {
  validateFile(file);
  try {
    if ('createImageBitmap' in window) {
      const bitmap = await createImageBitmap(file);
      return { kind: 'bitmap', image: bitmap, width: bitmap.width, height: bitmap.height };
    }
  } catch (err) {
    // Corrupt or unsupported image data — fall through to <img> path which
    // will raise its own decode error below.
  }
  return decodeViaImageElement(file);
}

function decodeViaImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ kind: 'element', image: img, width: img.naturalWidth, height: img.naturalHeight, url });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImageValidationError('This image could not be read. It may be corrupt.'));
    };
    img.src = url;
  });
}

/** Draw a decoded source into an offscreen canvas capped at maxDim, return canvas + scale. */
export function drawToCanvas(decoded, maxDim = MAX_DIMENSION) {
  let { width, height } = decoded;
  const scale = Math.min(1, maxDim / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(decoded.image, 0, 0, w, h);
  return { canvas, scale, width: w, height: h };
}

/** Build both a full-resolution source canvas and a lighter preview canvas. */
export async function loadImageForEditing(file) {
  const decoded = await decodeFile(file);
  if (decoded.width * decoded.height === 0) {
    throw new ImageValidationError('This image appears to be empty or corrupt.');
  }
  const full = drawToCanvas(decoded, MAX_DIMENSION);
  const preview = drawToCanvas(decoded, PREVIEW_MAX_DIMENSION);
  if (decoded.kind === 'element' && decoded.url) URL.revokeObjectURL(decoded.url);
  if (decoded.image && decoded.image.close) decoded.image.close();
  return {
    fullCanvas: full.canvas,
    previewCanvas: preview.canvas,
    fullWidth: full.width,
    fullHeight: full.height,
    previewWidth: preview.width,
    previewHeight: preview.height,
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size
  };
}

export function canvasToBlob(canvas, type = 'image/png', quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Export failed to produce a file.')), type, quality);
  });
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function dataURLToImage(dataURL) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode stored project image.'));
    img.src = dataURL;
  });
}

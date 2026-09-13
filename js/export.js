// =============================================================
// export.js — full-resolution render + download.
// Preview editing happens at a capped working resolution for
// speed; export re-renders every layer against the full-res
// source so quality is never limited by the editing preview.
// =============================================================

import { canvasToBlob } from './image-loader.js';
import { compositeLayers } from './layers.js';

/**
 * Build a full-resolution composite canvas.
 * `renderImageLayer(layer, scale)` is supplied by editor.js — it knows
 * how to fetch/produce the full-res source pixels for an image layer.
 */
export async function renderFullResolutionComposite(project, renderImageLayerAtScale, targetWidth, targetHeight) {
  const scaleX = targetWidth / project.width;
  const scaleY = targetHeight / project.height;

  const out = document.createElement('canvas');
  out.width = targetWidth;
  out.height = targetHeight;
  const ctx = out.getContext('2d');

  const scaledLayers = [];
  for (const layer of project.layers) {
    if (!layer.visible) continue;
    let canvas = layer.canvas;
    if (layer.type === 'image' && renderImageLayerAtScale) {
      canvas = await renderImageLayerAtScale(layer, targetWidth, targetHeight);
    } else if (scaleX !== 1 || scaleY !== 1) {
      const scaledCanvas = document.createElement('canvas');
      scaledCanvas.width = Math.max(1, Math.round(layer.canvas.width * scaleX));
      scaledCanvas.height = Math.max(1, Math.round(layer.canvas.height * scaleY));
      const sctx = scaledCanvas.getContext('2d');
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(layer.canvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
      canvas = scaledCanvas;
    }
    scaledLayers.push({
      ...layer,
      canvas,
      x: layer.x * scaleX,
      y: layer.y * scaleY
    });
  }
  compositeLayers(ctx, scaledLayers, targetWidth, targetHeight);
  return out;
}

export async function exportProject(project, renderImageLayerAtScale, options) {
  const { format, quality, width, height, filename, transparentBackground } = options;
  const composite = await renderFullResolutionComposite(project, renderImageLayerAtScale, width, height);

  let finalCanvas = composite;
  if (format === 'jpg' || !transparentBackground) {
    // flatten onto white if the format cannot hold transparency
    if (format === 'jpg') {
      const flat = document.createElement('canvas');
      flat.width = composite.width; flat.height = composite.height;
      const fctx = flat.getContext('2d');
      fctx.fillStyle = '#ffffff';
      fctx.fillRect(0, 0, flat.width, flat.height);
      fctx.drawImage(composite, 0, 0);
      finalCanvas = flat;
    }
  }

  const mime = format === 'jpg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  const blob = await canvasToBlob(finalCanvas, mime, quality / 100);
  downloadBlob(blob, filename || `edited.${format}`);
  return blob;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

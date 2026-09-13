// =============================================================
// layers.js — layer data model + compositor.
// Every layer owns its own offscreen canvas. Standard blend modes
// map directly onto Canvas2D's native globalCompositeOperation,
// so compositing stays fast and correct without custom math.
// =============================================================

import { uid } from './storage.js';
import { DEFAULT_ADJUSTMENTS, cloneAdjustments } from './adjustments.js';

export const BLEND_MODES = [
  { id: 'source-over', name: 'Normal' },
  { id: 'multiply', name: 'Multiply' },
  { id: 'screen', name: 'Screen' },
  { id: 'overlay', name: 'Overlay' },
  { id: 'darken', name: 'Darken' },
  { id: 'lighten', name: 'Lighten' },
  { id: 'soft-light', name: 'Soft Light' },
  { id: 'hard-light', name: 'Hard Light' },
  { id: 'color-dodge', name: 'Color Dodge' },
  { id: 'color-burn', name: 'Color Burn' }
];

export function createLayer(type, { width, height, name } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width || 1;
  canvas.height = height || 1;
  return {
    id: uid('layer'),
    type, // 'image' | 'text' | 'shape' | 'sticker' | 'drawing'
    name: name || defaultName(type),
    visible: true,
    locked: false,
    opacity: 100,
    blendMode: 'source-over',
    x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1,
    canvas,
    // per-layer non-destructive adjustments + mask (image layers only)
    adjustments: type === 'image' ? DEFAULT_ADJUSTMENTS() : null,
    mask: null,
    // free-form payload for text/shape/sticker layers (used to re-render on edit)
    data: {}
  };
}

function defaultName(type) {
  const names = { image: 'Photo', text: 'Text', shape: 'Shape', sticker: 'Sticker', drawing: 'Drawing' };
  return names[type] || 'Layer';
}

export function cloneLayerMeta(layer) {
  // clones everything except the actual canvas pixel buffer reference chain issues;
  // canvas is copied via drawImage by the caller when a true duplicate is needed.
  const { canvas, ...rest } = layer;
  return JSON.parse(JSON.stringify(rest));
}

export function duplicateLayer(layer) {
  const copy = createLayer(layer.type, { width: layer.canvas.width, height: layer.canvas.height, name: layer.name + ' copy' });
  copy.canvas.getContext('2d').drawImage(layer.canvas, 0, 0);
  copy.visible = layer.visible;
  copy.opacity = layer.opacity;
  copy.blendMode = layer.blendMode;
  copy.x = layer.x; copy.y = layer.y; copy.rotation = layer.rotation;
  copy.scaleX = layer.scaleX; copy.scaleY = layer.scaleY;
  copy.adjustments = layer.adjustments ? cloneAdjustments(layer.adjustments) : null;
  copy.mask = layer.mask ? { ...layer.mask } : null;
  copy.data = JSON.parse(JSON.stringify(layer.data || {}));
  return copy;
}

/** Composite an ordered array of (bottom-to-top) layers onto a target 2D context. */
export function compositeLayers(ctx, layers, width, height) {
  ctx.clearRect(0, 0, width, height);
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity / 100));
    ctx.globalCompositeOperation = layer.blendMode || 'source-over';

    // apply mask via a temporary composited canvas so blend mode still
    // affects only the visible (masked) portion of this layer.
    let sourceCanvas = layer.canvas;
    if (layer.mask && layer.mask.canvas) {
      sourceCanvas = applyMaskToCanvas(layer.canvas, layer.mask.canvas, layer.mask.opacity ?? 100);
    }

    const cx = layer.x + layer.canvas.width / 2;
    const cy = layer.y + layer.canvas.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate((layer.rotation || 0) * Math.PI / 180);
    ctx.scale(layer.scaleX || 1, layer.scaleY || 1);
    ctx.drawImage(sourceCanvas, -layer.canvas.width / 2, -layer.canvas.height / 2);
    ctx.restore();
  }
}

function applyMaskToCanvas(sourceCanvas, maskCanvas, maskOpacity) {
  const out = document.createElement('canvas');
  out.width = sourceCanvas.width;
  out.height = sourceCanvas.height;
  const octx = out.getContext('2d');
  octx.drawImage(sourceCanvas, 0, 0);
  octx.globalCompositeOperation = 'destination-in';
  octx.globalAlpha = Math.max(0, Math.min(1, (maskOpacity ?? 100) / 100));
  octx.drawImage(maskCanvas, 0, 0, out.width, out.height);
  octx.globalAlpha = 1;
  octx.globalCompositeOperation = 'source-over';
  return out;
}

export function layerTypeIconKey(type) {
  return { image: 'image', text: 'type', shape: 'shape', sticker: 'sticker', drawing: 'brush' }[type] || 'layer';
}

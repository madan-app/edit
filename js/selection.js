// =============================================================
// selection.js — interactive selection tools that produce a mask.
// Used by the Selection tool and by the Background Removal panel
// (manual eraser / brush / lasso / rect / magic wand selection).
// =============================================================

import { createEmptyMask } from './masks.js';

export function rectSelectionMask(width, height, x, y, w, h) {
  const mask = createEmptyMask(width, height);
  const ctx = mask.canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(x, y, w, h);
  return mask;
}

export function ellipseSelectionMask(width, height, x, y, w, h) {
  const mask = createEmptyMask(width, height);
  const ctx = mask.canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
  ctx.fill();
  return mask;
}

/** points: array of {x,y} forming a closed polygon (freehand lasso). */
export function lassoSelectionMask(width, height, points) {
  const mask = createEmptyMask(width, height);
  if (points.length < 3) return mask;
  const ctx = mask.canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.fill();
  return mask;
}

/**
 * Magic wand / color-based selection: flood-fills from a seed point
 * across pixels within `tolerance` color distance (0-100).
 */
export function magicWandMask(sourceImageData, seedX, seedY, tolerance = 20, contiguous = true) {
  const { width, height, data } = sourceImageData;
  const mask = createEmptyMask(width, height);
  const maskImageData = mask.canvas.getContext('2d').createImageData(width, height);
  const idx = (seedY * width + seedX) * 4;
  const sr = data[idx], sg = data[idx + 1], sb = data[idx + 2];
  const tol = (tolerance / 100) * 441.7; // max possible Euclidean RGB distance

  const matches = (i) => {
    const dr = data[i] - sr, dg = data[i + 1] - sg, db = data[i + 2] - sb;
    return Math.sqrt(dr * dr + dg * dg + db * db) <= tol;
  };

  if (contiguous) {
    const visited = new Uint8Array(width * height);
    const stack = [[seedX, seedY]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const p = y * width + x;
      if (visited[p]) continue;
      visited[p] = 1;
      const i = p * 4;
      if (!matches(i)) continue;
      maskImageData.data[i + 3] = 255;
      maskImageData.data[i] = maskImageData.data[i + 1] = maskImageData.data[i + 2] = 255;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  } else {
    for (let p = 0, i = 0; p < width * height; p++, i += 4) {
      if (matches(i)) {
        maskImageData.data[i + 3] = 255;
        maskImageData.data[i] = maskImageData.data[i + 1] = maskImageData.data[i + 2] = 255;
      }
    }
  }
  mask.canvas.getContext('2d').putImageData(maskImageData, 0, 0);
  return mask;
}

/** Grow (expand > 0) or shrink (expand < 0) a mask's selected area, in pixels. */
export function expandShrinkMask(mask, amountPx) {
  if (!amountPx) return;
  const { canvas } = mask;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const tctx = tmp.getContext('2d');
  // Approximate morphological grow/shrink using layered offset draws.
  tctx.clearRect(0, 0, w, h);
  const steps = 8;
  const dist = Math.abs(amountPx);
  for (let a = 0; a < steps; a++) {
    const angle = (a / steps) * Math.PI * 2;
    tctx.drawImage(canvas, Math.cos(angle) * dist, Math.sin(angle) * dist);
  }
  if (amountPx > 0) {
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(tmp, 0, 0);
  } else {
    // shrink: keep only where original AND all offset copies overlap —
    // approximated via multiply-style intersection using destination-in passes.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
  }
}

export function selectionMaskFromRectPixels(width, height, rect) {
  return rectSelectionMask(width, height, rect.x, rect.y, rect.w, rect.h);
}

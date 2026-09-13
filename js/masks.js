// =============================================================
// masks.js — non-AI local adjustment masks.
// A mask is stored as a grayscale alpha canvas (white = fully
// affected, black = unaffected). Adjustment layers use a mask to
// restrict exposure/contrast/etc. to part of the photo.
// =============================================================

import { uid } from './storage.js';

export function createEmptyMask(width, height, fillWhite = false) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (fillWhite) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
  }
  return {
    id: uid('mask'),
    kind: 'brush', // brush | linear-gradient | radial-gradient | rect | ellipse
    canvas,
    opacity: 100,
    feather: 0,
    inverted: false
  };
}

export function paintBrushStroke(mask, x0, y0, x1, y1, radius, hardness, opacityPct, erase = false) {
  const ctx = mask.canvas.getContext('2d');
  ctx.save();
  ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const soft = Math.max(0, 1 - hardness / 100);
  const grad = ctx.createRadialGradient(x1, y1, radius * (1 - soft) * 0.6, x1, y1, radius);
  const alpha = Math.max(0, Math.min(1, opacityPct / 100));
  grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
  grad.addColorStop(1, `rgba(255,255,255,0)`);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = radius * 2;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  // stamp a soft dab at the end point for round, feathered strokes
  ctx.globalAlpha = 1;
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x1, y1, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function paintLinearGradientMask(mask, x0, y0, x1, y1) {
  const ctx = mask.canvas.getContext('2d');
  ctx.clearRect(0, 0, mask.canvas.width, mask.canvas.height);
  const grad = ctx.createLinearGradient(x0, y0, x1, y1);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, mask.canvas.width, mask.canvas.height);
}

export function paintRadialGradientMask(mask, cx, cy, radius) {
  const ctx = mask.canvas.getContext('2d');
  ctx.clearRect(0, 0, mask.canvas.width, mask.canvas.height);
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, mask.canvas.width, mask.canvas.height);
}

export function paintShapeMask(mask, shape, x, y, w, h, feather) {
  const ctx = mask.canvas.getContext('2d');
  ctx.clearRect(0, 0, mask.canvas.width, mask.canvas.height);
  ctx.filter = feather ? `blur(${feather}px)` : 'none';
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  if (shape === 'ellipse') {
    ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
  } else {
    ctx.rect(x, y, w, h);
  }
  ctx.fill();
  ctx.filter = 'none';
}

export function invertMask(mask) {
  mask.inverted = !mask.inverted;
}

export function applyFeatherToMask(mask, featherPx) {
  const { canvas } = mask;
  const w = canvas.width, h = canvas.height;
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const tctx = tmp.getContext('2d');
  tctx.filter = `blur(${featherPx}px)`;
  tctx.drawImage(canvas, 0, 0);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(tmp, 0, 0);
}

/** Combine two masks: 'add' (union/lighten) or 'subtract' (erase b from a). */
export function combineMasks(maskA, maskB, mode = 'add') {
  const ctx = maskA.canvas.getContext('2d');
  ctx.save();
  ctx.globalCompositeOperation = mode === 'subtract' ? 'destination-out' : 'lighter';
  ctx.drawImage(maskB.canvas, 0, 0);
  ctx.restore();
}

/** Read effective mask alpha (0..255) at a point, honoring inversion + opacity. */
export function sampleMaskAlpha(mask, x, y) {
  const ctx = mask.canvas.getContext('2d');
  const data = ctx.getImageData(Math.max(0, x | 0), Math.max(0, y | 0), 1, 1).data;
  let a = data[3];
  if (mask.inverted) a = 255 - a;
  return a * (mask.opacity / 100);
}

/** Draw a translucent red mask overlay onto a preview context (for "show mask overlay"). */
export function drawMaskOverlay(ctx, mask, width, height) {
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.globalCompositeOperation = 'source-over';
  const tmp = document.createElement('canvas');
  tmp.width = width; tmp.height = height;
  const tctx = tmp.getContext('2d');
  tctx.fillStyle = '#ff3b30';
  tctx.fillRect(0, 0, width, height);
  tctx.globalCompositeOperation = 'destination-in';
  if (mask.inverted) {
    tctx.drawImage(mask.canvas, 0, 0, width, height);
    tctx.globalCompositeOperation = 'source-out';
    tctx.fillStyle = '#ff3b30';
    tctx.fillRect(0, 0, width, height);
  } else {
    tctx.drawImage(mask.canvas, 0, 0, width, height);
  }
  ctx.drawImage(tmp, 0, 0);
  ctx.restore();
}

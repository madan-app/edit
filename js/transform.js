// =============================================================
// transform.js — crop / rotate / flip / straighten / resize /
// basic 4-point perspective correction.
// All functions operate on a source canvas and return a NEW canvas
// so the caller can keep this step in the non-destructive history.
// =============================================================

export const CROP_RATIOS = [
  { id: 'free', label: 'Free', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: 'a4', label: 'A4', ratio: 210 / 297 },
  { id: 'a3', label: 'A3', ratio: 297 / 420 }
];

export function cropCanvas(source, x, y, w, h) {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w));
  out.height = Math.max(1, Math.round(h));
  const ctx = out.getContext('2d');
  ctx.drawImage(source, x, y, w, h, 0, 0, out.width, out.height);
  return out;
}

export function rotateCanvas(source, degrees) {
  const rad = degrees * Math.PI / 180;
  const w = source.width, h = source.height;
  const newW = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
  const newH = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
  const out = document.createElement('canvas');
  out.width = Math.round(newW);
  out.height = Math.round(newH);
  const ctx = out.getContext('2d');
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(source, -w / 2, -h / 2);
  return out;
}

export function rotate90(source, direction = 1) {
  return rotateCanvas(source, 90 * direction);
}

export function flipCanvas(source, horizontal, vertical) {
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext('2d');
  ctx.translate(horizontal ? out.width : 0, vertical ? out.height : 0);
  ctx.scale(horizontal ? -1 : 1, vertical ? -1 : 1);
  ctx.drawImage(source, 0, 0);
  return out;
}

/**
 * Straighten: rotate by a small angle to level a horizon, then
 * automatically crop inward to remove the transparent corners.
 */
export function straightenCanvas(source, degrees) {
  const rotated = rotateCanvas(source, degrees);
  const angleRad = Math.abs(degrees) * Math.PI / 180;
  const w = source.width, h = source.height;
  // largest axis-aligned rectangle that stays inside the rotated image
  const cropW = w * Math.cos(angleRad) - h * Math.sin(angleRad) > 0
    ? (w * Math.cos(angleRad) - h * Math.sin(angleRad)) / Math.cos(2 * angleRad)
    : w * 0.7;
  const cropH = cropW * (h / w);
  const x = (rotated.width - cropW) / 2;
  const y = (rotated.height - cropH) / 2;
  return cropCanvas(rotated, Math.max(0, x), Math.max(0, y), Math.min(cropW, rotated.width), Math.min(cropH, rotated.height));
}

export function resizeCanvas(source, width, height, smooth = true) {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(width));
  out.height = Math.max(1, Math.round(height));
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = smooth;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

export function constrainToRatio(w, h, ratio) {
  if (!ratio) return { w, h };
  if (w / h > ratio) return { w: h * ratio, h };
  return { w, h: w / ratio };
}

/**
 * Basic 4-point perspective correction (experimental).
 * `corners` = [{x,y} tl, tr, br, bl] picked on the source image.
 * Maps the quad back to an axis-aligned rectangle by splitting the
 * quad into two triangles and applying a per-triangle affine warp —
 * a practical approximation, not a full projective transform.
 */
export function perspectiveCorrect(source, corners, outW, outH) {
  const out = document.createElement('canvas');
  out.width = outW; out.height = outH;
  const ctx = out.getContext('2d');
  const [tl, tr, br, bl] = corners;
  const destTL = { x: 0, y: 0 }, destTR = { x: outW, y: 0 }, destBR = { x: outW, y: outH }, destBL = { x: 0, y: outH };

  drawAffineTriangle(ctx, source, [tl, tr, bl], [destTL, destTR, destBL]);
  drawAffineTriangle(ctx, source, [tr, br, bl], [destTR, destBR, destBL]);
  return out;
}

function drawAffineTriangle(ctx, image, srcTri, dstTri) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(dstTri[0].x, dstTri[0].y);
  ctx.lineTo(dstTri[1].x, dstTri[1].y);
  ctx.lineTo(dstTri[2].x, dstTri[2].y);
  ctx.closePath();
  ctx.clip();

  const [s0, s1, s2] = srcTri;
  const [d0, d1, d2] = dstTri;
  // Solve the 2x3 affine matrix mapping src triangle -> dst triangle.
  const denom = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
  if (denom === 0) { ctx.restore(); return; }
  const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / denom;
  const b = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / denom;
  const c = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / denom;
  const d = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / denom;
  const e = d0.x - a * s0.x - b * s0.y;
  const f = d0.y - c * s0.x - d * s0.y;

  ctx.setTransform(a, c, b, d, e, f);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

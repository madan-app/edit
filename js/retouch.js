// =============================================================
// retouch.js — practical, browser-only retouching algorithms.
// These are approximations of professional tools (no ML model),
// clearly scoped as such: solid for casual touch-ups, not
// claiming AI-grade content-aware fill.
// =============================================================

const clamp8 = v => v < 0 ? 0 : v > 255 ? 255 : v;

/** Clone Stamp: copy a circular patch from (srcX,srcY) to (dstX,dstY). */
export function cloneStamp(ctx, srcX, srcY, dstX, dstY, radius, opacityPct = 100) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, opacityPct / 100));
  ctx.beginPath();
  ctx.arc(dstX, dstY, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(
    ctx.canvas,
    srcX - radius, srcY - radius, radius * 2, radius * 2,
    dstX - radius, dstY - radius, radius * 2, radius * 2
  );
  ctx.restore();
}

/**
 * Healing Brush: like clone stamp, but afterwards nudges the pasted
 * patch's mean luminance/color to match the surrounding ring of the
 * destination area, so texture transfers but tone blends in.
 */
export function healingBrush(ctx, srcX, srcY, dstX, dstY, radius, opacityPct = 100) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const ringSample = sampleRingStats(ctx, dstX, dstY, radius, radius * 1.6, w, h);
  cloneStamp(ctx, srcX, srcY, dstX, dstY, radius, 100);
  const patch = ctx.getImageData(
    Math.max(0, dstX - radius), Math.max(0, dstY - radius),
    Math.min(w, dstX + radius) - Math.max(0, dstX - radius),
    Math.min(h, dstY + radius) - Math.max(0, dstY - radius)
  );
  const patchStats = imageStats(patch.data);
  const dr = ringSample.r - patchStats.r;
  const dg = ringSample.g - patchStats.g;
  const db = ringSample.b - patchStats.b;
  const alpha = Math.max(0, Math.min(1, opacityPct / 100));
  for (let i = 0; i < patch.data.length; i += 4) {
    patch.data[i] = clamp8(patch.data[i] + dr * 0.6 * alpha);
    patch.data[i + 1] = clamp8(patch.data[i + 1] + dg * 0.6 * alpha);
    patch.data[i + 2] = clamp8(patch.data[i + 2] + db * 0.6 * alpha);
  }
  ctx.putImageData(patch, Math.max(0, dstX - radius), Math.max(0, dstY - radius));
}

/**
 * Spot Removal: fills a circular blemish using the median color sampled
 * from a ring just outside the spot (fast, dependency-free content fill).
 */
export function spotRemoval(ctx, x, y, radius) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const ring = sampleRingStats(ctx, x, y, radius, radius * 1.8, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.clip();
  const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
  const color = `rgb(${ring.r | 0},${ring.g | 0},${ring.b | 0})`;
  grad.addColorStop(0, color);
  grad.addColorStop(1, color);
  ctx.fillStyle = grad;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  // light noise re-texture so the fill doesn't look flat
  ctx.restore();
}

/** Red Eye Removal: darken + desaturate red pixels within a circular region. */
export function redEyeRemoval(ctx, x, y, radius) {
  const size = radius * 2;
  const sx = Math.max(0, x - radius), sy = Math.max(0, y - radius);
  const imageData = ctx.getImageData(sx, sy, Math.min(size, ctx.canvas.width - sx), Math.min(size, ctx.canvas.height - sy));
  const { data, width, height } = imageData;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const dx = px - radius, dy = py - radius;
      if (dx * dx + dy * dy > radius * radius) continue;
      const i = (py * width + px) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      // classic red-eye signature: red significantly higher than green/blue
      if (r > g * 1.3 && r > b * 1.1 && r > 60) {
        const gray = g * 0.6 + b * 0.4;
        data[i] = gray * 0.5;
        data[i + 1] = gray * 0.85;
        data[i + 2] = gray * 0.9;
      }
    }
  }
  ctx.putImageData(imageData, sx, sy);
}

// ---------------- helpers ----------------

function sampleRingStats(ctx, cx, cy, innerR, outerR, w, h) {
  const sx = Math.max(0, Math.floor(cx - outerR));
  const sy = Math.max(0, Math.floor(cy - outerR));
  const ex = Math.min(w, Math.ceil(cx + outerR));
  const ey = Math.min(h, Math.ceil(cy + outerR));
  const data = ctx.getImageData(sx, sy, Math.max(1, ex - sx), Math.max(1, ey - sy)).data;
  let r = 0, g = 0, b = 0, n = 0;
  const rw = ex - sx;
  for (let py = sy; py < ey; py++) {
    for (let px = sx; px < ex; px++) {
      const dx = px - cx, dy = py - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < innerR || dist > outerR) continue;
      const i = ((py - sy) * rw + (px - sx)) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  }
  if (!n) return { r: 128, g: 128, b: 128 };
  return { r: r / n, g: g / n, b: b / n };
}

function imageStats(data) {
  let r = 0, g = 0, b = 0, n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
  return { r: r / n, g: g / n, b: b / n };
}

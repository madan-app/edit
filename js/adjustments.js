// =============================================================
// adjustments.js
// Pure, dependency-free pixel processing engine.
// Every function mutates or returns a Uint8ClampedArray (RGBA).
// No DOM access here so this file can run on the main thread
// OR inside a Web Worker unmodified.
// =============================================================

export const DEFAULT_ADJUSTMENTS = () => ({
  exposure: 0, brightness: 0, contrast: 0,
  highlights: 0, shadows: 0, whites: 0, blacks: 0,
  temperature: 0, tint: 0, vibrance: 0, saturation: 0, hue: 0,
  texture: 0, clarity: 0, dehaze: 0, sharpness: 0,
  noiseReduction: 0, grain: 0, vignette: 0,
  curves: { rgb: null, r: null, g: null, b: null },
  hsl: {}, // { red: {h,s,l}, orange:{...}, ... } each -100..100
  colorGrading: {
    shadows: { h: 0, s: 0 }, midtones: { h: 0, s: 0 },
    highlights: { h: 0, s: 0 }, global: { h: 0, s: 0, l: 0 }
  }
});

export function cloneAdjustments(a) {
  return JSON.parse(JSON.stringify(a));
}

/** Deep-merge a partial/serialized adjustments object onto a full default,
 *  so presets saved with sparse `colorGrading`/`hsl`/`curves` never leave
 *  a zone or channel undefined for later slider updates. */
export function normalizeAdjustments(partial = {}) {
  const base = DEFAULT_ADJUSTMENTS();
  for (const key of Object.keys(base)) {
    if (!(key in partial)) continue;
    if (key === 'colorGrading') {
      for (const zone of Object.keys(base.colorGrading)) {
        base.colorGrading[zone] = { ...base.colorGrading[zone], ...(partial.colorGrading?.[zone] || {}) };
      }
    } else if (key === 'curves') {
      base.curves = { ...base.curves, ...(partial.curves || {}) };
    } else if (key === 'hsl') {
      base.hsl = { ...(partial.hsl || {}) };
    } else {
      base[key] = partial[key];
    }
  }
  return base;
}

export function isIdentity(a) {
  const d = DEFAULT_ADJUSTMENTS();
  for (const k of Object.keys(d)) {
    if (k === 'curves' || k === 'hsl' || k === 'colorGrading') continue;
    if ((a[k] || 0) !== 0) return false;
  }
  if (a.curves && (a.curves.rgb || a.curves.r || a.curves.g || a.curves.b)) return false;
  if (a.hsl && Object.keys(a.hsl).length) return false;
  const cg = a.colorGrading;
  if (cg) {
    for (const zone of Object.values(cg)) {
      if (zone && (zone.h || zone.s || zone.l)) return false;
    }
  }
  return true;
}

// -------------------------------------------------------------
// Small helpers
// -------------------------------------------------------------
const clamp8 = v => v < 0 ? 0 : v > 255 ? 255 : v;

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h * 360, s, l];
}

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h, s, l) {
  h /= 360;
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [r * 255, g * 255, b * 255];
}

// 8 named HSL color ranges (approximate hue centers, in degrees)
export const HSL_RANGES = [
  { key: 'red', hue: 0, color: '#e2574c' },
  { key: 'orange', hue: 30, color: '#e2914c' },
  { key: 'yellow', hue: 55, color: '#dccb4a' },
  { key: 'green', hue: 120, color: '#55c26a' },
  { key: 'aqua', hue: 180, color: '#49c5c5' },
  { key: 'blue', hue: 220, color: '#4b8ff0' },
  { key: 'purple', hue: 275, color: '#9066e0' },
  { key: 'magenta', hue: 320, color: '#d15fc0' }
];

function hueWeight(hue, center) {
  let d = Math.abs(hue - center);
  if (d > 180) d = 360 - d;
  const width = 45; // falloff width in degrees
  return Math.max(0, 1 - d / width);
}

// -------------------------------------------------------------
// Curves: build a 256-entry LUT from control points [[x,y],...]
// using a monotonic cubic (Fritsch-Carlson-ish simplified) spline.
// -------------------------------------------------------------
export function buildCurveLUT(points) {
  const lut = new Uint8ClampedArray(256);
  if (!points || points.length < 2) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < 256; i++) {
    // find bracketing segment
    let j = 0;
    while (j < pts.length - 2 && pts[j + 1][0] < i) j++;
    const [x0, y0] = pts[j];
    const [x1, y1] = pts[j + 1] || pts[j];
    const t = x1 === x0 ? 0 : (i - x0) / (x1 - x0);
    // smoothstep interpolation for a gentle, non-linear feel
    const s = t * t * (3 - 2 * t);
    lut[i] = clamp8(y0 + (y1 - y0) * s);
  }
  return lut;
}

export function combineLUTs(base, channel) {
  // apply `channel` after `base`
  const out = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) out[i] = channel[base[i]];
  return out;
}

// -------------------------------------------------------------
// Main per-pixel pass: light + color + curves in one loop
// for performance (avoids multiple full-image passes).
// -------------------------------------------------------------
export function applyBasicAndColor(data, adj) {
  const exposure = adj.exposure || 0;      // -100..100 -> multiplicative stops
  const brightness = adj.brightness || 0;  // -100..100 additive
  const contrast = adj.contrast || 0;      // -100..100
  const highlights = adj.highlights || 0;
  const shadows = adj.shadows || 0;
  const whites = adj.whites || 0;
  const blacks = adj.blacks || 0;
  const temperature = adj.temperature || 0;
  const tint = adj.tint || 0;
  const vibrance = adj.vibrance || 0;
  const saturation = adj.saturation || 0;
  const hueShift = adj.hue || 0;

  const expMul = Math.pow(2, exposure / 50);
  const contFactor = (259 * (contrast * 2.55 + 255)) / (255 * (259 - contrast * 2.55));
  const brightAdd = brightness * 1.6;

  const rLUT = adj.curves && adj.curves.r ? buildCurveLUT(adj.curves.r) : null;
  const gLUT = adj.curves && adj.curves.g ? buildCurveLUT(adj.curves.g) : null;
  const bLUT = adj.curves && adj.curves.b ? buildCurveLUT(adj.curves.b) : null;
  const rgbLUT = adj.curves && adj.curves.rgb ? buildCurveLUT(adj.curves.rgb) : null;

  const hslActive = adj.hsl && Object.keys(adj.hsl).length > 0;
  const cg = adj.colorGrading;
  const cgActive = cg && Object.values(cg).some(z => z && (z.h || z.s || z.l));

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i], g = data[i + 1], b = data[i + 2];

    // Exposure (multiplicative, like camera stops)
    r *= expMul; g *= expMul; b *= expMul;

    // White balance: temperature (blue<->amber) & tint (green<->magenta)
    if (temperature !== 0) {
      r += temperature * 0.9;
      b -= temperature * 0.9;
    }
    if (tint !== 0) {
      g += tint * 0.7;
      r -= tint * 0.35;
      b -= tint * 0.35;
    }

    // Brightness (additive) + contrast (around midpoint)
    r += brightAdd; g += brightAdd; b += brightAdd;
    r = contFactor * (r - 128) + 128;
    g = contFactor * (g - 128) + 128;
    b = contFactor * (b - 128) + 128;

    // Tone regions: shadows/highlights/whites/blacks act on luminance bands
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (highlights !== 0) {
      const w = Math.max(0, (lum - 128) / 127); // 0 at mid, 1 at white
      const f = (highlights / 100) * w * 60;
      r += f; g += f; b += f;
    }
    if (shadows !== 0) {
      const w = Math.max(0, (128 - lum) / 128); // 0 at mid, 1 at black
      const f = (shadows / 100) * w * 60;
      r += f; g += f; b += f;
    }
    if (whites !== 0) {
      const w = Math.max(0, (lum - 192) / 63);
      const f = (whites / 100) * Math.min(1, w) * 70;
      r += f; g += f; b += f;
    }
    if (blacks !== 0) {
      const w = Math.max(0, (64 - lum) / 64);
      const f = (blacks / 100) * Math.min(1, w) * 70;
      r += f; g += f; b += f;
    }

    r = clamp8(r); g = clamp8(g); b = clamp8(b);

    // Saturation / vibrance / hue rotation via HSL round-trip
    if (saturation !== 0 || vibrance !== 0 || hueShift !== 0 || hslActive || cgActive) {
      let [h, s, l] = rgbToHsl(r, g, b);

      if (hueShift !== 0) h = (h + hueShift + 360) % 360;

      if (saturation !== 0) {
        s = Math.max(0, Math.min(1, s * (1 + saturation / 100)));
      }
      if (vibrance !== 0) {
        // vibrance protects already-saturated pixels more than flat ones
        const protect = 1 - s;
        s = Math.max(0, Math.min(1, s + (vibrance / 100) * protect * 0.9));
      }

      if (hslActive) {
        for (const range of HSL_RANGES) {
          const adjR = adj.hsl[range.key];
          if (!adjR) continue;
          const w = hueWeight(h, range.hue);
          if (w <= 0) continue;
          if (adjR.h) h = (h + adjR.h * 0.6 * w + 360) % 360;
          if (adjR.s) s = Math.max(0, Math.min(1, s + (adjR.s / 100) * w));
          if (adjR.l) l = Math.max(0, Math.min(1, l + (adjR.l / 100) * 0.5 * w));
        }
      }

      if (cgActive) {
        const shadowW = Math.max(0, (0.5 - l) * 2);
        const highW = Math.max(0, (l - 0.5) * 2);
        const midW = 1 - Math.abs(l - 0.5) * 2;
        const zones = [
          [cg.shadows, shadowW], [cg.midtones, Math.max(0, midW)], [cg.highlights, highW]
        ];
        let dh = 0, ds = 0;
        for (const [zone, w] of zones) {
          if (!zone || w <= 0) continue;
          dh += (zone.h || 0) * w;
          ds += (zone.s || 0) * w;
        }
        if (cg.global) {
          dh += cg.global.h || 0;
          ds += cg.global.s || 0;
          l = Math.max(0, Math.min(1, l + (cg.global.l || 0) / 200));
        }
        if (dh) h = (h + dh * 0.3 + 360) % 360;
        if (ds) s = Math.max(0, Math.min(1, s + ds / 150));
      }

      [r, g, b] = hslToRgb(h, s, l);
    }

    // Curves (applied last, per-channel then combined RGB)
    if (rLUT) r = rLUT[clamp8(r)];
    if (gLUT) g = gLUT[clamp8(g)];
    if (bLUT) b = bLUT[clamp8(b)];
    if (rgbLUT) { r = rgbLUT[clamp8(r)]; g = rgbLUT[clamp8(g)]; b = rgbLUT[clamp8(b)]; }

    data[i] = clamp8(r); data[i + 1] = clamp8(g); data[i + 2] = clamp8(b);
  }
  return data;
}

// -------------------------------------------------------------
// Box blur (used by clarity/texture/dehaze/noise reduction/sharpness)
// Separable, O(n) per row/col using a sliding accumulator.
// -------------------------------------------------------------
export function boxBlurGray(gray, width, height, radius) {
  if (radius < 1) return gray;
  const out = new Float32Array(gray.length);
  const tmp = new Float32Array(gray.length);
  const size = radius * 2 + 1;

  for (let y = 0; y < height; y++) {
    let sum = 0;
    const row = y * width;
    for (let x = -radius; x <= radius; x++) sum += gray[row + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x++) {
      tmp[row + x] = sum / size;
      const addX = Math.min(width - 1, x + radius + 1);
      const subX = Math.max(0, x - radius);
      sum += gray[row + addX] - gray[row + subX];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(height - 1, Math.max(0, y)) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / size;
      const addY = Math.min(height - 1, y + radius + 1);
      const subY = Math.max(0, y - radius);
      sum += tmp[addY * width + x] - tmp[subY * width + x];
    }
  }
  return out;
}

function toGray(data, width, height) {
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return gray;
}

// Local-contrast family: clarity (mid-freq), texture (high-freq), dehaze (large radius + contrast punch)
export function applyLocalContrast(data, width, height, { clarity = 0, texture = 0, dehaze = 0 }) {
  if (!clarity && !texture && !dehaze) return data;
  const gray = toGray(data, width, height);

  const applyPass = (amount, radius) => {
    if (!amount) return;
    const blurred = boxBlurGray(gray, width, height, radius);
    const strength = amount / 100;
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const detail = gray[p] - blurred[p];
      const add = detail * strength * 1.2;
      data[i] = clamp8(data[i] + add);
      data[i + 1] = clamp8(data[i + 1] + add);
      data[i + 2] = clamp8(data[i + 2] + add);
    }
  };

  applyPass(texture, 2);
  applyPass(clarity, 12);
  if (dehaze) {
    // Dehaze approximated as strong local contrast + slight desaturation of haze + contrast curve
    applyPass(dehaze * 0.8, 24);
    const k = 1 + Math.abs(dehaze) / 200 * Math.sign(dehaze);
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        data[i + c] = clamp8((data[i + c] - 128) * k + 128 + dehaze * 0.15);
      }
    }
  }
  return data;
}

export function applySharpness(data, width, height, amount) {
  if (!amount) return data;
  const gray = toGray(data, width, height);
  const blurred = boxBlurGray(gray, width, height, 1);
  const strength = (amount / 100) * 1.5;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const edge = gray[p] - blurred[p];
    const add = edge * strength;
    data[i] = clamp8(data[i] + add);
    data[i + 1] = clamp8(data[i + 1] + add);
    data[i + 2] = clamp8(data[i + 2] + add);
  }
  return data;
}

export function applyNoiseReduction(data, width, height, amount) {
  if (!amount) return data;
  const strength = Math.min(1, amount / 100);
  const radius = amount > 60 ? 2 : 1;
  for (const c of [0, 1, 2]) {
    const channel = new Float32Array(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) channel[p] = data[i + c];
    const blurred = boxBlurGray(channel, width, height, radius);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      data[i + c] = clamp8(channel[p] * (1 - strength) + blurred[p] * strength);
    }
  }
  return data;
}

export function applyGrain(data, width, height, amount) {
  if (!amount) return data;
  const strength = (amount / 100) * 24;
  // deterministic pseudo-random so re-renders of the same frame look stable while dragging
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff) - 0.5;
  };
  for (let i = 0; i < data.length; i += 4) {
    const n = rand() * strength;
    data[i] = clamp8(data[i] + n);
    data[i + 1] = clamp8(data[i + 1] + n);
    data[i + 2] = clamp8(data[i + 2] + n);
  }
  return data;
}

export function applyVignette(data, width, height, amount) {
  if (!amount) return data;
  const cx = width / 2, cy = height / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);
  const strength = amount / 100;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) / maxDist;
      const falloff = Math.pow(dist, 2.2);
      const factor = 1 - falloff * Math.abs(strength) * (strength > 0 ? 1 : -1) * (strength > 0 ? 1 : 1);
      const mul = strength >= 0 ? (1 - falloff * strength) : (1 + falloff * Math.abs(strength) * 0.6);
      const i = (y * width + x) * 4;
      data[i] = clamp8(data[i] * mul);
      data[i + 1] = clamp8(data[i + 1] * mul);
      data[i + 2] = clamp8(data[i + 2] * mul);
    }
  }
  return data;
}

// -------------------------------------------------------------
// Master entry point: runs the full non-destructive recipe over
// an ImageData buffer. `quality` = 'preview' (skips slow passes
// at low strength) or 'full'.
// -------------------------------------------------------------
export function processImageData(imageData, adjustments, opts = {}) {
  const { width, height, data } = imageData;
  if (isIdentity(adjustments)) return imageData;

  applyBasicAndColor(data, adjustments);
  applyLocalContrast(data, width, height, adjustments);
  if (adjustments.sharpness) applySharpness(data, width, height, adjustments.sharpness);
  if (adjustments.noiseReduction) applyNoiseReduction(data, width, height, adjustments.noiseReduction);
  if (adjustments.grain) applyGrain(data, width, height, adjustments.grain);
  if (adjustments.vignette) applyVignette(data, width, height, adjustments.vignette);
  return imageData;
}

// =============================================================
// filters.js — one-tap filter engine.
// Every filter is implemented as a concrete recipe of real pixel
// operations (reusing adjustments.js), NOT a CSS filter string.
// Filters are expressed as partial "adjustments" overlays plus an
// optional post pass (duotone/split-tone) so they compose with the
// rest of the non-destructive stack.
// =============================================================

import { DEFAULT_ADJUSTMENTS, applyBasicAndColor, applyVignette, applyGrain } from './adjustments.js';

// Each filter = { id, name, adjust: partial adjustments object, post?: fn(data,w,h,strength) }
export const FILTERS = [
  { id: 'original', name: 'Original', adjust: {} },

  { id: 'vintage', name: 'Vintage', adjust: {
    exposure: 4, contrast: -8, saturation: -18, temperature: 14, tint: 4, vignette: 30, grain: 12,
    colorGrading: { shadows: { h: 40, s: 18 }, midtones: {h:0,s:0}, highlights: { h: 45, s: 10 }, global: {h:0,s:0,l:0} }
  }},

  { id: 'retro', name: 'Retro', adjust: {
    contrast: 10, saturation: 20, temperature: 10, tint: -6, vignette: 18,
    colorGrading: { shadows: { h: 190, s: 12 }, midtones:{h:0,s:0}, highlights: { h: 40, s: 14 }, global:{h:0,s:0,l:0} }
  }},

  { id: 'cinematic', name: 'Cinematic', adjust: {
    contrast: 18, shadows: -10, highlights: -8, saturation: -10, clarity: 12, vignette: 24,
    colorGrading: { shadows: { h: 195, s: 22 }, midtones:{h:0,s:0}, highlights: { h: 35, s: 16 }, global:{h:0,s:0,l:0} }
  }},

  { id: 'warm', name: 'Warm', adjust: { temperature: 26, tint: 4, vibrance: 12, exposure: 3 } },

  { id: 'cool', name: 'Cool', adjust: { temperature: -24, tint: -2, vibrance: 8, contrast: 4 } },

  { id: 'dramatic', name: 'Dramatic', adjust: {
    contrast: 32, clarity: 28, shadows: -18, highlights: -14, saturation: -6, vignette: 34
  }},

  { id: 'portrait', name: 'Portrait', adjust: {
    contrast: 6, clarity: -8, vibrance: 14, temperature: 6, shadows: 8, vignette: 12
  }},

  { id: 'landscape', name: 'Landscape', adjust: {
    contrast: 12, clarity: 18, vibrance: 24, dehaze: 14, sharpness: 10
  }},

  { id: 'bw', name: 'Black & White', adjust: { saturation: -100, contrast: 14, clarity: 10 } },

  { id: 'sepia', name: 'Sepia', adjust: { saturation: -100, temperature: 0 },
    post: (data) => {
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        data[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
        data[i + 1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
        data[i + 2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
      }
    }},

  { id: 'faded', name: 'Faded', adjust: { contrast: -22, exposure: 8, saturation: -14, blacks: 20, shadows: 14 } },

  { id: 'film', name: 'Film', adjust: {
    contrast: 8, saturation: -6, grain: 22, vignette: 16, temperature: 6,
    colorGrading: { shadows: { h: 210, s: 10 }, midtones:{h:0,s:0}, highlights: { h: 45, s: 8 }, global:{h:0,s:0,l:0} }
  }},

  { id: 'food', name: 'Food', adjust: { vibrance: 30, saturation: 10, contrast: 10, temperature: 10, clarity: 12 } },

  { id: 'night', name: 'Night', adjust: {
    exposure: -6, contrast: 20, shadows: -20, temperature: -18, tint: 6, clarity: 10, vignette: 36
  }},

  { id: 'sunset', name: 'Sunset', adjust: {
    temperature: 30, tint: 8, saturation: 12, highlights: -10,
    colorGrading: { shadows: { h: 280, s: 14 }, midtones:{h:0,s:0}, highlights: { h: 25, s: 20 }, global:{h:0,s:0,l:0} }
  }},

  { id: 'neon', name: 'Neon', adjust: {
    contrast: 22, saturation: 34, clarity: 16,
    colorGrading: { shadows: { h: 285, s: 26 }, midtones:{h:0,s:0}, highlights: { h: 180, s: 22 }, global:{h:0,s:0,l:0} }
  }},

  { id: 'matte', name: 'Matte', adjust: { blacks: 24, contrast: -14, saturation: -8, whites: -10, texture: -8 } }
];

export function getFilterById(id) {
  return FILTERS.find(f => f.id === id) || FILTERS[0];
}

// Merge a filter's partial adjustment overlay onto a full adjustments object.
export function mergeFilterIntoAdjustments(base, filter, strength = 100) {
  const merged = JSON.parse(JSON.stringify(base));
  const s = strength / 100;
  const overlay = filter.adjust || {};
  for (const [key, val] of Object.entries(overlay)) {
    if (key === 'colorGrading') {
      merged.colorGrading = merged.colorGrading || {};
      for (const [zone, zv] of Object.entries(val)) {
        merged.colorGrading[zone] = merged.colorGrading[zone] || { h: 0, s: 0, l: 0 };
        merged.colorGrading[zone].h = (merged.colorGrading[zone].h || 0) + (zv.h || 0) * s;
        merged.colorGrading[zone].s = (merged.colorGrading[zone].s || 0) + (zv.s || 0) * s;
        merged.colorGrading[zone].l = (merged.colorGrading[zone].l || 0) + (zv.l || 0) * s;
      }
    } else if (typeof val === 'number') {
      merged[key] = (merged[key] || 0) + val * s;
    }
  }
  return merged;
}

// Render a small square thumbnail preview of a filter applied to source ImageData.
export function renderFilterThumb(sourceImageData, filter) {
  const w = sourceImageData.width, h = sourceImageData.height;
  const clone = new ImageData(new Uint8ClampedArray(sourceImageData.data), w, h);
  const adj = mergeFilterIntoAdjustments(DEFAULT_ADJUSTMENTS(), filter, 100);
  applyBasicAndColor(clone.data, adj);
  if (adj.vignette) applyVignette(clone.data, w, h, adj.vignette);
  if (adj.grain) applyGrain(clone.data, w, h, adj.grain);
  if (filter.post) filter.post(clone.data, w, h, 1);
  return clone;
}

// =============================================================
// stickers.js — local sticker library.
// Stickers are small original SVGs grouped by category, listed in
// assets/manifest.json so new stickers can be added without
// touching any JavaScript.
// =============================================================

let manifestCache = null;

export async function loadStickerManifest() {
  if (manifestCache) return manifestCache;
  try {
    const res = await fetch('./assets/manifest.json');
    manifestCache = await res.json();
  } catch (err) {
    manifestCache = { stickers: {}, presets: [], backgrounds: [] };
  }
  return manifestCache;
}

export async function loadStickerSVG(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error('Sticker asset could not be loaded.');
  return res.text();
}

/** Render an SVG string into a layer's canvas at a given pixel size. */
export function renderStickerToLayer(layer, svgText, size = 160) {
  return new Promise((resolve, reject) => {
    const svgBlob = new Blob([svgText], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      layer.canvas.width = size;
      layer.canvas.height = size;
      const ctx = layer.canvas.getContext('2d');
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve();
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not render sticker.')); };
    img.src = url;
  });
}

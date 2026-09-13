// =============================================================
// text.js — professional text layer renderer.
// Text layers keep their source data (string + style) and are
// RE-RENDERED into the layer canvas any time a property changes,
// so text remains fully editable (non-destructive).
// =============================================================

export const TEXT_FONTS = [
  { id: 'inter', label: 'Inter / System UI', family: '-apple-system, "Segoe UI", Inter, Arial, sans-serif' },
  { id: 'georgia', label: 'Georgia', family: 'Georgia, "Times New Roman", serif' },
  { id: 'courier', label: 'Courier New', family: '"Courier New", monospace' },
  { id: 'impact', label: 'Impact', family: 'Impact, "Arial Narrow Bold", sans-serif' },
  { id: 'comic', label: 'Comic Sans MS', family: '"Comic Sans MS", "Comic Sans", cursive' },
  { id: 'verdana', label: 'Verdana', family: 'Verdana, Geneva, sans-serif' }
];

export function defaultTextData() {
  return {
    text: 'Double-click to edit',
    fontId: 'inter',
    fontSize: 48,
    bold: false,
    italic: false,
    underline: false,
    align: 'left', // left | center | right
    color: '#ffffff',
    opacity: 100,
    strokeColor: '#000000',
    strokeWidth: 0,
    shadow: false,
    shadowColor: 'rgba(0,0,0,0.5)',
    shadowBlur: 8,
    letterSpacing: 0,
    lineSpacing: 1.2,
    backgroundColor: 'transparent',
    curved: false,
    curveRadius: 200
  };
}

function fontFamily(fontId) {
  return (TEXT_FONTS.find(f => f.id === fontId) || TEXT_FONTS[0]).family;
}

/** Measure and resize the layer canvas, then render the current text data into it. */
export function renderTextLayer(layer) {
  const d = layer.data;
  const style = `${d.italic ? 'italic ' : ''}${d.bold ? '700 ' : '400 '}${d.fontSize}px ${fontFamily(d.fontId)}`;
  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');
  mctx.font = style;
  const lines = d.text.split('\n');
  let maxWidth = 1;
  for (const line of lines) {
    const w = mctx.measureText(line).width + Math.max(0, d.letterSpacing) * line.length;
    if (w > maxWidth) maxWidth = w;
  }
  const lineHeight = d.fontSize * d.lineSpacing;
  const pad = Math.max(20, d.shadowBlur + d.strokeWidth + 10);
  const width = Math.ceil(maxWidth) + pad * 2;
  const height = Math.ceil(lineHeight * lines.length) + pad * 2;

  layer.canvas.width = Math.max(1, width);
  layer.canvas.height = Math.max(1, height);
  const ctx = layer.canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  ctx.font = style;
  ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = Math.max(0, Math.min(1, d.opacity / 100));

  if (d.backgroundColor && d.backgroundColor !== 'transparent') {
    ctx.fillStyle = d.backgroundColor;
    ctx.fillRect(0, 0, width, height);
  }

  lines.forEach((line, i) => {
    const y = pad + d.fontSize * 0.85 + i * lineHeight;
    let x = pad;
    if (d.align === 'center') x = width / 2;
    if (d.align === 'right') x = width - pad;
    ctx.textAlign = d.align;

    if (d.letterSpacing) {
      drawLetterSpaced(ctx, line, x, y, d);
    } else {
      if (d.shadow) {
        ctx.shadowColor = d.shadowColor;
        ctx.shadowBlur = d.shadowBlur;
      } else {
        ctx.shadowBlur = 0;
      }
      if (d.strokeWidth > 0) {
        ctx.lineWidth = d.strokeWidth;
        ctx.strokeStyle = d.strokeColor;
        ctx.strokeText(line, x, y);
      }
      ctx.fillStyle = d.color;
      ctx.fillText(line, x, y);
      if (d.underline) {
        const w = ctx.measureText(line).width;
        const ux = d.align === 'center' ? x - w / 2 : d.align === 'right' ? x - w : x;
        ctx.fillRect(ux, y + 4, w, Math.max(2, d.fontSize * 0.06));
      }
    }
  });
  ctx.shadowBlur = 0;
}

function drawLetterSpaced(ctx, line, startX, y, d) {
  const chars = [...line];
  let widths = chars.map(c => ctx.measureText(c).width + d.letterSpacing);
  const total = widths.reduce((a, b) => a + b, 0);
  let x = startX;
  if (d.align === 'center') x = startX - total / 2;
  if (d.align === 'right') x = startX - total;
  ctx.textAlign = 'left';
  if (d.shadow) { ctx.shadowColor = d.shadowColor; ctx.shadowBlur = d.shadowBlur; }
  chars.forEach((c, i) => {
    if (d.strokeWidth > 0) { ctx.lineWidth = d.strokeWidth; ctx.strokeStyle = d.strokeColor; ctx.strokeText(c, x, y); }
    ctx.fillStyle = d.color;
    ctx.fillText(c, x, y);
    x += widths[i];
  });
}

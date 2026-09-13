// =============================================================
// shapes.js — vector shape layers.
// Like text layers, shapes keep their source data and are
// re-rendered whenever a property (fill/stroke/rotation…) changes.
// =============================================================

export const SHAPE_TYPES = ['rectangle', 'rounded-rectangle', 'circle', 'ellipse', 'triangle', 'star', 'polygon', 'line', 'arrow'];

export function defaultShapeData(type) {
  return {
    type,
    width: 220,
    height: 160,
    fill: '#49c5b6',
    stroke: '#0f1114',
    strokeWidth: 4,
    opacity: 100,
    cornerRadius: 18,
    sides: 6,
    points: 5
  };
}

export function renderShapeLayer(layer) {
  const d = layer.data;
  const pad = Math.max(4, d.strokeWidth);
  const w = Math.max(4, d.width) + pad * 2;
  const h = Math.max(4, d.height) + pad * 2;
  layer.canvas.width = w;
  layer.canvas.height = h;
  const ctx = layer.canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.globalAlpha = Math.max(0, Math.min(1, d.opacity / 100));
  ctx.fillStyle = d.fill;
  ctx.strokeStyle = d.stroke;
  ctx.lineWidth = d.strokeWidth;
  ctx.lineJoin = 'round';

  const cx = w / 2, cy = h / 2, rw = d.width / 2, rh = d.height / 2;
  ctx.beginPath();
  switch (d.type) {
    case 'rectangle':
      ctx.rect(pad, pad, d.width, d.height);
      break;
    case 'rounded-rectangle':
      roundRectPath(ctx, pad, pad, d.width, d.height, Math.min(d.cornerRadius, d.width / 2, d.height / 2));
      break;
    case 'circle':
      ctx.arc(cx, cy, Math.min(rw, rh), 0, Math.PI * 2);
      break;
    case 'ellipse':
      ctx.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2);
      break;
    case 'triangle':
      ctx.moveTo(cx, pad);
      ctx.lineTo(pad + d.width, pad + d.height);
      ctx.lineTo(pad, pad + d.height);
      ctx.closePath();
      break;
    case 'star':
      starPath(ctx, cx, cy, Math.min(rw, rh), Math.min(rw, rh) * 0.45, d.points || 5);
      break;
    case 'polygon':
      polygonPath(ctx, cx, cy, Math.min(rw, rh), d.sides || 6);
      break;
    case 'line':
      ctx.moveTo(pad, cy);
      ctx.lineTo(pad + d.width, cy);
      break;
    case 'arrow':
      arrowPath(ctx, pad, cy, pad + d.width, cy, Math.min(rh, 40));
      break;
    default:
      ctx.rect(pad, pad, d.width, d.height);
  }
  if (d.type !== 'line' && d.type !== 'arrow') ctx.fill();
  if (d.strokeWidth > 0) ctx.stroke();
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function starPath(ctx, cx, cy, outerR, innerR, points) {
  const step = Math.PI / points;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = i * step - Math.PI / 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function polygonPath(ctx, cx, cy, radius, sides) {
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function arrowPath(ctx, x0, y0, x1, y1, headSize) {
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const shaftEnd = x1 - Math.cos(angle) * headSize * 0.8;
  ctx.moveTo(x0, y0);
  ctx.lineTo(shaftEnd, y0);
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - headSize * Math.cos(angle - Math.PI / 6), y1 - headSize * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - headSize * Math.cos(angle + Math.PI / 6), y1 - headSize * Math.sin(angle + Math.PI / 6));
}

// =============================================================
// drawing.js — freehand drawing tools applied to a layer canvas.
// =============================================================

export const DRAWING_TOOLS = ['pencil', 'brush', 'marker', 'highlighter', 'eraser', 'smudge', 'blur'];

/**
 * Draw one segment of a freehand stroke.
 * ctx        - target layer 2D context
 * tool       - one of DRAWING_TOOLS
 * from/to    - {x,y} points in layer-local pixel space
 * opts       - { size, opacity(0-100), hardness(0-100), feather(0-100), color }
 */
export function drawStrokeSegment(ctx, tool, from, to, opts) {
  const { size, opacity, hardness, feather, color } = opts;
  const alpha = Math.max(0, Math.min(1, opacity / 100));

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (tool) {
    case 'pencil':
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, size * 0.35);
      ctx.filter = 'none';
      strokeLine(ctx, from, to);
      break;

    case 'brush': {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      const blur = Math.max(0, (100 - hardness) / 100) * size * 0.25;
      ctx.filter = blur > 0.3 ? `blur(${blur}px)` : 'none';
      strokeLine(ctx, from, to);
      break;
    }

    case 'marker':
      ctx.globalAlpha = Math.min(1, alpha * 1.0);
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.globalCompositeOperation = 'source-over';
      strokeLine(ctx, from, to);
      break;

    case 'highlighter':
      ctx.globalAlpha = Math.min(0.35, alpha * 0.4 + 0.1);
      ctx.strokeStyle = color;
      ctx.lineWidth = size * 1.6;
      ctx.globalCompositeOperation = 'multiply';
      strokeLine(ctx, from, to);
      break;

    case 'eraser':
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = size;
      const eBlur = Math.max(0, (100 - hardness) / 100) * size * 0.2;
      ctx.filter = eBlur > 0.3 ? `blur(${eBlur}px)` : 'none';
      strokeLine(ctx, from, to);
      break;

    case 'smudge':
      smudgeSegment(ctx, from, to, size, alpha);
      break;

    case 'blur':
      blurSegment(ctx, from, to, size, alpha);
      break;
  }
  ctx.restore();
}

function strokeLine(ctx, from, to) {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

/** Smudge: pulls pixel color from `from` toward `to`, blended with existing content. */
function smudgeSegment(ctx, from, to, size, alpha) {
  const r = size / 2;
  const sx = Math.max(0, Math.floor(from.x - r)), sy = Math.max(0, Math.floor(from.y - r));
  const w = Math.min(ctx.canvas.width - sx, size), h = Math.min(ctx.canvas.height - sy, size);
  if (w <= 0 || h <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalAlpha = alpha;
  ctx.drawImage(ctx.canvas, sx, sy, w, h, to.x - r, to.y - r, w, h);
  ctx.restore();
}

/** Localized blur brush: blurs a small circular region under the cursor. */
function blurSegment(ctx, from, to, size, alpha) {
  const r = size / 2;
  const sx = Math.max(0, Math.floor(to.x - r)), sy = Math.max(0, Math.floor(to.y - r));
  const w = Math.min(ctx.canvas.width - sx, size), h = Math.min(ctx.canvas.height - sy, size);
  if (w <= 0 || h <= 0) return;
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const tctx = tmp.getContext('2d');
  tctx.filter = `blur(${Math.max(1, size * 0.15)}px)`;
  tctx.drawImage(ctx.canvas, sx, sy, w, h, 0, 0, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalAlpha = alpha;
  ctx.drawImage(tmp, sx, sy);
  ctx.restore();
}

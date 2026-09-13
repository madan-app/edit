// =============================================================
// canvas.js — viewport (zoom/pan/fit) + screen<->image coordinate
// mapping + before/after compare divider. Actual pixel rendering
// of the composite lives in editor.js; this module only manages
// how that composite is displayed inside #canvas-viewport.
// =============================================================

export class CanvasViewport {
  constructor({ viewport, stack, mainCanvas, overlayCanvas, emptyHint }) {
    this.viewport = viewport;
    this.stack = stack;
    this.mainCanvas = mainCanvas;
    this.overlayCanvas = overlayCanvas;
    this.emptyHint = emptyHint;

    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.imageW = 0;
    this.imageH = 0;
    this.showGrid = false;
    this.compareMode = false;
    this.compareX = 0.5; // 0..1 fraction

    this.onZoomChange = () => {};
    this._bindPan();
  }

  setImageSize(w, h) {
    this.imageW = w;
    this.imageH = h;
    this.mainCanvas.width = w;
    this.mainCanvas.height = h;
    this.overlayCanvas.width = w;
    this.overlayCanvas.height = h;
    this.emptyHint.classList.add('hidden');
    this.fitToScreen();
  }

  clear() {
    this.imageW = 0; this.imageH = 0;
    this.emptyHint.classList.remove('hidden');
  }

  fitToScreen() {
    if (!this.imageW) return;
    const pad = 32;
    const vw = this.viewport.clientWidth - pad * 2;
    const vh = this.viewport.clientHeight - pad * 2;
    this.zoom = Math.max(0.02, Math.min(vw / this.imageW, vh / this.imageH, 4));
    this.panX = (this.viewport.clientWidth - this.imageW * this.zoom) / 2;
    this.panY = (this.viewport.clientHeight - this.imageH * this.zoom) / 2;
    this.apply();
  }

  zoomTo(z, anchorScreenX, anchorScreenY) {
    const prevZoom = this.zoom;
    z = Math.max(0.02, Math.min(z, 8));
    if (anchorScreenX == null) {
      anchorScreenX = this.viewport.clientWidth / 2;
      anchorScreenY = this.viewport.clientHeight / 2;
    }
    const imgX = (anchorScreenX - this.panX) / prevZoom;
    const imgY = (anchorScreenY - this.panY) / prevZoom;
    this.zoom = z;
    this.panX = anchorScreenX - imgX * z;
    this.panY = anchorScreenY - imgY * z;
    this.apply();
  }

  zoomBy(factor, anchorX, anchorY) { this.zoomTo(this.zoom * factor, anchorX, anchorY); }
  zoomTo100() { this.zoomTo(1); }

  pan(dx, dy) {
    this.panX += dx;
    this.panY += dy;
    this.apply();
  }

  apply() {
    this.stack.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    this.onZoomChange(this.zoom);
  }

  toggleGrid(force) {
    this.showGrid = force !== undefined ? force : !this.showGrid;
  }

  /** Convert a pointer/mouse event's client coords into image pixel space. */
  screenToImage(clientX, clientY) {
    const rect = this.viewport.getBoundingClientRect();
    const x = (clientX - rect.left - this.panX) / this.zoom;
    const y = (clientY - rect.top - this.panY) / this.zoom;
    return { x, y };
  }

  _bindPan() {
    let panning = false, lastX = 0, lastY = 0, spaceHeld = false;
    let pinchStartDist = null, pinchStartZoom = 1;
    const touches = new Map();

    window.addEventListener('keydown', e => { if (e.code === 'Space') spaceHeld = true; });
    window.addEventListener('keyup', e => { if (e.code === 'Space') spaceHeld = false; });

    this.viewport.addEventListener('wheel', e => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY < 0 ? 1.08 : 0.92;
        this.zoomBy(factor, e.clientX - this.viewport.getBoundingClientRect().left, e.clientY - this.viewport.getBoundingClientRect().top);
      } else {
        this.pan(-e.deltaX, -e.deltaY);
      }
    }, { passive: false });

    this.viewport.addEventListener('pointerdown', e => {
      if (e.button === 1 || (e.button === 0 && spaceHeld)) {
        panning = true; lastX = e.clientX; lastY = e.clientY;
        this.viewport.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    });
    window.addEventListener('pointermove', e => {
      if (panning) {
        this.pan(e.clientX - lastX, e.clientY - lastY);
        lastX = e.clientX; lastY = e.clientY;
      }
    });
    window.addEventListener('pointerup', () => { panning = false; });

    // Touch: pinch-zoom + two-finger pan
    this.viewport.addEventListener('touchstart', e => {
      for (const t of e.changedTouches) touches.set(t.identifier, t);
      if (touches.size === 2) {
        const pts = [...touches.values()];
        pinchStartDist = dist(pts[0], pts[1]);
        pinchStartZoom = this.zoom;
      }
    }, { passive: true });
    this.viewport.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) touches.set(t.identifier, t);
      if (touches.size === 2) {
        const pts = [...touches.values()];
        const d = dist(pts[0], pts[1]);
        if (pinchStartDist) {
          const cx = (pts[0].clientX + pts[1].clientX) / 2 - this.viewport.getBoundingClientRect().left;
          const cy = (pts[0].clientY + pts[1].clientY) / 2 - this.viewport.getBoundingClientRect().top;
          this.zoomTo(pinchStartZoom * (d / pinchStartDist), cx, cy);
        }
      }
    }, { passive: true });
    this.viewport.addEventListener('touchend', e => {
      for (const t of e.changedTouches) touches.delete(t.identifier);
      if (touches.size < 2) pinchStartDist = null;
    });
  }
}

function dist(a, b) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

// =============================================================
// editor.js — the central non-destructive editing engine.
// Owns the current project (layers + masks + adjustments),
// renders the live composite into the on-screen canvases, and
// exposes a small command API used by ui.js.
// =============================================================

import { DEFAULT_ADJUSTMENTS, cloneAdjustments, processImageData } from './adjustments.js';
import { createLayer, duplicateLayer, compositeLayers, BLEND_MODES } from './layers.js';
import { HistoryStack } from './history.js';
import { uid, Storage } from './storage.js';
import { getFilterById, mergeFilterIntoAdjustments } from './filters.js';
import { renderTextLayer } from './text.js';
import { renderShapeLayer } from './shapes.js';
import * as Transform from './transform.js';
import { renderFullResolutionComposite } from './export.js';
import { processImageDataOffThread } from './worker-client.js';

export class Editor {
  constructor(viewport) {
    this.viewport = viewport; // CanvasViewport instance
    this.project = null;
    this.history = new HistoryStack(() => this.onHistoryChange && this.onHistoryChange());
    this.activeTool = 'move';
    this.onProjectChange = () => {};
    this.onLayersChange = () => {};
    this._renderQueued = false;
    this._historyDebounce = null;
  }

  // ---------------------------------------------------------
  // Project lifecycle
  // ---------------------------------------------------------
  newProjectFromImage(loaded) {
    const base = createLayer('image', { width: loaded.previewWidth, height: loaded.previewHeight, name: 'Background' });
    base.canvas.getContext('2d').drawImage(loaded.previewCanvas, 0, 0);
    base.sourceCanvas = loaded.previewCanvas;
    base.locked = false;

    this.project = {
      id: uid('project'),
      name: (loaded.fileName || 'Untitled').replace(/\.[^.]+$/, ''),
      width: loaded.previewWidth,
      height: loaded.previewHeight,
      fullWidth: loaded.fullWidth,
      fullHeight: loaded.fullHeight,
      fullCanvas: loaded.fullCanvas,
      activeFilterId: 'original',
      filterStrength: 100,
      layers: [base],
      activeLayerId: base.id,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.viewport.setImageSize(this.project.width, this.project.height);
    this.history.reset('Open image', this._snapshot());
    this._refreshLayerCanvas(base);
    this.renderComposite();
    this.onProjectChange();
    this.onLayersChange();
  }

  hasProject() { return !!this.project; }

  getActiveLayer() {
    if (!this.project) return null;
    return this.project.layers.find(l => l.id === this.project.activeLayerId) || null;
  }

  setActiveLayer(id) {
    if (!this.project) return;
    this.project.activeLayerId = id;
    this.onLayersChange();
  }

  getBaseImageLayer() {
    return this.project.layers.find(l => l.type === 'image');
  }

  // ---------------------------------------------------------
  // Adjustments (Light / Color / Detail / Curves / HSL / Grading)
  // ---------------------------------------------------------
  updateAdjustments(partial, { commit = false, label = 'Adjust' } = {}) {
    const layer = this.getActiveLayer();
    if (!layer || layer.type !== 'image') return;
    Object.assign(layer.adjustments, partial);
    this._refreshLayerCanvas(layer);
    this.renderComposite();
    this._commitHistory(label, commit);
  }

  updateCurve(channel, points, commit = false) {
    const layer = this.getActiveLayer();
    if (!layer || layer.type !== 'image') return;
    layer.adjustments.curves[channel] = points;
    this._refreshLayerCanvas(layer);
    this.renderComposite();
    this._commitHistory('Curve', commit);
  }

  updateHSL(rangeKey, prop, value, commit = false) {
    const layer = this.getActiveLayer();
    if (!layer || layer.type !== 'image') return;
    layer.adjustments.hsl[rangeKey] = layer.adjustments.hsl[rangeKey] || { h: 0, s: 0, l: 0 };
    layer.adjustments.hsl[rangeKey][prop] = value;
    this._refreshLayerCanvas(layer);
    this.renderComposite();
    this._commitHistory('HSL', commit);
  }

  updateColorGrading(zone, prop, value, commit = false) {
    const layer = this.getActiveLayer();
    if (!layer || layer.type !== 'image') return;
    layer.adjustments.colorGrading[zone][prop] = value;
    this._refreshLayerCanvas(layer);
    this.renderComposite();
    this._commitHistory('Color grading', commit);
  }

  resetAdjustmentSection(keys) {
    const layer = this.getActiveLayer();
    if (!layer || layer.type !== 'image') return;
    const defaults = DEFAULT_ADJUSTMENTS();
    for (const k of keys) layer.adjustments[k] = defaults[k];
    this._refreshLayerCanvas(layer);
    this.renderComposite();
    this._commitHistory('Reset', true);
  }

  applyFilter(filterId, strength = 100) {
    this.project.activeFilterId = filterId;
    this.project.filterStrength = strength;
    const base = this.getBaseImageLayer();
    this._refreshLayerCanvas(base);
    this.renderComposite();
    this._commitHistory('Apply filter: ' + filterId, true);
  }

  // ---------------------------------------------------------
  // Rendering pipeline
  // ---------------------------------------------------------
  _refreshLayerCanvas(layer) {
    if (layer.type !== 'image' || !layer.sourceCanvas) return;
    const w = layer.sourceCanvas.width, h = layer.sourceCanvas.height;
    layer.canvas.width = w;
    layer.canvas.height = h;
    const ctx = layer.canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(layer.sourceCanvas, 0, 0);

    let adj = layer.adjustments;
    const isBase = layer === this.getBaseImageLayer();
    if (isBase && this.project.activeFilterId && this.project.activeFilterId !== 'original') {
      const filter = getFilterById(this.project.activeFilterId);
      adj = mergeFilterIntoAdjustments(layer.adjustments, filter, this.project.filterStrength);
    }
    const imageData = ctx.getImageData(0, 0, w, h);
    processImageData(imageData, adj);
    ctx.putImageData(imageData, 0, 0);
  }

  renderComposite() {
    if (!this.project) return;
    const ctx = this.viewport.mainCanvas.getContext('2d');
    compositeLayers(ctx, this.project.layers, this.project.width, this.project.height);
  }

  // ---------------------------------------------------------
  // Layers
  // ---------------------------------------------------------
  addLayer(type, opts = {}) {
    const layer = createLayer(type, { width: this.project.width, height: this.project.height, ...opts });
    this.project.layers.push(layer);
    this.project.activeLayerId = layer.id;
    this.onLayersChange();
    return layer;
  }

  addTextLayer(data) {
    const layer = createLayer('text', { name: 'Text' });
    layer.data = data;
    renderTextLayer(layer);
    layer.x = this.project.width / 2 - layer.canvas.width / 2;
    layer.y = this.project.height / 2 - layer.canvas.height / 2;
    this.project.layers.push(layer);
    this.project.activeLayerId = layer.id;
    this.renderComposite();
    this._commitHistory('Add text', true);
    this.onLayersChange();
    return layer;
  }

  updateTextLayer(layer, patch) {
    Object.assign(layer.data, patch);
    renderTextLayer(layer);
    this.renderComposite();
    this._commitHistory('Edit text', false);
  }

  addShapeLayer(data) {
    const layer = createLayer('shape', { name: 'Shape' });
    layer.data = data;
    renderShapeLayer(layer);
    layer.x = this.project.width / 2 - layer.canvas.width / 2;
    layer.y = this.project.height / 2 - layer.canvas.height / 2;
    this.project.layers.push(layer);
    this.project.activeLayerId = layer.id;
    this.renderComposite();
    this._commitHistory('Add shape', true);
    this.onLayersChange();
    return layer;
  }

  updateShapeLayer(layer, patch) {
    Object.assign(layer.data, patch);
    renderShapeLayer(layer);
    this.renderComposite();
    this._commitHistory('Edit shape', false);
  }

  addStickerLayer(name) {
    const layer = createLayer('sticker', { name: name || 'Sticker' });
    layer.x = this.project.width / 2 - 80;
    layer.y = this.project.height / 2 - 80;
    this.project.layers.push(layer);
    this.project.activeLayerId = layer.id;
    this.onLayersChange();
    return layer;
  }

  addDrawingLayer() {
    const layer = createLayer('drawing', { width: this.project.width, height: this.project.height, name: 'Drawing' });
    this.project.layers.push(layer);
    this.project.activeLayerId = layer.id;
    this.onLayersChange();
    return layer;
  }

  deleteLayer(id) {
    const layer = this.project.layers.find(l => l.id === id);
    if (!layer || layer.type === 'image' && this.project.layers.filter(l => l.type === 'image').length === 1) return;
    this.project.layers = this.project.layers.filter(l => l.id !== id);
    if (this.project.activeLayerId === id) {
      this.project.activeLayerId = this.project.layers[this.project.layers.length - 1].id;
    }
    this.renderComposite();
    this._commitHistory('Delete layer', true);
    this.onLayersChange();
  }

  duplicateActiveLayer() {
    const layer = this.getActiveLayer();
    if (!layer) return;
    const copy = duplicateLayer(layer);
    const idx = this.project.layers.indexOf(layer);
    this.project.layers.splice(idx + 1, 0, copy);
    this.project.activeLayerId = copy.id;
    this.renderComposite();
    this._commitHistory('Duplicate layer', true);
    this.onLayersChange();
  }

  reorderLayer(id, newIndex) {
    const idx = this.project.layers.findIndex(l => l.id === id);
    if (idx === -1) return;
    const [layer] = this.project.layers.splice(idx, 1);
    this.project.layers.splice(newIndex, 0, layer);
    this.renderComposite();
    this._commitHistory('Reorder layers', true);
    this.onLayersChange();
  }

  setLayerProp(id, patch) {
    const layer = this.project.layers.find(l => l.id === id);
    if (!layer) return;
    Object.assign(layer, patch);
    this.renderComposite();
    this._commitHistory('Layer property', patch.commit !== false);
    this.onLayersChange();
  }

  setLayerMask(id, mask) {
    const layer = this.project.layers.find(l => l.id === id);
    if (!layer) return;
    layer.mask = mask;
    this.renderComposite();
    this.onLayersChange();
  }

  // ---------------------------------------------------------
  // Transform ops (operate on the active image layer's source)
  // ---------------------------------------------------------
  // NOTE: crop/rotate/flip/straighten are mirrored onto `project.fullCanvas`
  // (the untouched full-resolution source) using the same proportional
  // rectangle/angle, so a full-resolution Export always reflects these
  // transforms exactly — not just the capped preview.

  cropProject(x, y, w, h) {
    const p = this.project;
    const scaleX = p.fullWidth / p.width, scaleY = p.fullHeight / p.height;
    for (const layer of p.layers) {
      if (layer.type === 'image') {
        layer.sourceCanvas = Transform.cropCanvas(layer.sourceCanvas, x, y, w, h);
      } else {
        layer.x -= x;
        layer.y -= y;
      }
    }
    p.fullCanvas = Transform.cropCanvas(p.fullCanvas, x * scaleX, y * scaleY, w * scaleX, h * scaleY);
    p.fullWidth = p.fullCanvas.width;
    p.fullHeight = p.fullCanvas.height;
    p.width = Math.round(w);
    p.height = Math.round(h);
    this.viewport.setImageSize(p.width, p.height);
    for (const layer of p.layers) if (layer.type === 'image') this._refreshLayerCanvas(layer);
    this.renderComposite();
    this._commitHistory('Crop', true);
    this.onLayersChange();
  }

  rotateProject(direction) {
    const p = this.project;
    for (const layer of p.layers) {
      if (layer.type === 'image') layer.sourceCanvas = Transform.rotate90(layer.sourceCanvas, direction);
    }
    p.fullCanvas = Transform.rotate90(p.fullCanvas, direction);
    [p.width, p.height] = [p.height, p.width];
    [p.fullWidth, p.fullHeight] = [p.fullHeight, p.fullWidth];
    this.viewport.setImageSize(p.width, p.height);
    for (const layer of p.layers) if (layer.type === 'image') this._refreshLayerCanvas(layer);
    this.renderComposite();
    this._commitHistory('Rotate', true);
  }

  flipProject(horizontal, vertical) {
    const p = this.project;
    for (const layer of p.layers) {
      if (layer.type === 'image') layer.sourceCanvas = Transform.flipCanvas(layer.sourceCanvas, horizontal, vertical);
    }
    p.fullCanvas = Transform.flipCanvas(p.fullCanvas, horizontal, vertical);
    for (const layer of p.layers) if (layer.type === 'image') this._refreshLayerCanvas(layer);
    this.renderComposite();
    this._commitHistory('Flip', true);
  }

  straightenProject(degrees) {
    const p = this.project;
    for (const layer of p.layers) {
      if (layer.type === 'image') layer.sourceCanvas = Transform.straightenCanvas(layer.sourceCanvas, degrees);
    }
    // Same angle applied to the full-res canvas independently: since both
    // canvases share the same aspect ratio, the auto-crop fraction matches.
    p.fullCanvas = Transform.straightenCanvas(p.fullCanvas, degrees);
    p.fullWidth = p.fullCanvas.width;
    p.fullHeight = p.fullCanvas.height;
    const base = this.getBaseImageLayer();
    p.width = base.sourceCanvas.width;
    p.height = base.sourceCanvas.height;
    this.viewport.setImageSize(p.width, p.height);
    for (const layer of p.layers) if (layer.type === 'image') this._refreshLayerCanvas(layer);
    this.renderComposite();
    this._commitHistory('Straighten', true);
  }

  resizeProject(w, h) {
    const p = this.project;
    for (const layer of p.layers) {
      if (layer.type === 'image') layer.sourceCanvas = Transform.resizeCanvas(layer.sourceCanvas, w, h);
    }
    p.width = Math.round(w);
    p.height = Math.round(h);
    this.viewport.setImageSize(p.width, p.height);
    for (const layer of p.layers) if (layer.type === 'image') this._refreshLayerCanvas(layer);
    this.renderComposite();
    this._commitHistory('Resize', true);
  }

  // ---------------------------------------------------------
  // History (debounced push for slider drags, immediate for
  // discrete actions like adding a layer or applying a filter)
  // ---------------------------------------------------------
  _commitHistory(label, immediate) {
    clearTimeout(this._historyDebounce);
    if (immediate) {
      this.history.push(label, this._snapshot());
      this._touchUpdatedAt();
      return;
    }
    this._historyDebounce = setTimeout(() => {
      this.history.push(label, this._snapshot());
      this._touchUpdatedAt();
    }, 400);
  }

  commitPendingHistory(label) {
    clearTimeout(this._historyDebounce);
    this.history.push(label || 'Adjust', this._snapshot());
    this._touchUpdatedAt();
  }

  _touchUpdatedAt() { if (this.project) this.project.updatedAt = Date.now(); }

  _snapshot() {
    // Lightweight snapshot: per-layer metadata + a preview-resolution
    // PNG data URL of each layer's raster content. We intentionally
    // avoid ever touching the full-resolution source during history,
    // which only exists once on `project.fullCanvas` for export.
    return {
      width: this.project.width,
      height: this.project.height,
      // Full-resolution canvas is only ever *replaced* (never mutated) by
      // crop/rotate/flip/straighten, so it's safe — and far cheaper than
      // re-encoding a duplicate — to keep a direct reference to it per step.
      fullCanvas: this.project.fullCanvas,
      fullWidth: this.project.fullWidth,
      fullHeight: this.project.fullHeight,
      activeFilterId: this.project.activeFilterId,
      filterStrength: this.project.filterStrength,
      activeLayerId: this.project.activeLayerId,
      layers: this.project.layers.map(l => ({
        id: l.id, type: l.type, name: l.name, visible: l.visible, locked: l.locked,
        opacity: l.opacity, blendMode: l.blendMode, x: l.x, y: l.y, rotation: l.rotation,
        scaleX: l.scaleX, scaleY: l.scaleY,
        adjustments: l.adjustments ? cloneAdjustments(l.adjustments) : null,
        data: JSON.parse(JSON.stringify(l.data || {})),
        maskDataURL: l.mask ? l.mask.canvas.toDataURL() : null,
        maskMeta: l.mask ? { opacity: l.mask.opacity, feather: l.mask.feather, inverted: l.mask.inverted, kind: l.mask.kind } : null,
        sourceDataURL: l.type === 'image' ? l.sourceCanvas.toDataURL() : null,
        canvasDataURL: l.type !== 'image' ? l.canvas.toDataURL() : null
      }))
    };
  }

  async restoreSnapshot(snapshot) {
    const p = this.project;
    p.width = snapshot.width;
    p.height = snapshot.height;
    if (snapshot.fullCanvas) { p.fullCanvas = snapshot.fullCanvas; p.fullWidth = snapshot.fullWidth; p.fullHeight = snapshot.fullHeight; }
    p.activeFilterId = snapshot.activeFilterId;
    p.filterStrength = snapshot.filterStrength;
    p.activeLayerId = snapshot.activeLayerId;

    const newLayers = [];
    for (const ld of snapshot.layers) {
      const layer = createLayer(ld.type, { width: 1, height: 1, name: ld.name });
      Object.assign(layer, {
        id: ld.id, visible: ld.visible, locked: ld.locked, opacity: ld.opacity,
        blendMode: ld.blendMode, x: ld.x, y: ld.y, rotation: ld.rotation,
        scaleX: ld.scaleX, scaleY: ld.scaleY, data: ld.data,
        adjustments: ld.adjustments
      });
      if (ld.type === 'image') {
        layer.sourceCanvas = await dataURLToCanvas(ld.sourceDataURL);
      } else if (ld.canvasDataURL) {
        layer.canvas = await dataURLToCanvas(ld.canvasDataURL);
      }
      if (ld.maskDataURL) {
        const maskCanvas = await dataURLToCanvas(ld.maskDataURL);
        layer.mask = { canvas: maskCanvas, ...ld.maskMeta };
      }
      newLayers.push(layer);
    }
    p.layers = newLayers;
    for (const layer of p.layers) if (layer.type === 'image') this._refreshLayerCanvas(layer);
    this.viewport.setImageSize(p.width, p.height);
    this.renderComposite();
    this.onLayersChange();
    this.onProjectChange();
  }

  async undo() {
    const snap = this.history.undo();
    if (snap) await this.restoreSnapshot(snap);
  }
  async redo() {
    const snap = this.history.redo();
    if (snap) await this.restoreSnapshot(snap);
  }
  async jumpHistory(index) {
    const snap = this.history.jumpTo(index);
    if (snap) await this.restoreSnapshot(snap);
  }

  // ---------------------------------------------------------
  // Serialization for IndexedDB project storage
  // ---------------------------------------------------------
  async serializeForStorage() {
    // The in-memory history snapshot holds a *live canvas reference* for
    // the full-resolution image (cheap for undo/redo). IndexedDB can't
    // structured-clone a canvas element, so strip that reference here and
    // store the full-res image once, as a single PNG data URL instead.
    const { fullCanvas, ...snap } = this._snapshot();
    return {
      id: this.project.id,
      name: this.project.name,
      width: this.project.width,
      height: this.project.height,
      fullWidth: this.project.fullWidth,
      fullHeight: this.project.fullHeight,
      fullDataURL: this.project.fullCanvas.toDataURL('image/png'),
      snapshot: snap,
      createdAt: this.project.createdAt,
      updatedAt: Date.now()
    };
  }

  async loadFromStorage(record) {
    this.project = {
      id: record.id,
      name: record.name,
      width: record.width,
      height: record.height,
      fullWidth: record.fullWidth,
      fullHeight: record.fullHeight,
      fullCanvas: await dataURLToCanvas(record.fullDataURL),
      activeFilterId: record.snapshot.activeFilterId,
      filterStrength: record.snapshot.filterStrength,
      layers: [],
      activeLayerId: record.snapshot.activeLayerId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
    await this.restoreSnapshot(record.snapshot);
    this.history.reset('Open project', this._snapshot());
    this.onProjectChange();
  }

  // ---------------------------------------------------------
  // Export helper: produce full-resolution source pixels for an
  // image layer, scaled + re-processed with its adjustments/filter.
  // ---------------------------------------------------------
  async renderExport(targetWidth, targetHeight) {
    const renderImageLayerAtScale = async (layer, tw, th) => {
      const isBase = layer === this.getBaseImageLayer();
      const scaleSource = isBase ? this.project.fullCanvas : layer.sourceCanvas;
      const scaled = document.createElement('canvas');
      scaled.width = tw; scaled.height = th;
      const sctx = scaled.getContext('2d');
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(scaleSource, 0, 0, tw, th);
      let adj = layer.adjustments;
      if (isBase && this.project.activeFilterId !== 'original') {
        adj = mergeFilterIntoAdjustments(layer.adjustments, getFilterById(this.project.activeFilterId), this.project.filterStrength);
      }
      // Full-resolution export runs through a Web Worker so large photos
      // don't block slider/UI interactivity while exporting.
      const imageData = sctx.getImageData(0, 0, tw, th);
      const processed = await processImageDataOffThread(imageData, adj);
      sctx.putImageData(processed, 0, 0);
      return scaled;
    };
    return renderFullResolutionComposite(this.project, renderImageLayerAtScale, targetWidth, targetHeight);
  }
}

function dataURLToCanvas(dataURL) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || 1;
      c.height = img.naturalHeight || 1;
      c.getContext('2d').drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = reject;
    img.src = dataURL;
  });
}

export { BLEND_MODES };

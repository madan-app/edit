// =============================================================
// ui.js — DOM glue: builds the right-hand panels, wires the tool
// rail, top bar, zoom bar and canvas pointer interactions to the
// Editor's command API.
// =============================================================

import { HSL_RANGES, normalizeAdjustments } from './adjustments.js';
import { FILTERS, getFilterById, renderFilterThumb } from './filters.js';
import { BLEND_MODES } from './layers.js';
import { CROP_RATIOS } from './transform.js';
import { createEmptyMask, paintBrushStroke, paintLinearGradientMask, paintRadialGradientMask, paintShapeMask, drawMaskOverlay, invertMask, applyFeatherToMask } from './masks.js';
import { rectSelectionMask, ellipseSelectionMask, lassoSelectionMask, magicWandMask, expandShrinkMask } from './selection.js';
import { cloneStamp, healingBrush, spotRemoval, redEyeRemoval } from './retouch.js';
import { drawStrokeSegment, DRAWING_TOOLS } from './drawing.js';
import { defaultTextData, TEXT_FONTS, renderTextLayer } from './text.js';
import { defaultShapeData, SHAPE_TYPES, renderShapeLayer } from './shapes.js';
import { loadStickerManifest, loadStickerSVG, renderStickerToLayer } from './stickers.js';
import { loadAllPresets, savePresetFromState, renamePreset, deletePreset, exportPresetJSON, importPresetJSON } from './presets.js';
import icons from './icons.js';

export function toast(message, kind = 'info') {
  const stack = document.getElementById('toast-stack');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

export function confirmModal({ title, body, confirmLabel = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal">
        <h3>${escapeHTML(title)}</h3>
        <p style="color:var(--text-secondary);font-size:13px;margin:0 0 4px;">${escapeHTML(body || '')}</p>
        <div class="modal-actions">
          <button class="btn" data-act="cancel">Cancel</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" data-act="ok">${escapeHTML(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop || e.target.dataset.act === 'cancel') { backdrop.remove(); resolve(false); }
      if (e.target.dataset.act === 'ok') { backdrop.remove(); resolve(true); }
    });
  });
}

export function promptModal({ title, label, value = '' }) {
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal">
        <h3>${escapeHTML(title)}</h3>
        <div class="field"><label>${escapeHTML(label)}</label><input type="text" value="${escapeHTML(value)}" /></div>
        <div class="modal-actions">
          <button class="btn" data-act="cancel">Cancel</button>
          <button class="btn primary" data-act="ok">Save</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    const input = backdrop.querySelector('input');
    input.focus(); input.select();
    const finish = (val) => { backdrop.remove(); resolve(val); };
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop || e.target.dataset.act === 'cancel') finish(null);
      if (e.target.dataset.act === 'ok') finish(input.value.trim() || null);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') finish(input.value.trim() || null);
      if (e.key === 'Escape') finish(null);
    });
  });
}

function escapeHTML(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

// =============================================================
// UI class
// =============================================================
export class UI {
  constructor(editor, viewport) {
    this.editor = editor;
    this.viewport = viewport;
    this.activeTool = 'move';
    this.activePanelTab = 'adjust';
    this.showMaskOverlay = false;
    this.editingMask = null; // { layerId, mask } while a mask tool is active
    this.dragState = null;
    this.cropState = null;
    this.stickerManifest = null;
    this.presetList = [];

    this.dom = {
      panelTabs: document.getElementById('panel-tabs'),
      panelBody: document.getElementById('panel-body'),
      toolRail: document.getElementById('tool-rail'),
      toolOptionsBar: document.getElementById('tool-options-bar'),
      statusMsg: document.getElementById('status-msg'),
      dims: document.getElementById('status-dims'),
      fileInfo: document.getElementById('status-fileinfo'),
      zoomLevel: document.getElementById('zoom-level'),
      overlay: document.getElementById('overlay-canvas'),
      compareDivider: document.getElementById('compare-divider'),
      mobileSheetBackdrop: document.getElementById('mobile-sheet-backdrop'),
      rightPanel: document.getElementById('right-panel')
    };

    this._bindToolRail();
    this._bindPanelTabs();
    this._bindOverlayPointer();
    this._bindCompareDivider();

    editor.onLayersChange = () => this.renderActivePanel();
    editor.onProjectChange = () => this.updateStatusBar();
    editor.onHistoryChange = () => { this.updateTopbarState(); if (this.activePanelTab === 'history') this.renderActivePanel(); };
  }

  // -----------------------------------------------------------
  // Tool rail
  // -----------------------------------------------------------
  _bindToolRail() {
    this.dom.toolRail.addEventListener('click', (e) => {
      const btn = e.target.closest('.tool-btn');
      if (!btn) return;
      this.selectTool(btn.dataset.tool);
    });
  }

  selectTool(tool) {
    if (!tool) return;
    this.activeTool = tool;
    this.dom.toolRail.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    this.renderToolOptionsBar();
    // Jump the right panel to the most relevant tab for this tool, where one exists
    const toolTabMap = { crop: 'crop', selection: 'selection', layers: 'layers', text: 'text-tool', shapes: 'shapes-tool', stickers: 'stickers-tool', background: 'background' };
    if (toolTabMap[tool]) this.setPanelTab(toolTabMap[tool]);
    this.updateCursor();
  }

  updateCursor() {
    const paintTools = ['brush', 'eraser', 'healing', 'clone', 'draw'];
    this.dom.overlay.style.cursor = paintTools.includes(this.activeTool) ? 'none' : (this.activeTool === 'move' ? 'move' : 'crosshair');
  }

  // -----------------------------------------------------------
  // Tool options bar (contextual, above canvas... rendered inline in zoom bar area)
  // -----------------------------------------------------------
  renderToolOptionsBar() {
    const bar = this.dom.toolOptionsBar;
    bar.innerHTML = '';
    const opts = this.toolOptions || (this.toolOptions = {
      brush: { size: 30, opacity: 100, hardness: 70, color: '#49c5b6' },
      eraser: { size: 30, opacity: 100, hardness: 70 },
      marker: { size: 18, opacity: 100, color: '#e2574c' },
      highlighter: { size: 34, opacity: 100, color: '#f2e94e' },
      pencil: { size: 4, opacity: 100, color: '#ffffff' },
      smudge: { size: 34, opacity: 60 },
      blur: { size: 34, opacity: 80 },
      healing: { size: 26, opacity: 100 },
      clone: { size: 26, opacity: 100 },
      selection: { tolerance: 24, mode: 'rect' }
    });

    const drawLike = ['brush', 'eraser', 'marker', 'highlighter', 'pencil', 'smudge', 'blur'];
    if (drawLike.includes(this.activeTool)) {
      const o = opts[this.activeTool];
      bar.appendChild(this._optRange('Size', o.size, 1, 200, v => o.size = v));
      bar.appendChild(this._optRange('Opacity', o.opacity, 0, 100, v => o.opacity = v));
      if ('hardness' in o) bar.appendChild(this._optRange('Hardness', o.hardness, 0, 100, v => o.hardness = v));
      if ('color' in o) bar.appendChild(this._optColor('Color', o.color, v => o.color = v));
    } else if (this.activeTool === 'healing' || this.activeTool === 'clone') {
      const o = opts[this.activeTool];
      bar.appendChild(this._optRange('Size', o.size, 4, 200, v => o.size = v));
      bar.appendChild(this._optRange('Opacity', o.opacity, 0, 100, v => o.opacity = v));
      const hint = document.createElement('span');
      hint.textContent = this.activeTool === 'clone' ? 'Alt/Option-click to set a source point, then paint.' : 'Alt/Option-click to set a source, then paint to heal.';
      hint.style.color = 'var(--text-muted)';
      bar.appendChild(hint);
    } else if (this.activeTool === 'spot') {
      bar.appendChild(this._optRange('Size', 24, 6, 120, v => this._spotSize = v));
    } else if (this.activeTool === 'redeye') {
      bar.appendChild(this._optRange('Size', 20, 6, 80, v => this._redEyeSize = v));
    } else if (this.activeTool === 'selection') {
      const o = opts.selection;
      bar.appendChild(this._optSelect('Shape', ['rect', 'ellipse', 'lasso', 'wand'], o.mode, v => o.mode = v));
      bar.appendChild(this._optRange('Tolerance', o.tolerance, 0, 100, v => o.tolerance = v));
    } else if (this.activeTool === 'crop') {
      bar.appendChild(this._cropRatioControls());
    }
  }

  _optRange(label, value, min, max, onChange) {
    const wrap = document.createElement('span');
    wrap.className = 'opt-group';
    wrap.innerHTML = `<label>${label}</label>`;
    const input = document.createElement('input');
    input.type = 'range'; input.min = min; input.max = max; input.value = value;
    input.addEventListener('input', () => onChange(Number(input.value)));
    wrap.appendChild(input);
    return wrap;
  }
  _optColor(label, value, onChange) {
    const wrap = document.createElement('span');
    wrap.className = 'opt-group';
    wrap.innerHTML = `<label>${label}</label>`;
    const input = document.createElement('input');
    input.type = 'color'; input.value = value;
    input.addEventListener('input', () => onChange(input.value));
    wrap.appendChild(input);
    return wrap;
  }
  _optSelect(label, options, value, onChange) {
    const wrap = document.createElement('span');
    wrap.className = 'opt-group';
    wrap.innerHTML = `<label>${label}</label>`;
    const select = document.createElement('select');
    select.style.cssText = 'background:var(--bg-inset);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:4px;padding:3px 6px;font-size:12px;';
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o; opt.textContent = o; if (o === value) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => onChange(select.value));
    wrap.appendChild(select);
    return wrap;
  }
  _cropRatioControls() {
    const wrap = document.createElement('span');
    wrap.className = 'opt-group';
    wrap.innerHTML = `<label>Drag on the photo to crop, then press Enter to apply.</label>`;
    return wrap;
  }

  // -----------------------------------------------------------
  // Right panel tabs
  // -----------------------------------------------------------
  _bindPanelTabs() {
    this.dom.panelTabs.addEventListener('click', e => {
      const tab = e.target.closest('.panel-tab');
      if (tab) this.setPanelTab(tab.dataset.tab);
    });
  }

  setPanelTab(tab) {
    this.activePanelTab = tab;
    this.dom.rightPanel.classList.add('sheet-open');
    this.renderActivePanel();
  }

  closeMobileSheet() {
    this.dom.rightPanel.classList.remove('sheet-open');
  }

  renderActivePanel() {
    this._syncPanelTabsUI();
    const body = this.dom.panelBody;
    body.innerHTML = '';
    if (!this.editor.hasProject()) {
      body.innerHTML = `<p class="empty-hint">Open a photo to start editing.</p>`;
      return;
    }
    const renderers = {
      adjust: () => this.renderAdjustPanel(body),
      color: () => this.renderColorPanel(body),
      effects: () => this.renderEffectsPanel(body),
      filters: () => this.renderFiltersPanel(body),
      presets: () => this.renderPresetsPanel(body),
      masking: () => this.renderMaskingPanel(body),
      layers: () => this.renderLayersPanel(body),
      history: () => this.renderHistoryPanel(body),
      export: () => this.renderExportPanel(body),
      crop: () => this.renderCropPanel(body),
      selection: () => this.renderSelectionPanel(body),
      'text-tool': () => this.renderTextToolPanel(body),
      'shapes-tool': () => this.renderShapesToolPanel(body),
      'stickers-tool': () => this.renderStickersPanel(body),
      background: () => this.renderBackgroundPanel(body)
    };
    (renderers[this.activePanelTab] || renderers.adjust)();
  }

  _syncPanelTabsUI() {
    this.dom.panelTabs.querySelectorAll('.panel-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === this.activePanelTab));
  }

  // ---------- Adjust (Light) ----------
  renderAdjustPanel(body) {
    const layer = this.editor.getActiveLayer();
    if (!layer || layer.type !== 'image') { body.innerHTML = '<p class="empty-hint">Select the photo layer to adjust light &amp; detail.</p>'; return; }
    const a = layer.adjustments;
    body.appendChild(this._section('Light', [
      ['exposure', 'Exposure', -100, 100],
      ['contrast', 'Contrast', -100, 100],
      ['highlights', 'Highlights', -100, 100],
      ['shadows', 'Shadows', -100, 100],
      ['whites', 'Whites', -100, 100],
      ['blacks', 'Blacks', -100, 100],
      ['brightness', 'Brightness', -100, 100]
    ], a, keys => this.editor.resetAdjustmentSection(keys)));

    body.appendChild(this._section('Detail', [
      ['texture', 'Texture', -100, 100],
      ['clarity', 'Clarity', -100, 100],
      ['dehaze', 'Dehaze', -100, 100],
      ['sharpness', 'Sharpness', 0, 100],
      ['noiseReduction', 'Noise reduction', 0, 100],
      ['grain', 'Grain', 0, 100]
    ], a, keys => this.editor.resetAdjustmentSection(keys)));

    body.appendChild(this._section('Optics', [
      ['vignette', 'Vignette', -100, 100]
    ], a, keys => this.editor.resetAdjustmentSection(keys)));
  }

  // ---------- Color (temp/tint/vibrance/saturation/hue + curves + HSL + grading) ----------
  renderColorPanel(body) {
    const layer = this.editor.getActiveLayer();
    if (!layer || layer.type !== 'image') { body.innerHTML = '<p class="empty-hint">Select the photo layer to edit color.</p>'; return; }
    const a = layer.adjustments;

    body.appendChild(this._section('Color', [
      ['temperature', 'Temperature', -100, 100],
      ['tint', 'Tint', -100, 100],
      ['vibrance', 'Vibrance', -100, 100],
      ['saturation', 'Saturation', -100, 100],
      ['hue', 'Hue', -180, 180]
    ], a, keys => this.editor.resetAdjustmentSection(keys)));

    // Curves
    const curveSection = document.createElement('div');
    curveSection.className = 'panel-section';
    curveSection.innerHTML = `<div class="panel-section-title">Curves</div>
      <div class="curve-channel-tabs">
        <button data-ch="rgb" class="active">RGB</button>
        <button data-ch="r">Red</button>
        <button data-ch="g">Green</button>
        <button data-ch="b">Blue</button>
      </div>
      <canvas id="curve-editor" width="260" height="260"></canvas>
      <div style="margin-top:6px;"><button class="btn" id="curve-reset">Reset curve</button></div>`;
    body.appendChild(curveSection);
    this._wireCurveEditor(curveSection, layer);

    // HSL
    const hslSection = document.createElement('div');
    hslSection.className = 'panel-section';
    hslSection.innerHTML = `<div class="panel-section-title">HSL</div>
      <div class="hsl-swatches">${HSL_RANGES.map((r, i) => `<button class="hsl-swatch ${i === 0 ? 'active' : ''}" style="background:${r.color}" data-key="${r.key}" title="${r.key}"></button>`).join('')}</div>
      <div id="hsl-sliders"></div>`;
    body.appendChild(hslSection);
    this._wireHSLPanel(hslSection, layer);

    // Color grading
    const cgSection = document.createElement('div');
    cgSection.className = 'panel-section';
    cgSection.innerHTML = `<div class="panel-section-title">Color grading</div><div id="grading-sliders"></div>`;
    body.appendChild(cgSection);
    this._wireGradingPanel(cgSection, layer);
  }

  _wireCurveEditor(container, layer) {
    const canvas = container.querySelector('#curve-editor');
    const ctx = canvas.getContext('2d');
    let channel = 'rgb';
    let points = (layer.adjustments.curves[channel] || [[0, 0], [255, 255]]).map(p => [...p]);
    let dragIndex = -1;

    const draw = () => {
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#0f1114';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#2f333a';
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath(); ctx.moveTo(i * w / 4, 0); ctx.lineTo(i * w / 4, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * h / 4); ctx.lineTo(w, i * h / 4); ctx.stroke();
      }
      ctx.strokeStyle = { rgb: '#e9e8e4', r: '#e2574c', g: '#55c26a', b: '#4b9bf0' }[channel];
      ctx.lineWidth = 2;
      ctx.beginPath();
      const sorted = [...points].sort((a, b) => a[0] - b[0]);
      sorted.forEach(([x, y], i) => {
        const px = (x / 255) * w, py = h - (y / 255) * h;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      for (const [x, y] of sorted) {
        ctx.beginPath();
        ctx.arc((x / 255) * w, h - (y / 255) * h, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    draw();

    const toImgCoords = (e) => {
      const rect = canvas.getBoundingClientRect();
      const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
      return [Math.max(0, Math.min(255, (cx / rect.width) * 255)), Math.max(0, Math.min(255, 255 - (cy / rect.height) * 255))];
    };

    canvas.addEventListener('pointerdown', e => {
      const [x, y] = toImgCoords(e);
      dragIndex = points.findIndex(p => Math.hypot(p[0] - x, p[1] - y) < 14);
      if (dragIndex === -1) { points.push([x, y]); dragIndex = points.length - 1; }
      canvas.setPointerCapture(e.pointerId);
      draw();
    });
    canvas.addEventListener('pointermove', e => {
      if (dragIndex === -1) return;
      const [x, y] = toImgCoords(e);
      points[dragIndex] = [x, y];
      draw();
      this.editor.updateCurve(channel, points, false);
    });
    canvas.addEventListener('pointerup', () => { if (dragIndex !== -1) this.editor.commitPendingHistory('Curve'); dragIndex = -1; });
    canvas.addEventListener('dblclick', e => {
      const [x, y] = toImgCoords(e);
      const idx = points.findIndex(p => Math.hypot(p[0] - x, p[1] - y) < 14);
      if (idx > -1 && points.length > 2) { points.splice(idx, 1); draw(); this.editor.updateCurve(channel, points, true); }
    });

    container.querySelectorAll('.curve-channel-tabs button').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.curve-channel-tabs button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        channel = btn.dataset.ch;
        points = (layer.adjustments.curves[channel] || [[0, 0], [255, 255]]).map(p => [...p]);
        draw();
      });
    });
    container.querySelector('#curve-reset').addEventListener('click', () => {
      points = [[0, 0], [255, 255]];
      draw();
      this.editor.updateCurve(channel, null, true);
    });
  }

  _wireHSLPanel(container, layer) {
    let activeKey = HSL_RANGES[0].key;
    const slidersDiv = container.querySelector('#hsl-sliders');
    const draw = () => {
      slidersDiv.innerHTML = '';
      const cur = layer.adjustments.hsl[activeKey] || { h: 0, s: 0, l: 0 };
      for (const [prop, label] of [['h', 'Hue'], ['s', 'Saturation'], ['l', 'Luminance']]) {
        slidersDiv.appendChild(this._slider(label, cur[prop] || 0, -100, 100, v => this.editor.updateHSL(activeKey, prop, v, false), () => this.editor.commitPendingHistory('HSL')));
      }
    };
    draw();
    container.querySelectorAll('.hsl-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        container.querySelectorAll('.hsl-swatch').forEach(s => s.classList.remove('active'));
        sw.classList.add('active');
        activeKey = sw.dataset.key;
        draw();
      });
    });
  }

  _wireGradingPanel(container, layer) {
    const div = container.querySelector('#grading-sliders');
    const zones = [['shadows', 'Shadows'], ['midtones', 'Midtones'], ['highlights', 'Highlights'], ['global', 'Global']];
    for (const [zone, label] of zones) {
      const wrap = document.createElement('div');
      wrap.style.marginBottom = '10px';
      wrap.innerHTML = `<div class="panel-section-title">${label}</div>`;
      const cur = layer.adjustments.colorGrading[zone];
      wrap.appendChild(this._slider('Hue', cur.h || 0, -180, 180, v => this.editor.updateColorGrading(zone, 'h', v, false), () => this.editor.commitPendingHistory('Grading')));
      wrap.appendChild(this._slider('Saturation', cur.s || 0, -100, 100, v => this.editor.updateColorGrading(zone, 's', v, false), () => this.editor.commitPendingHistory('Grading')));
      if (zone === 'global') wrap.appendChild(this._slider('Luminance', cur.l || 0, -100, 100, v => this.editor.updateColorGrading(zone, 'l', v, false), () => this.editor.commitPendingHistory('Grading')));
      div.appendChild(wrap);
    }
  }

  // ---------- Effects (masking-adjacent quick effects reuse Detail/Optics) ----------
  renderEffectsPanel(body) {
    const layer = this.editor.getActiveLayer();
    if (!layer || layer.type !== 'image') { body.innerHTML = '<p class="empty-hint">Select the photo layer to add effects.</p>'; return; }
    body.innerHTML = `<p class="empty-hint" style="text-align:left;">Fine, punchy looks — combine with Filters for a full stylistic pass.</p>`;
    const a = layer.adjustments;
    body.appendChild(this._section('Stylize', [
      ['clarity', 'Punch (clarity)', -100, 100],
      ['dehaze', 'Dehaze', -100, 100],
      ['vignette', 'Vignette', -100, 100],
      ['grain', 'Film grain', 0, 100]
    ], a, keys => this.editor.resetAdjustmentSection(keys)));
  }

  // ---------- Filters ----------
  renderFiltersPanel(body) {
    const layer = this.editor.getBaseImageLayer();
    const grid = document.createElement('div');
    grid.className = 'filter-grid';
    const sample = layer.sourceCanvas.getContext('2d').getImageData(0, 0, Math.min(64, layer.sourceCanvas.width), Math.min(64, layer.sourceCanvas.height));
    for (const filter of FILTERS) {
      const item = document.createElement('div');
      item.className = 'filter-thumb' + (this.editor.project.activeFilterId === filter.id ? ' active' : '');
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const thumbData = renderFilterThumb(sample, filter);
      c.getContext('2d').putImageData(thumbData, 0, 0);
      item.appendChild(c);
      const label = document.createElement('span');
      label.textContent = filter.name;
      item.appendChild(label);
      item.addEventListener('click', () => { this.editor.applyFilter(filter.id, 100); this.renderFiltersPanel(body); });
      grid.appendChild(item);
    }
    body.innerHTML = '';
    body.appendChild(grid);
    if (this.editor.project.activeFilterId !== 'original') {
      body.appendChild(this._slider('Filter strength', this.editor.project.filterStrength, 0, 100,
        v => { this.editor.project.filterStrength = v; this.editor._refreshLayerCanvas(layer); this.editor.renderComposite(); },
        () => this.editor.commitPendingHistory('Filter strength')));
    }
  }

  // ---------- Presets ----------
  async renderPresetsPanel(body) {
    body.innerHTML = `<div class="panel-section-title">Presets<span></span></div>
      <div style="display:flex;gap:6px;margin-bottom:10px;">
        <button class="btn" id="save-preset-btn">${icons.save} Save current</button>
        <button class="btn" id="import-preset-btn">${icons.upload} Import</button>
        <input type="file" id="import-preset-file" accept=".json" class="hidden" />
      </div>
      <div class="preset-list" id="preset-list"></div>`;
    this.presetList = await loadAllPresets();
    const list = body.querySelector('#preset-list');
    this._renderPresetList(list);

    body.querySelector('#save-preset-btn').addEventListener('click', async () => {
      const name = await promptModal({ title: 'Save preset', label: 'Preset name', value: 'My preset' });
      if (!name) return;
      const layer = this.editor.getActiveLayer();
      const preset = await savePresetFromState(name, layer.adjustments, this.editor.project.activeFilterId);
      this.presetList.push(preset);
      this._renderPresetList(list);
      toast('Preset saved.');
    });
    body.querySelector('#import-preset-btn').addEventListener('click', () => body.querySelector('#import-preset-file').click());
    body.querySelector('#import-preset-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const preset = await importPresetJSON(file);
        this.presetList.push(preset);
        this._renderPresetList(list);
        toast('Preset imported.');
      } catch (err) { toast('Could not import that preset file.', 'error'); }
    });
  }

  _renderPresetList(list) {
    list.innerHTML = '';
    for (const preset of this.presetList) {
      const row = document.createElement('div');
      row.className = 'preset-row';
      row.innerHTML = `<button class="preset-name">${escapeHTML(preset.name)}</button>
        <div class="preset-actions">
          <button class="icon-btn" data-act="rename" title="Rename">${icons.edit}</button>
          <button class="icon-btn" data-act="export" title="Export JSON">${icons.download}</button>
          <button class="icon-btn" data-act="delete" title="Delete">${icons.trash}</button>
        </div>`;
      row.querySelector('.preset-name').addEventListener('click', () => {
        const layer = this.editor.getActiveLayer();
        if (!layer || layer.type !== 'image') { toast('Select the photo layer first.', 'warn'); return; }
        layer.adjustments = normalizeAdjustments(preset.adjustments);
        this.editor.applyFilter(preset.filterId || 'original', 100);
        this.renderActivePanel();
        toast(`Applied "${preset.name}".`);
      });
      row.querySelector('[data-act="rename"]').addEventListener('click', async () => {
        const name = await promptModal({ title: 'Rename preset', label: 'Name', value: preset.name });
        if (!name) return;
        await renamePreset(preset, name);
        this._renderPresetList(list);
      });
      row.querySelector('[data-act="export"]').addEventListener('click', () => exportPresetJSON(preset));
      row.querySelector('[data-act="delete"]').addEventListener('click', async () => {
        const ok = await confirmModal({ title: 'Delete preset?', body: `Remove "${preset.name}" permanently.`, confirmLabel: 'Delete', danger: true });
        if (!ok) return;
        await deletePreset(preset.id);
        this.presetList = this.presetList.filter(p => p.id !== preset.id);
        this._renderPresetList(list);
      });
      list.appendChild(row);
    }
    if (!this.presetList.length) list.innerHTML = '<p class="empty-hint">No presets yet.</p>';
  }

  // ---------- Masking ----------
  renderMaskingPanel(body) {
    const layer = this.editor.getActiveLayer();
    if (!layer || layer.type !== 'image') { body.innerHTML = '<p class="empty-hint">Select the photo layer to add a local mask.</p>'; return; }
    body.innerHTML = `
      <div class="panel-section-title">Mask type</div>
      <div class="mask-list">
        <button class="btn" data-kind="brush">${icons.brush} Brush</button>
        <button class="btn" data-kind="linear-gradient">${icons.gradient} Linear gradient</button>
        <button class="btn" data-kind="radial-gradient">${icons.gradient} Radial gradient</button>
        <button class="btn" data-kind="rect">${icons.rect} Rectangle</button>
        <button class="btn" data-kind="ellipse">${icons.circle} Ellipse</button>
      </div>
      <div id="mask-controls"></div>`;
    body.querySelectorAll('[data-kind]').forEach(btn => {
      btn.addEventListener('click', () => this._startMaskCreation(layer, btn.dataset.kind, body));
    });
    if (layer.mask) this._renderMaskControls(body.querySelector('#mask-controls'), layer);
  }

  _startMaskCreation(layer, kind, body) {
    const mask = createEmptyMask(this.editor.project.width, this.editor.project.height, kind === 'brush');
    mask.kind = kind;
    this.editingMask = { layerId: layer.id, mask };
    layer.mask = mask;
    this.editor.renderComposite();
    this.showMaskOverlay = true;
    this.selectTool('mask-' + kind.split('-')[0]);
    toast('Draw the mask on the photo, then adjust its settings below.');
    this._renderMaskControls(body.querySelector('#mask-controls'), layer);
  }

  _renderMaskControls(container, layer) {
    if (!layer.mask) { container.innerHTML = ''; return; }
    container.innerHTML = `<div class="panel-section-title">Mask settings</div>`;
    container.appendChild(this._slider('Opacity', layer.mask.opacity, 0, 100, v => { layer.mask.opacity = v; this.editor.renderComposite(); }, () => this.editor._commitHistory('Mask opacity', true)));
    container.appendChild(this._slider('Feather', layer.mask.feather, 0, 60, v => { layer.mask.feather = v; }, v => { applyFeatherToMask(layer.mask, layer.mask.feather); this.editor.renderComposite(); this.editor._commitHistory('Mask feather', true); }));
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;margin-top:8px;';
    row.innerHTML = `<button class="btn" id="mask-invert">${icons.invert} Invert</button>
      <button class="btn" id="mask-toggle-overlay">${icons.eye} ${this.showMaskOverlay ? 'Hide overlay' : 'Show overlay'}</button>
      <button class="btn danger" id="mask-remove">${icons.trash} Remove</button>`;
    container.appendChild(row);
    container.querySelector('#mask-invert').addEventListener('click', () => { invertMask(layer.mask); this.editor.renderComposite(); this.editor._commitHistory('Invert mask', true); });
    container.querySelector('#mask-toggle-overlay').addEventListener('click', () => { this.showMaskOverlay = !this.showMaskOverlay; this.renderMaskingPanel(this.dom.panelBody); this._drawMaskOverlayIfNeeded(); });
    container.querySelector('#mask-remove').addEventListener('click', () => { layer.mask = null; this.editor.renderComposite(); this.editor._commitHistory('Remove mask', true); this.renderMaskingPanel(this.dom.panelBody); });
  }

  // ---------- Layers ----------
  renderLayersPanel(body) {
    body.innerHTML = `
      <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;">
        <button class="btn" id="add-drawing-layer">${icons.brush} Drawing layer</button>
        <button class="btn" id="duplicate-layer">${icons.copy} Duplicate</button>
        <button class="btn danger" id="delete-layer">${icons.trash} Delete</button>
      </div>
      <div class="layer-list" id="layer-list"></div>`;
    const list = body.querySelector('#layer-list');
    const layers = [...this.editor.project.layers].reverse();
    for (const layer of layers) {
      const row = document.createElement('div');
      row.className = 'layer-row' + (layer.id === this.editor.project.activeLayerId ? ' selected' : '');
      row.draggable = true;
      row.dataset.id = layer.id;
      row.innerHTML = `
        <button class="icon-btn" data-act="vis" title="Toggle visibility">${layer.visible ? icons.eye : icons.eyeOff}</button>
        <img class="layer-thumb" src="${layer.canvas.toDataURL()}" />
        <button class="layer-name">${escapeHTML(layer.name)}</button>
        <button class="icon-btn" data-act="lock" title="Lock">${layer.locked ? icons.lock : icons.unlock}</button>
      `;
      row.addEventListener('click', (e) => { if (!e.target.closest('button')) this.editor.setActiveLayer(layer.id); });
      row.querySelector('[data-act="vis"]').addEventListener('click', () => this.editor.setLayerProp(layer.id, { visible: !layer.visible }));
      row.querySelector('[data-act="lock"]').addEventListener('click', () => this.editor.setLayerProp(layer.id, { locked: !layer.locked }));
      row.querySelector('.layer-name').addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const input = document.createElement('input');
        input.className = 'rename-input';
        input.value = layer.name;
        e.target.replaceWith(input);
        input.focus(); input.select();
        const commit = () => this.editor.setLayerProp(layer.id, { name: input.value || layer.name });
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', ev => { if (ev.key === 'Enter') input.blur(); });
      });
      row.addEventListener('dragstart', () => row.classList.add('dragging'));
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        const ids = [...list.querySelectorAll('.layer-row')].map(r => r.dataset.id).reverse();
        ids.forEach((id, i) => { const idx = this.editor.project.layers.findIndex(l => l.id === id); if (idx !== i) this.editor.reorderLayer(id, i); });
      });
      row.addEventListener('dragover', e => {
        e.preventDefault();
        const dragging = list.querySelector('.dragging');
        if (dragging && dragging !== row) {
          const rect = row.getBoundingClientRect();
          const before = e.clientY < rect.top + rect.height / 2;
          list.insertBefore(dragging, before ? row : row.nextSibling);
        }
      });
      list.appendChild(row);

      // opacity + blend mode row
      const controls = document.createElement('div');
      controls.style.cssText = 'display:flex;align-items:center;gap:6px;padding:2px 8px 8px 34px;';
      const opacityInput = document.createElement('input');
      opacityInput.type = 'range'; opacityInput.min = 0; opacityInput.max = 100; opacityInput.value = layer.opacity;
      opacityInput.className = 'layer-opacity-mini';
      opacityInput.title = 'Opacity';
      opacityInput.addEventListener('input', () => this.editor.setLayerProp(layer.id, { opacity: Number(opacityInput.value), commit: false }));
      opacityInput.addEventListener('change', () => this.editor.commitPendingHistory('Layer opacity'));
      const blendSelect = document.createElement('select');
      blendSelect.style.cssText = 'flex:1;background:var(--bg-inset);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:4px;font-size:11px;padding:3px;';
      for (const bm of BLEND_MODES) {
        const opt = document.createElement('option'); opt.value = bm.id; opt.textContent = bm.name;
        if (bm.id === layer.blendMode) opt.selected = true;
        blendSelect.appendChild(opt);
      }
      blendSelect.addEventListener('change', () => this.editor.setLayerProp(layer.id, { blendMode: blendSelect.value }));
      controls.appendChild(opacityInput);
      controls.appendChild(blendSelect);
      list.appendChild(controls);
    }

    body.querySelector('#add-drawing-layer').addEventListener('click', () => { this.editor.addDrawingLayer(); this.selectTool('draw'); this.renderLayersPanel(body); });
    body.querySelector('#duplicate-layer').addEventListener('click', () => this.editor.duplicateActiveLayer());
    body.querySelector('#delete-layer').addEventListener('click', async () => {
      const layer = this.editor.getActiveLayer();
      if (!layer) return;
      if (layer.type === 'image' && this.editor.project.layers.filter(l => l.type === 'image').length === 1) { toast("Can't delete the only photo layer.", 'warn'); return; }
      const ok = await confirmModal({ title: 'Delete layer?', body: `Remove "${layer.name}".`, confirmLabel: 'Delete', danger: true });
      if (ok) this.editor.deleteLayer(layer.id);
    });
  }

  // ---------- History ----------
  renderHistoryPanel(body) {
    body.innerHTML = '<div class="panel-section-title">History</div><div class="history-list" id="history-list"></div>';
    const list = body.querySelector('#history-list');
    for (const entry of this.editor.history.list()) {
      const row = document.createElement('div');
      row.className = 'history-row' + (entry.current ? ' current' : '');
      row.innerHTML = `<span class="dot"></span>${escapeHTML(entry.label)}`;
      row.addEventListener('click', () => this.editor.jumpHistory(entry.index));
      list.appendChild(row);
    }
  }

  // ---------- Export ----------
  renderExportPanel(body) {
    const p = this.editor.project;
    body.innerHTML = `
      <div class="panel-section-title">Export</div>
      <img class="export-preview" id="export-preview" src="${this.viewport.mainCanvas.toDataURL()}" />
      <div class="radio-pill-group" id="export-format">
        <div class="radio-pill active" data-f="png">PNG</div>
        <div class="radio-pill" data-f="jpg">JPG</div>
        <div class="radio-pill" data-f="webp">WebP</div>
      </div>
      <div class="field" id="quality-field"><label>Quality</label><input type="range" min="10" max="100" value="92" id="export-quality" /></div>
      <div class="field-row">
        <div class="field"><label>Width</label><input type="number" id="export-width" value="${p.fullWidth}" /></div>
        <div class="field"><label>Height</label><input type="number" id="export-height" value="${p.fullHeight}" /></div>
      </div>
      <div class="field"><label>Scale</label>
        <select id="export-scale"><option value="1">1x (full resolution)</option><option value="0.5">0.5x</option><option value="2">2x</option></select>
      </div>
      <div class="field" id="transparent-field" style="display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="export-transparent" /><label style="margin:0;">Transparent background</label>
      </div>
      <div class="field"><label>Filename</label><input type="text" id="export-filename" value="${p.name || 'edited'}" /></div>
      <button class="btn primary" id="export-run" style="width:100%;justify-content:center;">${icons.download} Export</button>
      <div id="export-progress" style="margin-top:10px;"></div>`;

    let format = 'png';
    body.querySelectorAll('#export-format .radio-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        body.querySelectorAll('#export-format .radio-pill').forEach(p2 => p2.classList.remove('active'));
        pill.classList.add('active');
        format = pill.dataset.f;
        body.querySelector('#quality-field').style.display = format === 'png' ? 'none' : 'block';
        body.querySelector('#transparent-field').style.display = format === 'jpg' ? 'none' : 'flex';
      });
    });
    body.querySelector('#quality-field').style.display = 'none';

    const widthInput = body.querySelector('#export-width');
    const heightInput = body.querySelector('#export-height');
    const ratio = p.fullWidth / p.fullHeight;
    widthInput.addEventListener('input', () => { heightInput.value = Math.round(widthInput.value / ratio); });
    heightInput.addEventListener('input', () => { widthInput.value = Math.round(heightInput.value * ratio); });
    body.querySelector('#export-scale').addEventListener('change', (e) => {
      const scale = Number(e.target.value);
      widthInput.value = Math.round(p.fullWidth * scale);
      heightInput.value = Math.round(p.fullHeight * scale);
    });

    body.querySelector('#export-run').addEventListener('click', async () => {
      const progress = body.querySelector('#export-progress');
      progress.innerHTML = `<div style="display:flex;align-items:center;gap:8px;color:var(--text-muted);font-size:12px;"><div class="spinner"></div> Rendering full-resolution export…</div>`;
      try {
        const { exportProject } = await import('./export.js');
        await exportProject(this.editor.project, this.editor.renderExport.bind(this.editor), {
          format,
          quality: Number(body.querySelector('#export-quality').value),
          width: Number(widthInput.value),
          height: Number(heightInput.value),
          filename: `${body.querySelector('#export-filename').value || 'edited'}.${format}`,
          transparentBackground: body.querySelector('#export-transparent').checked
        });
        progress.innerHTML = `<span style="color:var(--accent);font-size:12px;">Export complete — check your downloads.</span>`;
        toast('Image exported.');
      } catch (err) {
        progress.innerHTML = `<span style="color:var(--danger);font-size:12px;">Export failed: ${escapeHTML(err.message)}</span>`;
        toast('Export failed. Try a smaller size.', 'error');
      }
    });
  }

  // ---------- Crop tool panel ----------
  renderCropPanel(body) {
    body.innerHTML = `<div class="panel-section-title">Crop &amp; transform</div>
      <div class="crop-ratio-grid" id="crop-ratios"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
        <button class="btn" id="rotate-l">${icons.rotateLeft} Rotate</button>
        <button class="btn" id="flip-h">${icons.flip} Flip H</button>
        <button class="btn" id="flip-v">${icons.flip} Flip V</button>
      </div>
      <div class="panel-section-title">Straighten</div>
      <div id="straighten-slider"></div>
      <button class="btn primary" id="crop-apply" style="width:100%;justify-content:center;margin-top:10px;">${icons.check} Apply crop</button>`;
    const grid = body.querySelector('#crop-ratios');
    this._cropRatio = this._cropRatio || 'free';
    for (const r of CROP_RATIOS) {
      const btn = document.createElement('div');
      btn.className = 'crop-ratio-btn' + (r.id === this._cropRatio ? ' active' : '');
      btn.textContent = r.label;
      btn.addEventListener('click', () => {
        this._cropRatio = r.id;
        grid.querySelectorAll('.crop-ratio-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (this.cropState) this.cropState.ratio = r.ratio;
      });
      grid.appendChild(btn);
    }
    body.querySelector('#rotate-l').addEventListener('click', () => this.editor.rotateProject(1));
    body.querySelector('#flip-h').addEventListener('click', () => this.editor.flipProject(true, false));
    body.querySelector('#flip-v').addEventListener('click', () => this.editor.flipProject(false, true));
    body.querySelector('#straighten-slider').appendChild(this._slider('Angle', 0, -45, 45, () => {}, v => this.editor.straightenProject(v)));
    body.querySelector('#crop-apply').addEventListener('click', () => this._applyCrop());
    if (!this.cropState) this._initCropOverlay();
  }

  // ---------- Selection tool panel ----------
  renderSelectionPanel(body) {
    body.innerHTML = `<p class="empty-hint" style="text-align:left;">Choose a selection shape in the toolbar above the canvas, drag on the photo, then use these actions.</p>
      <div style="display:flex;flex-direction:column;gap:6px;">
        <button class="btn" id="sel-invert">${icons.invert} Invert selection</button>
        <button class="btn" id="sel-feather">${icons.gradient} Feather 12px</button>
        <button class="btn" id="sel-expand">${icons.plus} Expand 6px</button>
        <button class="btn" id="sel-shrink">${icons.minus} Shrink 6px</button>
        <button class="btn primary" id="sel-to-mask">${icons.check} Use as active layer mask</button>
      </div>`;
    body.querySelector('#sel-invert').addEventListener('click', () => { if (this._selectionMask) { invertMask(this._selectionMask); this._drawSelectionOverlay(); } });
    body.querySelector('#sel-feather').addEventListener('click', () => { if (this._selectionMask) { applyFeatherToMask(this._selectionMask, 12); this._drawSelectionOverlay(); } });
    body.querySelector('#sel-expand').addEventListener('click', () => { if (this._selectionMask) { expandShrinkMask(this._selectionMask, 6); this._drawSelectionOverlay(); } });
    body.querySelector('#sel-shrink').addEventListener('click', () => { if (this._selectionMask) { expandShrinkMask(this._selectionMask, -6); this._drawSelectionOverlay(); } });
    body.querySelector('#sel-to-mask').addEventListener('click', () => {
      const layer = this.editor.getActiveLayer();
      if (!layer || !this._selectionMask) { toast('Make a selection first.', 'warn'); return; }
      this.editor.setLayerMask(layer.id, this._selectionMask);
      this.editor._commitHistory('Selection to mask', true);
      toast('Selection applied as a mask.');
    });
  }

  // ---------- Text tool panel ----------
  renderTextToolPanel(body) {
    const layer = this.editor.getActiveLayer();
    body.innerHTML = `<button class="btn primary" id="add-text" style="width:100%;justify-content:center;margin-bottom:12px;">${icons.plus} Add text layer</button><div id="text-fields"></div>`;
    body.querySelector('#add-text').addEventListener('click', () => {
      const l = this.editor.addTextLayer(defaultTextData());
      this.renderTextToolPanel(body);
    });
    if (layer && layer.type === 'text') this._renderTextFields(body.querySelector('#text-fields'), layer);
  }

  _renderTextFields(container, layer) {
    const d = layer.data;
    const update = (patch) => this.editor.updateTextLayer(layer, patch);
    const textarea = document.createElement('textarea');
    textarea.value = d.text;
    textarea.rows = 2;
    textarea.style.cssText = 'width:100%;background:var(--bg-inset);border:1px solid var(--border-subtle);color:var(--text-primary);border-radius:4px;padding:6px;font-size:13px;margin-bottom:10px;';
    textarea.addEventListener('input', () => update({ text: textarea.value }));
    container.appendChild(textarea);

    const fontSelect = document.createElement('select');
    fontSelect.className = 'blend-mode-select';
    for (const f of TEXT_FONTS) { const o = document.createElement('option'); o.value = f.id; o.textContent = f.label; if (f.id === d.fontId) o.selected = true; fontSelect.appendChild(o); }
    fontSelect.addEventListener('change', () => update({ fontId: fontSelect.value }));
    container.appendChild(fontSelect);

    container.appendChild(this._slider('Size', d.fontSize, 10, 200, v => update({ fontSize: v })));
    container.appendChild(this._slider('Opacity', d.opacity, 0, 100, v => update({ opacity: v })));
    container.appendChild(this._slider('Letter spacing', d.letterSpacing, -5, 40, v => update({ letterSpacing: v })));
    container.appendChild(this._slider('Line spacing', d.lineSpacing * 100, 80, 250, v => update({ lineSpacing: v / 100 })));
    container.appendChild(this._slider('Stroke width', d.strokeWidth, 0, 20, v => update({ strokeWidth: v })));

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;align-items:center;margin:8px 0;flex-wrap:wrap;';
    row.appendChild(this._toggleBtn('B', d.bold, v => update({ bold: v })));
    row.appendChild(this._toggleBtn('I', d.italic, v => update({ italic: v })));
    row.appendChild(this._toggleBtn('U', d.underline, v => update({ underline: v })));
    row.appendChild(this._toggleBtn('S', d.shadow, v => update({ shadow: v })));
    container.appendChild(row);

    const alignRow = document.createElement('div');
    alignRow.style.cssText = 'display:flex;gap:6px;margin-bottom:10px;';
    for (const align of ['left', 'center', 'right']) {
      alignRow.appendChild(this._toggleBtn(align[0].toUpperCase(), d.align === align, () => update({ align }), true));
    }
    container.appendChild(alignRow);

    const colorRow = document.createElement('div');
    colorRow.style.cssText = 'display:flex;gap:10px;align-items:center;';
    colorRow.appendChild(this._optColor('Color', d.color, v => update({ color: v })));
    colorRow.appendChild(this._optColor('Stroke', d.strokeColor, v => update({ strokeColor: v })));
    container.appendChild(colorRow);
  }

  _toggleBtn(label, active, onChange, radio = false) {
    const btn = document.createElement('button');
    btn.className = 'icon-btn' + (active ? ' active' : '');
    btn.style.cssText = `width:30px;height:30px;border:1px solid var(--border-subtle);${active ? 'color:var(--accent);border-color:var(--accent);' : ''}`;
    btn.textContent = label;
    btn.addEventListener('click', () => { const next = radio ? true : !active; onChange(next); this.renderActivePanel(); });
    return btn;
  }

  // ---------- Shapes tool panel ----------
  renderShapesToolPanel(body) {
    const layer = this.editor.getActiveLayer();
    body.innerHTML = `<div class="panel-section-title">Add a shape</div>
      <div class="filter-grid" id="shape-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px;"></div>
      <div id="shape-fields"></div>`;
    const grid = body.querySelector('#shape-grid');
    for (const type of SHAPE_TYPES) {
      const item = document.createElement('div');
      item.className = 'filter-thumb';
      item.innerHTML = `<div style="width:100%;aspect-ratio:1/1;border:1.5px solid var(--border-subtle);border-radius:4px;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);">${icons.shape}</div><span>${type.replace('-', ' ')}</span>`;
      item.addEventListener('click', () => { this.editor.addShapeLayer(defaultShapeData(type)); this.renderShapesToolPanel(body); });
      grid.appendChild(item);
    }
    if (layer && layer.type === 'shape') this._renderShapeFields(body.querySelector('#shape-fields'), layer);
  }

  _renderShapeFields(container, layer) {
    const d = layer.data;
    const update = (patch) => this.editor.updateShapeLayer(layer, patch);
    container.appendChild(this._slider('Width', d.width, 10, 800, v => update({ width: v })));
    container.appendChild(this._slider('Height', d.height, 10, 800, v => update({ height: v })));
    container.appendChild(this._slider('Stroke width', d.strokeWidth, 0, 40, v => update({ strokeWidth: v })));
    container.appendChild(this._slider('Opacity', d.opacity, 0, 100, v => update({ opacity: v })));
    if (d.type === 'rounded-rectangle') container.appendChild(this._slider('Corner radius', d.cornerRadius, 0, 100, v => update({ cornerRadius: v })));
    if (d.type === 'star') container.appendChild(this._slider('Points', d.points, 3, 12, v => update({ points: v })));
    if (d.type === 'polygon') container.appendChild(this._slider('Sides', d.sides, 3, 12, v => update({ sides: v })));
    const colorRow = document.createElement('div');
    colorRow.style.cssText = 'display:flex;gap:10px;';
    colorRow.appendChild(this._optColor('Fill', d.fill, v => update({ fill: v })));
    colorRow.appendChild(this._optColor('Stroke', d.stroke, v => update({ stroke: v })));
    container.appendChild(colorRow);
  }

  // ---------- Stickers panel ----------
  async renderStickersPanel(body) {
    body.innerHTML = `<p class="empty-hint" style="text-align:left;">Tap a sticker to add it to the center of your photo, then move or resize it with the Move tool.</p><div id="sticker-groups"></div>`;
    if (!this.stickerManifest) this.stickerManifest = await loadStickerManifest();
    const groupsDiv = body.querySelector('#sticker-groups');
    const categories = this.stickerManifest.stickers || {};
    for (const [category, items] of Object.entries(categories)) {
      const section = document.createElement('div');
      section.className = 'panel-section';
      section.innerHTML = `<div class="panel-section-title">${escapeHTML(category)}</div>`;
      const grid = document.createElement('div');
      grid.className = 'filter-grid';
      for (const item of items) {
        const cell = document.createElement('div');
        cell.className = 'filter-thumb';
        cell.innerHTML = `<div style="width:100%;aspect-ratio:1/1;border:1.5px solid var(--border-subtle);border-radius:4px;display:flex;align-items:center;justify-content:center;background:var(--bg-inset);" data-preview></div><span>${escapeHTML(item.name)}</span>`;
        loadStickerSVG(item.path).then(svg => { cell.querySelector('[data-preview]').innerHTML = svg; });
        cell.addEventListener('click', async () => {
          try {
            const svg = await loadStickerSVG(item.path);
            const layer = this.editor.addStickerLayer(item.name);
            await renderStickerToLayer(layer, svg, 180);
            this.editor.renderComposite();
            this.editor._commitHistory('Add sticker', true);
            toast(`Added "${item.name}" sticker.`);
          } catch (err) { toast('Could not load that sticker.', 'error'); }
        });
        grid.appendChild(cell);
      }
      section.appendChild(grid);
      groupsDiv.appendChild(section);
    }
  }

  // ---------- Background tools panel ----------
  renderBackgroundPanel(body) {
    body.innerHTML = `<p class="empty-hint" style="text-align:left;">Select the subject with the Selection tool, then replace the background.</p>
      <div class="panel-section-title">Replace with</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
        <button class="btn" id="bg-solid">${icons.circle} Solid color</button>
        <button class="btn" id="bg-gradient">${icons.gradient} Gradient</button>
        <button class="btn" id="bg-upload">${icons.upload} Upload image</button>
        <input type="file" id="bg-file" accept="image/*" class="hidden" />
      </div>
      <div class="panel-section-title">AI background removal</div>
      <p class="empty-hint" style="text-align:left;">No local ML model is currently loaded, so this stays disabled — the editor never calls an online AI API. Drop a compatible model into <code>/models/</code> to enable it in a future version.</p>`;
    body.querySelector('#bg-solid').addEventListener('click', () => this._replaceBackground({ type: 'solid', color: '#1b1e23' }));
    body.querySelector('#bg-gradient').addEventListener('click', () => this._replaceBackground({ type: 'gradient' }));
    body.querySelector('#bg-upload').addEventListener('click', () => body.querySelector('#bg-file').click());
    body.querySelector('#bg-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this._replaceBackground({ type: 'image', file });
    });
  }

  async _replaceBackground(opts) {
    const layer = this.editor.getActiveLayer();
    if (!layer || !this._selectionMask) { toast('Make a subject selection first with the Selection tool.', 'warn'); return; }
    const p = this.editor.project;
    const bgLayer = this.editor.addLayer('image', { name: 'Background fill', width: p.width, height: p.height });
    const ctx = bgLayer.canvas.getContext('2d');
    if (opts.type === 'solid') {
      ctx.fillStyle = opts.color; ctx.fillRect(0, 0, p.width, p.height);
    } else if (opts.type === 'gradient') {
      const g = ctx.createLinearGradient(0, 0, p.width, p.height);
      g.addColorStop(0, '#49c5b6'); g.addColorStop(1, '#1b1e23');
      ctx.fillStyle = g; ctx.fillRect(0, 0, p.width, p.height);
    } else if (opts.type === 'image') {
      const img = await fileToImage(opts.file);
      ctx.drawImage(img, 0, 0, p.width, p.height);
    }
    bgLayer.sourceCanvas = bgLayer.canvas;
    // move new background below the selected subject layer
    const idx = p.layers.indexOf(bgLayer);
    p.layers.splice(idx, 1);
    const subjectIdx = p.layers.indexOf(layer);
    p.layers.splice(subjectIdx, 0, bgLayer);
    this.editor.setLayerMask(layer.id, this._selectionMask);
    this.editor.renderComposite();
    this.editor._commitHistory('Replace background', true);
    this.editor.onLayersChange();
    toast('Background replaced.');
  }

  // -----------------------------------------------------------
  // Small shared control builders
  // -----------------------------------------------------------
  _section(title, defs, adjustments, onReset) {
    const section = document.createElement('div');
    section.className = 'panel-section';
    const header = document.createElement('div');
    header.className = 'panel-section-title';
    header.innerHTML = `<span>${title}</span><button class="reset-mini">Reset</button>`;
    header.querySelector('.reset-mini').addEventListener('click', () => onReset(defs.map(d => d[0])));
    section.appendChild(header);
    for (const [key, label, min, max] of defs) {
      section.appendChild(this._slider(label, adjustments[key] || 0, min, max,
        v => this.editor.updateAdjustments({ [key]: v }, { commit: false, label }),
        () => this.editor.commitPendingHistory(label)));
    }
    return section;
  }

  _slider(label, value, min, max, onInput, onCommit) {
    const row = document.createElement('div');
    row.className = 'slider-row' + (value === 0 ? ' zeroed' : '');
    row.innerHTML = `<label>${escapeHTML(label)}</label>`;
    const input = document.createElement('input');
    input.type = 'range'; input.min = min; input.max = max; input.step = (max - min) > 10 ? 1 : 0.1; input.value = value;
    const output = document.createElement('output');
    output.textContent = Math.round(value * 10) / 10;
    input.addEventListener('input', () => { output.textContent = Math.round(Number(input.value) * 10) / 10; onInput(Number(input.value)); row.classList.toggle('zeroed', Number(input.value) === 0); });
    if (onCommit) input.addEventListener('change', () => onCommit(Number(input.value)));
    row.appendChild(input);
    row.appendChild(output);
    return row;
  }

  // -----------------------------------------------------------
  // Overlay canvas pointer interactions (per-tool)
  // -----------------------------------------------------------
  _bindOverlayPointer() {
    const overlay = this.dom.overlay;
    let pointerDown = false;
    let lastImagePt = null;
    let cloneSource = null;

    const getPt = (e) => this.viewport.screenToImage(e.clientX, e.clientY);

    overlay.addEventListener('pointerdown', (e) => {
      if (!this.editor.hasProject()) return;
      if (e.button === 1 || (e.button === 0 && e.getModifierState && e.getModifierState('Space'))) return; // panning handled elsewhere
      pointerDown = true;
      overlay.setPointerCapture(e.pointerId);
      const pt = getPt(e);
      lastImagePt = pt;

      if (this.activeTool === 'move') { this._startMoveDrag(pt); return; }
      if (this.activeTool === 'crop') { this._cropPointerDown(pt); return; }
      if (this.activeTool === 'selection') { this._selectionPointerDown(pt); return; }
      if (DRAWING_TOOLS.includes(this.activeTool) || this.activeTool === 'draw') { this._drawingPointerDown(pt); return; }
      if (this.activeTool.startsWith('mask-')) { this._maskPointerDown(pt); return; }
      if (this.activeTool === 'clone' || this.activeTool === 'healing') {
        if (e.altKey) { cloneSource = pt; toast('Source point set — now paint to ' + (this.activeTool === 'clone' ? 'clone' : 'heal') + '.'); return; }
        this._cloneSource = this._cloneSource || pt;
      }
      if (this.activeTool === 'spot') { this._doSpotRemoval(pt); return; }
      if (this.activeTool === 'redeye') { this._doRedEye(pt); return; }
    });

    overlay.addEventListener('pointermove', (e) => {
      if (!pointerDown || !this.editor.hasProject()) return;
      const pt = getPt(e);

      if (this.activeTool === 'move') { this._moveDrag(pt); lastImagePt = pt; return; }
      if (this.activeTool === 'crop') { this._cropPointerMove(pt); return; }
      if (this.activeTool === 'selection') { this._selectionPointerMove(pt); return; }
      if (DRAWING_TOOLS.includes(this.activeTool) || this.activeTool === 'draw') { this._drawingPointerMove(lastImagePt, pt); lastImagePt = pt; return; }
      if (this.activeTool.startsWith('mask-')) { this._maskPointerMove(lastImagePt, pt); lastImagePt = pt; return; }
      if ((this.activeTool === 'clone' || this.activeTool === 'healing') && (this._cloneSource || cloneSource)) {
        const src = this._cloneSource;
        if (src) this._applyCloneOrHeal(src, pt);
        return;
      }
    });

    window.addEventListener('pointerup', () => {
      if (!pointerDown) return;
      pointerDown = false;
      if (this.activeTool === 'move') this._endMoveDrag();
      if (DRAWING_TOOLS.includes(this.activeTool) || this.activeTool === 'draw') this._endDrawing();
      if (this.activeTool.startsWith('mask-')) this._endMaskPaint();
      if (this.activeTool === 'selection') this._endSelectionDrag();
    });

    overlay.addEventListener('dblclick', (e) => {
      const pt = getPt(e);
      const layer = this._hitTestLayer(pt);
      if (layer && layer.type === 'text') { this.editor.setActiveLayer(layer.id); this.setPanelTab('text-tool'); }
    });
  }

  _hitTestLayer(pt) {
    const layers = [...this.editor.project.layers].reverse();
    for (const layer of layers) {
      if (!layer.visible || layer.type === 'image') continue;
      if (pt.x >= layer.x && pt.x <= layer.x + layer.canvas.width && pt.y >= layer.y && pt.y <= layer.y + layer.canvas.height) return layer;
    }
    return null;
  }

  _startMoveDrag(pt) {
    const layer = this._hitTestLayer(pt) || this.editor.getActiveLayer();
    if (!layer || layer.type === 'image' || layer.locked) { this.dragState = null; return; }
    this.editor.setActiveLayer(layer.id);
    this.dragState = { layer, startX: layer.x, startY: layer.y, startPt: pt };
  }
  _moveDrag(pt) {
    if (!this.dragState) return;
    const { layer, startX, startY, startPt } = this.dragState;
    layer.x = startX + (pt.x - startPt.x);
    layer.y = startY + (pt.y - startPt.y);
    this.editor.renderComposite();
  }
  _endMoveDrag() {
    if (this.dragState) this.editor._commitHistory('Move layer', true);
    this.dragState = null;
  }

  // ---- crop ----
  _initCropOverlay() {
    const p = this.editor.project;
    this.cropState = { x: p.width * 0.1, y: p.height * 0.1, w: p.width * 0.8, h: p.height * 0.8, ratio: null, dragging: null };
    this._drawCropOverlay();
  }
  _cropPointerDown(pt) {
    if (!this.cropState) this._initCropOverlay();
    this.cropState.dragging = 'new';
    this.cropState.start = pt;
  }
  _cropPointerMove(pt) {
    if (!this.cropState || !this.cropState.dragging) return;
    const s = this.cropState.start;
    let x = Math.min(s.x, pt.x), y = Math.min(s.y, pt.y);
    let w = Math.abs(pt.x - s.x), h = Math.abs(pt.y - s.y);
    if (this.cropState.ratio) { h = w / this.cropState.ratio; }
    Object.assign(this.cropState, { x, y, w, h });
    this._drawCropOverlay();
  }
  _drawCropOverlay() {
    const ctx = this.dom.overlay.getContext('2d');
    const { width, height } = this.editor.project;
    ctx.clearRect(0, 0, width, height);
    if (!this.cropState) return;
    const { x, y, w, h } = this.cropState;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, width, height);
    ctx.clearRect(x, y, w, h);
    ctx.strokeStyle = '#49c5b6';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }
  _applyCrop() {
    if (!this.cropState) return;
    const { x, y, w, h } = this.cropState;
    if (w < 4 || h < 4) { toast('Draw a crop area first.', 'warn'); return; }
    this.editor.cropProject(x, y, w, h);
    this.cropState = null;
    this.dom.overlay.getContext('2d').clearRect(0, 0, this.editor.project.width, this.editor.project.height);
    this.selectTool('move');
  }

  // ---- selection ----
  _selectionPointerDown(pt) {
    const mode = this.toolOptions?.selection?.mode || 'rect';
    this._selStart = pt;
    this._selMode = mode;
    if (mode === 'lasso') this._lassoPoints = [pt];
    if (mode === 'wand') {
      const layer = this.editor.getBaseImageLayer();
      const imgData = layer.canvas.getContext('2d').getImageData(0, 0, layer.canvas.width, layer.canvas.height);
      const tol = this.toolOptions?.selection?.tolerance ?? 24;
      this._selectionMask = magicWandMask(imgData, Math.round(pt.x), Math.round(pt.y), tol, true);
      this._drawSelectionOverlay();
    }
  }
  _selectionPointerMove(pt) {
    if (this._selMode === 'lasso') { this._lassoPoints.push(pt); this._drawLassoPreview(); return; }
    if (this._selMode === 'wand' || !this._selStart) return;
    const s = this._selStart;
    const x = Math.min(s.x, pt.x), y = Math.min(s.y, pt.y), w = Math.abs(pt.x - s.x), h = Math.abs(pt.y - s.y);
    const p = this.editor.project;
    this._selectionMask = this._selMode === 'ellipse' ? ellipseSelectionMask(p.width, p.height, x, y, w, h) : rectSelectionMask(p.width, p.height, x, y, w, h);
    this._drawSelectionOverlay();
  }
  _endSelectionDrag() {
    if (this._selMode === 'lasso' && this._lassoPoints?.length > 2) {
      const p = this.editor.project;
      this._selectionMask = lassoSelectionMask(p.width, p.height, this._lassoPoints);
      this._drawSelectionOverlay();
    }
    this._lassoPoints = null;
  }
  _drawLassoPreview() {
    const ctx = this.dom.overlay.getContext('2d');
    const { width, height } = this.editor.project;
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = '#49c5b6';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    this._lassoPoints.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();
  }
  _drawSelectionOverlay() {
    const ctx = this.dom.overlay.getContext('2d');
    const { width, height } = this.editor.project;
    ctx.clearRect(0, 0, width, height);
    if (this._selectionMask) drawMaskOverlay(ctx, this._selectionMask, width, height);
  }

  // ---- drawing tools ----
  _drawingPointerDown(pt) {
    let layer = this.editor.getActiveLayer();
    if (!layer || layer.type !== 'drawing') {
      layer = this.editor.addDrawingLayer();
      this.renderActivePanel();
    }
    this._activeDrawLayer = layer;
    const ctx = layer.canvas.getContext('2d');
    const opts = this._currentDrawOpts();
    drawStrokeSegment(ctx, this.activeTool, pt, pt, opts);
    this.editor.renderComposite();
  }
  _drawingPointerMove(from, to) {
    if (!this._activeDrawLayer) return;
    const ctx = this._activeDrawLayer.canvas.getContext('2d');
    drawStrokeSegment(ctx, this.activeTool, from, to, this._currentDrawOpts());
    this.editor.renderComposite();
  }
  _endDrawing() {
    if (this._activeDrawLayer) this.editor._commitHistory('Draw stroke', true);
    this._activeDrawLayer = null;
  }
  _currentDrawOpts() {
    const o = this.toolOptions?.[this.activeTool] || { size: 20, opacity: 100, hardness: 60, color: '#ffffff' };
    return { size: o.size, opacity: o.opacity, hardness: o.hardness ?? 60, color: o.color || '#ffffff' };
  }

  // ---- mask painting ----
  _maskPointerDown(pt) {
    const layer = this.editor.getActiveLayer();
    if (!layer || !layer.mask) return;
    if (layer.mask.kind === 'linear-gradient') { this._gradStart = pt; return; }
    if (layer.mask.kind === 'radial-gradient') { this._gradStart = pt; return; }
    if (layer.mask.kind === 'rect' || layer.mask.kind === 'ellipse') { this._maskShapeStart = pt; return; }
    const o = this.toolOptions?.brush || { size: 40, opacity: 100, hardness: 70 };
    paintBrushStroke(layer.mask, pt.x, pt.y, pt.x, pt.y, o.size / 2, o.hardness, o.opacity);
    this.editor.renderComposite();
  }
  _maskPointerMove(from, to) {
    const layer = this.editor.getActiveLayer();
    if (!layer || !layer.mask) return;
    if (layer.mask.kind === 'linear-gradient' && this._gradStart) {
      paintLinearGradientMask(layer.mask, this._gradStart.x, this._gradStart.y, to.x, to.y);
      this.editor.renderComposite();
      return;
    }
    if (layer.mask.kind === 'radial-gradient' && this._gradStart) {
      const r = Math.hypot(to.x - this._gradStart.x, to.y - this._gradStart.y);
      paintRadialGradientMask(layer.mask, this._gradStart.x, this._gradStart.y, r);
      this.editor.renderComposite();
      return;
    }
    if ((layer.mask.kind === 'rect' || layer.mask.kind === 'ellipse') && this._maskShapeStart) {
      const s = this._maskShapeStart;
      const x = Math.min(s.x, to.x), y = Math.min(s.y, to.y), w = Math.abs(to.x - s.x), h = Math.abs(to.y - s.y);
      paintShapeMask(layer.mask, layer.mask.kind, x, y, w, h, layer.mask.feather || 0);
      this.editor.renderComposite();
      return;
    }
    if (layer.mask.kind === 'brush') {
      const o = this.toolOptions?.brush || { size: 40, opacity: 100, hardness: 70 };
      paintBrushStroke(layer.mask, from.x, from.y, to.x, to.y, o.size / 2, o.hardness, o.opacity, this.activeTool === 'mask-eraser');
      this.editor.renderComposite();
    }
  }
  _endMaskPaint() {
    this._gradStart = null;
    this._maskShapeStart = null;
    this.editor._commitHistory('Paint mask', true);
  }

  // ---- retouch ----
  _applyCloneOrHeal(src, dst) {
    const layer = this.editor.getBaseImageLayer();
    const ctx = layer.sourceCanvas.getContext('2d');
    const o = this.toolOptions?.[this.activeTool] || { size: 30, opacity: 100 };
    if (this.activeTool === 'clone') cloneStamp(ctx, src.x, src.y, dst.x, dst.y, o.size / 2, o.opacity);
    else healingBrush(ctx, src.x, src.y, dst.x, dst.y, o.size / 2, o.opacity);
    this.editor._refreshLayerCanvas(layer);
    this.editor.renderComposite();
  }
  _doSpotRemoval(pt) {
    const layer = this.editor.getBaseImageLayer();
    spotRemoval(layer.sourceCanvas.getContext('2d'), pt.x, pt.y, this._spotSize || 24);
    this.editor._refreshLayerCanvas(layer);
    this.editor.renderComposite();
    this.editor._commitHistory('Spot removal', true);
  }
  _doRedEye(pt) {
    const layer = this.editor.getBaseImageLayer();
    redEyeRemoval(layer.sourceCanvas.getContext('2d'), pt.x, pt.y, this._redEyeSize || 20);
    this.editor._refreshLayerCanvas(layer);
    this.editor.renderComposite();
    this.editor._commitHistory('Red-eye removal', true);
  }

  // -----------------------------------------------------------
  // Before / after compare divider
  // -----------------------------------------------------------
  _bindCompareDivider() {
    const divider = this.dom.compareDivider;
    let dragging = false;
    divider.addEventListener('pointerdown', e => { dragging = true; divider.setPointerCapture(e.pointerId); });
    divider.addEventListener('pointermove', e => {
      if (!dragging) return;
      const rect = this.viewport.viewport.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this.setCompareFraction(frac);
    });
    divider.addEventListener('pointerup', () => dragging = false);
  }

  setCompareFraction(frac) {
    this.viewport.compareX = frac;
    const rect = this.viewport.viewport.getBoundingClientRect();
    this.dom.compareDivider.style.left = `${frac * rect.width}px`;
  }

  toggleCompare(force) {
    this.viewport.compareMode = force !== undefined ? force : !this.viewport.compareMode;
    document.getElementById('compare-btn').classList.toggle('active', this.viewport.compareMode);
    this.dom.compareDivider.classList.toggle('hidden', !this.viewport.compareMode);
    if (this.viewport.compareMode) this.setCompareFraction(0.5);
  }

  // -----------------------------------------------------------
  // Status bar / topbar
  // -----------------------------------------------------------
  updateStatusBar() {
    const p = this.editor.project;
    if (!p) return;
    this.dom.dims.textContent = `${p.fullWidth} × ${p.fullHeight}px`;
    this.dom.fileInfo.textContent = p.name || '';
    document.getElementById('topbar-filename').textContent = p.name || 'Untitled';
  }

  updateTopbarState() {
    document.getElementById('undo-btn').disabled = !this.editor.history.canUndo();
    document.getElementById('redo-btn').disabled = !this.editor.history.canRedo();
  }

  _drawMaskOverlayIfNeeded() {
    const layer = this.editor.getActiveLayer();
    const ctx = this.dom.overlay.getContext('2d');
    const { width, height } = this.editor.project;
    ctx.clearRect(0, 0, width, height);
    if (this.showMaskOverlay && layer && layer.mask) drawMaskOverlay(ctx, layer.mask, width, height);
  }
}

async function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = reject;
    img.src = url;
  });
}

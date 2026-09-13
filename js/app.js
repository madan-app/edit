// =============================================================
// app.js — application entry point. Wires the start screen, top
// bar, and Editor/UI together; owns project open/save/export
// flows and autosave.
// =============================================================

import { Editor } from './editor.js';
import { CanvasViewport } from './canvas.js';
import { UI, toast, confirmModal, promptModal } from './ui.js';
import { loadImageForEditing, ImageValidationError } from './image-loader.js';
import { Storage, uid } from './storage.js';
import { bindShortcuts } from './shortcuts.js';

const viewport = new CanvasViewport({
  viewport: document.getElementById('canvas-viewport'),
  stack: document.getElementById('canvas-stack'),
  mainCanvas: document.getElementById('main-canvas'),
  overlayCanvas: document.getElementById('overlay-canvas'),
  emptyHint: document.getElementById('empty-canvas-hint')
});
viewport.onZoomChange = (z) => { document.getElementById('zoom-level').textContent = `${Math.round(z * 100)}%`; };

const editor = new Editor(viewport);
const ui = new UI(editor, viewport);

let autosaveTimer = null;

// -----------------------------------------------------------
// Start screen
// -----------------------------------------------------------
async function refreshRecentProjects() {
  const listEl = document.getElementById('recent-list');
  try {
    const projects = await Storage.listProjects();
    listEl.innerHTML = '';
    if (!projects.length) { listEl.innerHTML = '<p class="empty-hint">No saved projects yet.</p>'; return; }
    for (const p of projects.slice(0, 8)) {
      const row = document.createElement('div');
      row.className = 'recent-item';
      const date = new Date(p.updatedAt).toLocaleString();
      row.innerHTML = `<button class="open-link">${escapeHTML(p.name)}</button><span class="meta">${date}</span>`;
      row.querySelector('.open-link').addEventListener('click', () => openProjectById(p.id));
      listEl.appendChild(row);
    }
  } catch (err) {
    listEl.innerHTML = '<p class="empty-hint">Saved projects are unavailable (IndexedDB could not be opened).</p>';
  }
}

function escapeHTML(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

function showStartScreen(show) {
  document.getElementById('start-screen').classList.toggle('hidden', !show);
}

async function openProjectById(id) {
  try {
    const record = await Storage.getProject(id);
    if (!record) { toast('That project could not be found.', 'error'); return; }
    await editor.loadFromStorage(record);
    showStartScreen(false);
    ui.renderActivePanel();
    ui.updateTopbarState();
    startAutosave();
    toast(`Reopened "${record.name}".`);
  } catch (err) {
    toast('Could not open that project.', 'error');
  }
}

// -----------------------------------------------------------
// Open / New file flow
// -----------------------------------------------------------
const fileInput = document.getElementById('file-input');

async function handleOpenFiles(files) {
  const file = files[0];
  if (!file) return;
  try {
    toast('Loading photo…');
    const loaded = await loadImageForEditing(file);
    editor.newProjectFromImage(loaded);
    showStartScreen(false);
    ui.selectTool('move');
    ui.setPanelTab('adjust');
    ui.updateTopbarState();
    startAutosave();
  } catch (err) {
    if (err instanceof ImageValidationError) toast(err.message, 'error');
    else toast('This image could not be opened. It may be corrupt or too large.', 'error');
  }
}

document.getElementById('open-btn-start').addEventListener('click', () => fileInput.click());
document.getElementById('open-btn-top').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => handleOpenFiles(e.target.files));

// Drag & drop support anywhere over the stage
const stage = document.getElementById('stage');
['dragover', 'dragenter'].forEach(evt => stage.addEventListener(evt, e => { e.preventDefault(); }));
stage.addEventListener('drop', e => {
  e.preventDefault();
  if (e.dataTransfer.files.length) handleOpenFiles(e.dataTransfer.files);
});

document.getElementById('new-btn').addEventListener('click', async () => {
  if (editor.hasProject()) {
    const ok = await confirmModal({ title: 'Start a new photo?', body: 'Any unsaved changes to the current photo will be lost unless you saved the project.', confirmLabel: 'Start new' });
    if (!ok) return;
  }
  fileInput.click();
});

// -----------------------------------------------------------
// Save / autosave
// -----------------------------------------------------------
async function saveProject(silent = false) {
  if (!editor.hasProject()) return;
  try {
    const record = await editor.serializeForStorage();
    await Storage.saveProject(record);
    if (!silent) toast('Project saved.');
  } catch (err) {
    toast('Could not save the project (storage may be full).', 'error');
  }
}

function startAutosave() {
  clearInterval(autosaveTimer);
  autosaveTimer = setInterval(() => saveProject(true), 45000);
}

document.getElementById('save-btn').addEventListener('click', () => saveProject(false));

window.addEventListener('beforeunload', (e) => {
  if (editor.hasProject()) {
    saveProject(true);
  }
});

// -----------------------------------------------------------
// Undo / redo / compare / export top bar
// -----------------------------------------------------------
document.getElementById('undo-btn').addEventListener('click', () => editor.undo());
document.getElementById('redo-btn').addEventListener('click', () => editor.redo());
document.getElementById('compare-btn').addEventListener('click', () => ui.toggleCompare());
document.getElementById('export-btn').addEventListener('click', () => ui.setPanelTab('export'));

// -----------------------------------------------------------
// Zoom bar
// -----------------------------------------------------------
document.getElementById('zoom-in-btn').addEventListener('click', () => viewport.zoomBy(1.2));
document.getElementById('zoom-out-btn').addEventListener('click', () => viewport.zoomBy(0.8));
document.getElementById('zoom-fit-btn').addEventListener('click', () => viewport.fitToScreen());
document.getElementById('zoom-100-btn').addEventListener('click', () => viewport.zoomTo100());
document.getElementById('grid-toggle-btn').addEventListener('click', (e) => {
  viewport.toggleGrid();
  e.currentTarget.classList.toggle('active', viewport.showGrid);
});

// -----------------------------------------------------------
// Mobile: tapping the canvas area closes any open bottom sheet
// -----------------------------------------------------------
document.getElementById('canvas-viewport').addEventListener('pointerdown', () => {
  if (window.matchMedia('(max-width: 860px)').matches) ui.closeMobileSheet();
});

// -----------------------------------------------------------
// Keyboard shortcuts
// -----------------------------------------------------------
bindShortcuts({
  undo: () => editor.undo(),
  redo: () => editor.redo(),
  save: () => saveProject(false),
  open: () => fileInput.click(),
  export: () => ui.setPanelTab('export'),
  selectTool: (t) => ui.selectTool(t),
  toggleGrid: () => { viewport.toggleGrid(); document.getElementById('grid-toggle-btn').classList.toggle('active', viewport.showGrid); },
  toggleCompare: () => ui.toggleCompare()
});

// -----------------------------------------------------------
// Global error safety net — a single failing operation should
// never take down the whole app.
// -----------------------------------------------------------
window.addEventListener('error', (e) => {
  console.error('Unhandled error:', e.error || e.message);
  toast('Something went wrong with that action, but your project is safe.', 'error');
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled rejection:', e.reason);
  toast('Something went wrong with that action, but your project is safe.', 'error');
});

// -----------------------------------------------------------
// PWA: register service worker
// -----------------------------------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {
      // offline support just won't be available — the editor still works online.
    });
  });
}

// -----------------------------------------------------------
// Boot
// -----------------------------------------------------------
refreshRecentProjects();
ui.renderToolOptionsBar();
ui.updateTopbarState();

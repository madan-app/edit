// =============================================================
// presets.js — save/apply/rename/delete/import/export presets.
// A preset is simply a named, serializable "adjustments" recipe
// (the same shape produced by adjustments.js) plus an optional
// filter id. Presets are stored in IndexedDB via storage.js.
// =============================================================

import { Storage, uid } from './storage.js';
import { DEFAULT_ADJUSTMENTS, cloneAdjustments, normalizeAdjustments } from './adjustments.js';

export async function loadAllPresets() {
  const stored = await Storage.listPresets();
  if (stored.length === 0) {
    const bundled = await loadBundledPresets();
    for (const p of bundled) await Storage.savePreset(p);
    return bundled;
  }
  return stored;
}

export async function savePresetFromState(name, adjustments, filterId) {
  const preset = { id: uid('preset'), name, adjustments: cloneAdjustments(adjustments), filterId: filterId || 'original', builtin: false };
  await Storage.savePreset(preset);
  return preset;
}

export async function renamePreset(preset, newName) {
  preset.name = newName;
  await Storage.savePreset(preset);
  return preset;
}

export async function deletePreset(id) {
  return Storage.deletePreset(id);
}

export function exportPresetJSON(preset) {
  const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(preset.name || 'preset').replace(/\s+/g, '-').toLowerCase()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function importPresetJSON(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const preset = {
    id: uid('preset'),
    name: parsed.name || 'Imported preset',
    adjustments: normalizeAdjustments(parsed.adjustments || {}),
    filterId: parsed.filterId || 'original',
    builtin: false
  };
  await Storage.savePreset(preset);
  return preset;
}

async function loadBundledPresets() {
  try {
    const res = await fetch('./assets/presets/sample-presets.json');
    const list = await res.json();
    return list.map(p => ({ ...p, id: p.id || uid('preset'), builtin: true, adjustments: normalizeAdjustments(p.adjustments || {}) }));
  } catch (err) {
    return [];
  }
}

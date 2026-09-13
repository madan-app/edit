// =============================================================
// storage.js — IndexedDB persistence layer.
// Stores: projects (original image blob + editing state + layers),
// presets, and app settings. Nothing here ever leaves the device.
// =============================================================

const DB_NAME = 'graphite-editor';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_PRESETS = 'presets';
const STORE_SETTINGS = 'settings';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains(STORE_PRESETS)) {
        db.createObjectStore(STORE_PRESETS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB.'));
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDB().then(db => db.transaction(storeName, mode).objectStore(storeName));
}

function wrapRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const Storage = {
  async saveProject(project) {
    project.updatedAt = Date.now();
    const store = await tx(STORE_PROJECTS, 'readwrite');
    await wrapRequest(store.put(project));
    return project;
  },
  async getProject(id) {
    const store = await tx(STORE_PROJECTS, 'readonly');
    return wrapRequest(store.get(id));
  },
  async listProjects() {
    const store = await tx(STORE_PROJECTS, 'readonly');
    const all = await wrapRequest(store.getAll());
    return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },
  async deleteProject(id) {
    const store = await tx(STORE_PROJECTS, 'readwrite');
    return wrapRequest(store.delete(id));
  },

  async savePreset(preset) {
    const store = await tx(STORE_PRESETS, 'readwrite');
    return wrapRequest(store.put(preset));
  },
  async listPresets() {
    const store = await tx(STORE_PRESETS, 'readonly');
    return wrapRequest(store.getAll());
  },
  async deletePreset(id) {
    const store = await tx(STORE_PRESETS, 'readwrite');
    return wrapRequest(store.delete(id));
  },

  async setSetting(key, value) {
    const store = await tx(STORE_SETTINGS, 'readwrite');
    return wrapRequest(store.put({ key, value }));
  },
  async getSetting(key) {
    const store = await tx(STORE_SETTINGS, 'readonly');
    const rec = await wrapRequest(store.get(key));
    return rec ? rec.value : undefined;
  }
};

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

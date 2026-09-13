// =============================================================
// icons.js — original minimal line-icon set (no third-party glyphs).
// Each entry is a raw <svg> string sized to inherit currentColor.
// =============================================================

const wrap = (inner) => `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const icons = {
  save: wrap('<path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M8 4v6h8V4"/><path d="M8 14h8v6H8z"/>'),
  upload: wrap('<path d="M12 16V5"/><path d="M7 9l5-5 5 5"/><path d="M5 19h14"/>'),
  download: wrap('<path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M5 19h14"/>'),
  edit: wrap('<path d="M4 20h4l11-11-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>'),
  trash: wrap('<path d="M5 7h14"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M7 7l1 13h8l1-13"/>'),
  brush: wrap('<path d="M4 20c0-3 2-4 4-4s3 2 5 2 3-6 7-10"/><path d="M13.5 6.5l4 4"/>'),
  gradient: wrap('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 4l16 16"/>'),
  rect: wrap('<rect x="4" y="6" width="16" height="12" rx="1.5"/>'),
  circle: wrap('<circle cx="12" cy="12" r="8"/>'),
  invert: wrap('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/>'),
  eye: wrap('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: wrap('<path d="M3 3l18 18"/><path d="M10.6 5.2A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a15.6 15.6 0 0 1-3.4 4.3M6.6 6.6C4 8.3 2 12 2 12s3.5 7 10 7a10.8 10.8 0 0 0 3.4-.6"/><path d="M9.5 9.8A3 3 0 0 0 12 15a3 3 0 0 0 2.2-1"/>'),
  lock: wrap('<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  unlock: wrap('<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>'),
  copy: wrap('<rect x="4" y="4" width="12" height="12" rx="1.5"/><path d="M8 20h12V8h-4"/>'),
  check: wrap('<path d="M5 13l4 4 10-10"/>'),
  rotateLeft: wrap('<path d="M4 9a8 8 0 1 1-1.5 5"/><path d="M2 5v4h4"/>'),
  flip: wrap('<path d="M12 3v18"/><path d="M7 7l-3 5 3 5"/><path d="M17 7l3 5-3 5"/>'),
  plus: wrap('<path d="M12 5v14"/><path d="M5 12h14"/>'),
  minus: wrap('<path d="M5 12h14"/>'),
  shape: wrap('<path d="M12 3l9 9-9 9-9-9z"/>')
};

export default icons;

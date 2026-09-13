// =============================================================
// shortcuts.js — global keyboard shortcuts.
// =============================================================

export function bindShortcuts(handlers) {
  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

    const mod = e.ctrlKey || e.metaKey;

    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); handlers.undo?.(); return; }
    if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); handlers.redo?.(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); handlers.save?.(); return; }
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); handlers.open?.(); return; }
    if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); handlers.export?.(); return; }

    if (e.code === 'Space') { handlers.panStart?.(); return; }

    switch (e.key.toLowerCase()) {
      case 'b': handlers.selectTool?.('brush'); break;
      case 'c': handlers.selectTool?.('crop'); break;
      case 't': handlers.selectTool?.('text'); break;
      case 'v': handlers.selectTool?.('move'); break;
      case 'e': handlers.selectTool?.('eraser'); break;
      case 'm': handlers.selectTool?.('selection'); break;
      case 'g': handlers.toggleGrid?.(); break;
      case '\\': handlers.toggleCompare?.(); break;
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') handlers.panEnd?.();
  });
}

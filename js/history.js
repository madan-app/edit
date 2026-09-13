// =============================================================
// history.js — non-destructive undo/redo.
// Stores lightweight state SNAPSHOTS of the editing recipe
// (adjustments/layers/masks JSON), not full-resolution pixel
// buffers, so history stays cheap even on large photos.
// =============================================================

export class HistoryStack {
  constructor(onChange) {
    this.stack = [];      // array of { label, state }
    this.pointer = -1;    // index of current state
    this.limit = 60;
    this.onChange = onChange || (() => {});
  }

  /** Push a new state snapshot (deep-cloned by caller). Truncates redo branch. */
  push(label, state) {
    this.stack = this.stack.slice(0, this.pointer + 1);
    this.stack.push({ label, state, time: Date.now() });
    if (this.stack.length > this.limit) this.stack.shift();
    this.pointer = this.stack.length - 1;
    this.onChange();
  }

  canUndo() { return this.pointer > 0; }
  canRedo() { return this.pointer < this.stack.length - 1; }

  undo() {
    if (!this.canUndo()) return null;
    this.pointer--;
    this.onChange();
    return this.stack[this.pointer].state;
  }

  redo() {
    if (!this.canRedo()) return null;
    this.pointer++;
    this.onChange();
    return this.stack[this.pointer].state;
  }

  jumpTo(index) {
    if (index < 0 || index >= this.stack.length) return null;
    this.pointer = index;
    this.onChange();
    return this.stack[this.pointer].state;
  }

  current() {
    return this.pointer >= 0 ? this.stack[this.pointer].state : null;
  }

  list() {
    return this.stack.map((entry, i) => ({ label: entry.label, index: i, current: i === this.pointer }));
  }

  reset(label, state) {
    this.stack = [{ label, state, time: Date.now() }];
    this.pointer = 0;
    this.onChange();
  }
}

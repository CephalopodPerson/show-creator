import { useState, useRef, useCallback, useEffect } from 'react';

// ── Undo / redo with transaction support ──────────────────────────────────────
// Continuous gestures (dragging a block, resizing) fire dozens of updates. Each
// one must NOT become its own undo entry or a single drag would take 40 undos to
// reverse. So a gesture calls begin() once on pointerdown — that snapshots the
// pre-drag state — and every update until end() folds into that one entry.

export default function useHistory(initial, { limit = 60 } = {}) {
  const [state, setState] = useState(initial);
  const past    = useRef([]);
  const future  = useRef([]);
  const inTxn   = useRef(false);
  const [, bump] = useState(0);          // force re-render for canUndo/canRedo

  const refresh = () => bump(n => n + 1);

  // Replace state and push the previous value onto the undo stack
  const set = useCallback((next) => {
    setState(prev => {
      const value = typeof next === 'function' ? next(prev) : prev;
      const resolved = typeof next === 'function' ? value : next;
      if (resolved === prev) return prev;
      if (!inTxn.current) {
        past.current.push(prev);
        if (past.current.length > limit) past.current.shift();
        future.current = [];
        refresh();
      }
      return resolved;
    });
  }, [limit]);

  // Snapshot now; subsequent set() calls collapse into this entry until end()
  const begin = useCallback(() => {
    if (inTxn.current) return;
    setState(prev => {
      past.current.push(prev);
      if (past.current.length > limit) past.current.shift();
      future.current = [];
      return prev;
    });
    inTxn.current = true;
    refresh();
  }, [limit]);

  const end = useCallback(() => { inTxn.current = false; refresh(); }, []);

  // Replace state without touching history (e.g. loading from server)
  const reset = useCallback((value) => {
    past.current = [];
    future.current = [];
    setState(value);
    refresh();
  }, []);

  const undo = useCallback(() => {
    setState(prev => {
      if (past.current.length === 0) return prev;
      const previous = past.current.pop();
      future.current.push(prev);
      refresh();
      return previous;
    });
  }, []);

  const redo = useCallback(() => {
    setState(prev => {
      if (future.current.length === 0) return prev;
      const next = future.current.pop();
      past.current.push(prev);
      refresh();
      return next;
    });
  }, []);

  return {
    state, set, begin, end, reset, undo, redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
export function useUndoShortcuts({ undo, redo, onCopy, onPaste, enabled = true }) {
  useEffect(() => {
    if (!enabled) return;
    function onKey(e) {
      // Don't hijack typing in inputs
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();

      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo?.(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo?.(); }
      else if (k === 'c') { onCopy?.(); }
      else if (k === 'v') { onPaste?.(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, onCopy, onPaste, enabled]);
}

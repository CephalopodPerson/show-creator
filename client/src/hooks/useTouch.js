import { useState, useEffect } from 'react';

// ── Coarse-pointer detection ──────────────────────────────────────────────────
// Drives the interaction model, not the layout. On a mouse, dragging a swatch
// onto a block is direct and fast. On a finger it fights with page scrolling
// and you can't see what's under your thumb — so touch gets tap-to-arm then
// tap-to-apply instead.
//
// Keyed off pointer capability rather than screen width: a small laptop window
// should still drag, and a large tablet should still tap.
export default function useIsTouch() {
  const [touch, setTouch] = useState(() =>
    typeof window !== 'undefined' &&
    window.matchMedia?.('(pointer: coarse)').matches
  );

  useEffect(() => {
    const mq = window.matchMedia?.('(pointer: coarse)');
    if (!mq) return;
    const on = e => setTouch(e.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);

  return touch;
}

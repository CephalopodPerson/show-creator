import React, { useState, useEffect, useRef, useCallback } from 'react';

// ── Palette definitions ───────────────────────────────────────────────────────
export const COLORS = [
  { key: 'red',    label: 'Red',    hex: '#ef4444', par: { r: 255, g: 0,   b: 0,   w: 0,   a: 0,   uv: 0   }, spot: { r: 255, g: 0,   b: 0,   w: 0   } },
  { key: 'orange', label: 'Orange', hex: '#f97316', par: { r: 255, g: 80,  b: 0,   w: 0,   a: 200, uv: 0   }, spot: { r: 255, g: 80,  b: 0,   w: 0   } },
  { key: 'amber',  label: 'Amber',  hex: '#f5a524', par: { r: 255, g: 140, b: 20,  w: 90,  a: 120, uv: 0   }, spot: { r: 255, g: 150, b: 40,  w: 70  } },
  { key: 'yellow', label: 'Yellow', hex: '#eab308', par: { r: 255, g: 220, b: 0,   w: 0,   a: 100, uv: 0   }, spot: { r: 255, g: 220, b: 0,   w: 0   } },
  { key: 'lime',   label: 'Lime',   hex: '#84cc16', par: { r: 150, g: 230, b: 0,   w: 0,   a: 0,   uv: 0   }, spot: { r: 160, g: 235, b: 0,   w: 0   } },
  { key: 'green',  label: 'Green',  hex: '#22c55e', par: { r: 0,   g: 220, b: 60,  w: 0,   a: 0,   uv: 0   }, spot: { r: 0,   g: 225, b: 70,  w: 0   } },
  { key: 'teal',   label: 'Teal',   hex: '#14b8a6', par: { r: 0,   g: 210, b: 180, w: 0,   a: 0,   uv: 0   }, spot: { r: 0,   g: 215, b: 190, w: 0   } },
  { key: 'cyan',   label: 'Cyan',   hex: '#06b6d4', par: { r: 0,   g: 200, b: 230, w: 0,   a: 0,   uv: 0   }, spot: { r: 0,   g: 205, b: 235, w: 0   } },
  { key: 'blue',   label: 'Blue',   hex: '#3b82f6', par: { r: 0,   g: 90,  b: 255, w: 0,   a: 0,   uv: 0   }, spot: { r: 10,  g: 100, b: 255, w: 0   } },
  { key: 'indigo', label: 'Indigo', hex: '#6366f1', par: { r: 70,  g: 60,  b: 245, w: 0,   a: 0,   uv: 30  }, spot: { r: 80,  g: 70,  b: 250, w: 0   } },
  { key: 'purple', label: 'Purple', hex: '#a855f7', par: { r: 180, g: 0,   b: 255, w: 0,   a: 0,   uv: 40  }, spot: { r: 185, g: 10,  b: 255, w: 0   } },
  { key: 'pink',   label: 'Pink',   hex: '#ec4899', par: { r: 255, g: 0,   b: 140, w: 0,   a: 0,   uv: 0   }, spot: { r: 255, g: 0,   b: 150, w: 0   } },
  { key: 'warm',   label: 'Warm',   hex: '#fcd9a4', par: { r: 255, g: 140, b: 20,  w: 255, a: 0,   uv: 0   }, spot: { r: 255, g: 160, b: 80,  w: 200 } },
  { key: 'cool',   label: 'Cool',   hex: '#cfe4ff', par: { r: 180, g: 210, b: 255, w: 200, a: 0,   uv: 0   }, spot: { r: 180, g: 210, b: 255, w: 200 } },
  { key: 'uv',     label: 'UV',     hex: '#7c3aed', par: { r: 0,   g: 0,   b: 0,   w: 0,   a: 0,   uv: 255 }, spot: { r: 40,  g: 0,   b: 100, w: 0   } },
  { key: 'off',    label: 'Off',    hex: '#cbd5e1', par: { r: 0,   g: 0,   b: 0,   w: 0,   a: 0,   uv: 0   }, spot: { r: 0,   g: 0,   b: 0,   w: 0   } },
];

export const EFFECTS = [
  { key: 'fade',   label: 'Fade',   icon: '◐', hint: 'Ease into this section',  make: () => ({ type: 'fade',   direction: 'in', duration_s: 1.5 }) },
  { key: 'flash',  label: 'Flash',  icon: '✦', hint: 'Quick bursts of color',   make: () => ({ type: 'flash',  at: 0, duration_s: 0.15, repeat: 3, gap_s: 0.35 }) },
  { key: 'pulse',  label: 'Pulse',  icon: '◉', hint: 'Rhythmic breathing',      make: () => ({ type: 'pulse',  rate_hz: 2, depth: 0.5 }) },
  { key: 'strobe', label: 'Strobe', icon: '⚡', hint: 'Hard strobe on the pars', make: () => ({ type: 'strobe', value: 200 }) },
];

export const EFFECT_META = Object.fromEntries(EFFECTS.map(e => [e.key, e]));
export const COLOR_META  = Object.fromEntries(COLORS.map(c => [c.key, c]));

// ── Usage tracking ────────────────────────────────────────────────────────────
// Counts live in localStorage so "frequently used" reflects how this operator
// actually works, and survives reloads.
const USAGE_KEY = 'paletteUsage';

function readUsage() {
  try { return JSON.parse(localStorage.getItem(USAGE_KEY)) ?? { colors: {}, effects: {} }; }
  catch { return { colors: {}, effects: {} }; }
}

export function useUsage() {
  const [usage, setUsage] = useState(readUsage);

  const bump = useCallback((kind, key) => {
    setUsage(prev => {
      const bucket = kind === 'color' ? 'colors' : 'effects';
      const next = { ...prev, [bucket]: { ...prev[bucket], [key]: (prev[bucket]?.[key] ?? 0) + 1 } };
      try { localStorage.setItem(USAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const topColors  = Object.entries(usage.colors  ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k);
  const topEffects = Object.entries(usage.effects ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);

  return { bump, topColors, topEffects };
}

// ── Drag hook ─────────────────────────────────────────────────────────────────
// Pointer events, not HTML5 drag-and-drop: HTML5 drag never fires on touch, so
// this way one code path covers mouse, pen and finger. The drop target is
// resolved with elementFromPoint on release.
export function usePaletteDrag(onDrop) {
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);

  const startDrag = useCallback((e, payload) => {
    e.preventDefault();
    const d = { ...payload, x: e.clientX, y: e.clientY };
    dragRef.current = d;
    setDrag(d);
  }, []);

  useEffect(() => {
    if (!drag) return;

    function clearHot() {
      document.querySelectorAll('.drop-hot').forEach(n => n.classList.remove('drop-hot'));
    }

    function move(ev) {
      const d = { ...dragRef.current, x: ev.clientX, y: ev.clientY };
      dragRef.current = d;
      setDrag(d);
      clearHot();
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const target = el?.closest?.('[data-drop-step]');
      if (target && matches(target, dragRef.current)) target.classList.add('drop-hot');
    }

    function up(ev) {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const target = el?.closest?.('[data-drop-step]');
      clearHot();
      if (target && matches(target, dragRef.current)) {
        onDrop?.({
          payload: dragRef.current,
          stepId:  target.getAttribute('data-drop-step'),
          track:   target.getAttribute('data-drop-track'),
        });
      }
      dragRef.current = null;
      setDrag(null);
    }

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [drag, onDrop]);

  return { drag, startDrag };
}

// Colors only land on light tracks, effects only on the FX lane
function matches(target, payload) {
  const track = target.getAttribute('data-drop-track');
  if (!payload) return false;
  if (payload.kind === 'color')  return track === 'par' || track === 'spot';
  if (payload.kind === 'effect') return track === 'fx';
  return false;
}

// ── Floating ghost that follows the pointer ───────────────────────────────────
export function DragGhost({ drag }) {
  if (!drag) return null;
  return (
    <div
      className="drag-ghost"
      style={{
        left: drag.x, top: drag.y,
        background: drag.kind === 'color' ? drag.hex : 'var(--accent)',
        color: drag.kind === 'color' ? '#fff' : '#fff',
      }}
    >
      {drag.kind === 'effect' ? `${drag.icon} ${drag.label}` : drag.label}
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
export default function PaletteSidebar({
  startDrag, brightness, onBrightness, maxBrightness = 100,
  topColors = [], topEffects = [],
  onCopy, onPaste, canPaste, hasSelection,
  onUndo, onRedo, canUndo, canRedo,
}) {
  const b = Math.min(brightness, maxBrightness);

  const Swatch = ({ c }) => (
    <button
      className="swatch"
      style={{ background: c.hex }}
      onPointerDown={e => startDrag(e, { kind: 'color', key: c.key, label: c.label, hex: c.hex })}
      title={`${c.label} — drag onto a Par or Spot block`}
      type="button"
    />
  );

  const FxChip = ({ e }) => (
    <button
      className="fx-chip"
      onPointerDown={ev => startDrag(ev, { kind: 'effect', key: e.key, label: e.label, icon: e.icon })}
      title={`${e.label} — ${e.hint}. Drag onto the Effects row.`}
      type="button"
    >
      <span className="fx-chip-icon">{e.icon}</span>
      <span className="fx-chip-label">{e.label}</span>
    </button>
  );

  return (
    <aside className="editor-sidebar">
      {/* Frequently used */}
      {(topColors.length > 0 || topEffects.length > 0) && (
        <div className="side-section">
          <div className="side-title">Frequent</div>
          {topColors.length > 0 && (
            <div className="swatch-grid">
              {topColors.map(k => COLOR_META[k]).filter(Boolean).map(c => <Swatch key={c.key} c={c} />)}
            </div>
          )}
          {topEffects.length > 0 && (
            <div className="fx-grid">
              {topEffects.map(k => EFFECT_META[k]).filter(Boolean).map(e => <FxChip key={e.key} e={e} />)}
            </div>
          )}
        </div>
      )}

      {/* Brightness applies to whatever you drop next */}
      <div className="side-section">
        <div className="side-title">Brightness <span className="side-hint">for new drops</span></div>
        <div className="side-bright">
          <div className="side-bright-row">
            <input type="range" min={5} max={maxBrightness} value={b} onChange={e => onBrightness(+e.target.value)} />
            <span className="side-bright-val">{b}%</span>
          </div>
        </div>
      </div>

      {/* All colors */}
      <div className="side-section">
        <div className="side-title">Colors <span className="side-hint">drag out</span></div>
        <div className="swatch-grid">
          {COLORS.map(c => <Swatch key={c.key} c={c} />)}
        </div>
      </div>

      {/* Effects */}
      <div className="side-section">
        <div className="side-title">Effects <span className="side-hint">layer on top</span></div>
        <div className="fx-grid">
          {EFFECTS.map(e => <FxChip key={e.key} e={e} />)}
        </div>
      </div>

      {/* Edit tools */}
      <div className="side-section">
        <div className="side-title">Edit</div>
        <div className="side-tools">
          <button className="tool-btn" onClick={onUndo}  disabled={!canUndo} title="Undo (Ctrl+Z)">↶ Undo</button>
          <button className="tool-btn" onClick={onRedo}  disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">↷ Redo</button>
          <button className="tool-btn" onClick={onCopy}  disabled={!hasSelection} title="Copy color + effects (Ctrl+C)">⧉ Copy</button>
          <button className="tool-btn" onClick={onPaste} disabled={!canPaste || !hasSelection} title="Paste onto selected block (Ctrl+V)">⎘ Paste</button>
        </div>
      </div>
    </aside>
  );
}

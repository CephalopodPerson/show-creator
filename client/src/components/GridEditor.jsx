import React, { useState } from 'react';

// ── Palette ───────────────────────────────────────────────────────────────────
// Colours are stored at full value; the brightness field scales them.
export const COLORS = [
  { key: 'red',    label: 'Red',    hex: '#ff2222', par: { r: 255, g: 0,   b: 0,   w: 0,   a: 0,   uv: 0   }, spot: { r: 255, g: 0,   b: 0,   w: 0   } },
  { key: 'orange', label: 'Orange', hex: '#ff7700', par: { r: 255, g: 80,  b: 0,   w: 0,   a: 200, uv: 0   }, spot: { r: 255, g: 80,  b: 0,   w: 0   } },
  { key: 'amber',  label: 'Amber',  hex: '#ffb347', par: { r: 255, g: 140, b: 20,  w: 90,  a: 120, uv: 0   }, spot: { r: 255, g: 150, b: 40,  w: 70  } },
  { key: 'yellow', label: 'Yellow', hex: '#ffee00', par: { r: 255, g: 220, b: 0,   w: 0,   a: 100, uv: 0   }, spot: { r: 255, g: 220, b: 0,   w: 0   } },
  { key: 'green',  label: 'Green',  hex: '#22dd22', par: { r: 0,   g: 220, b: 0,   w: 0,   a: 0,   uv: 0   }, spot: { r: 0,   g: 220, b: 0,   w: 0   } },
  { key: 'cyan',   label: 'Cyan',   hex: '#00ccdd', par: { r: 0,   g: 200, b: 220, w: 0,   a: 0,   uv: 0   }, spot: { r: 0,   g: 200, b: 220, w: 0   } },
  { key: 'blue',   label: 'Blue',   hex: '#3366ff', par: { r: 0,   g: 60,  b: 255, w: 0,   a: 0,   uv: 0   }, spot: { r: 0,   g: 60,  b: 255, w: 0   } },
  { key: 'purple', label: 'Purple', hex: '#aa22ff', par: { r: 180, g: 0,   b: 255, w: 0,   a: 0,   uv: 0   }, spot: { r: 180, g: 0,   b: 255, w: 0   } },
  { key: 'pink',   label: 'Pink',   hex: '#ff44aa', par: { r: 255, g: 0,   b: 140, w: 0,   a: 0,   uv: 0   }, spot: { r: 255, g: 0,   b: 140, w: 0   } },
  { key: 'warm',   label: 'Warm',   hex: '#ffe0a0', par: { r: 255, g: 140, b: 20,  w: 255, a: 0,   uv: 0   }, spot: { r: 255, g: 160, b: 80,  w: 200 } },
  { key: 'cool',   label: 'Cool',   hex: '#cce8ff', par: { r: 180, g: 210, b: 255, w: 200, a: 0,   uv: 0   }, spot: { r: 180, g: 210, b: 255, w: 200 } },
  { key: 'uv',     label: 'UV',     hex: '#7700cc', par: { r: 0,   g: 0,   b: 0,   w: 0,   a: 0,   uv: 255 }, spot: { r: 40,  g: 0,   b: 100, w: 0   } },
  { key: 'off',    label: 'Off',    hex: '#15151c', par: { r: 0,   g: 0,   b: 0,   w: 0,   a: 0,   uv: 0   }, spot: { r: 0,   g: 0,   b: 0,   w: 0   } },
];

export const EFFECTS = [
  { key: 'fade',   label: 'Fade',   icon: '◐', hint: 'Ease into this section',   make: () => ({ type: 'fade',   direction: 'in', duration_s: 1.5 }) },
  { key: 'flash',  label: 'Flash',  icon: '✦', hint: 'Quick bursts of colour',   make: () => ({ type: 'flash',  at: 0, duration_s: 0.15, repeat: 3, gap_s: 0.35 }) },
  { key: 'pulse',  label: 'Pulse',  icon: '◉', hint: 'Rhythmic breathing',       make: () => ({ type: 'pulse',  rate_hz: 2, depth: 0.5 }) },
  { key: 'strobe', label: 'Strobe', icon: '⚡', hint: 'Hard strobe on the pars',  make: () => ({ type: 'strobe', value: 200 }) },
];

const EFFECT_META = Object.fromEntries(EFFECTS.map(e => [e.key, e]));

function fmt(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function swatch(c, brightness = 100) {
  if (!c) return '#15151c';
  const f   = brightness / 100;
  const lum = (c.w ?? 0) * 0.3 + (c.a ?? 0) * 0.15;
  const r = Math.min(255, ((c.r ?? 0) + lum) * f);
  const g = Math.min(255, ((c.g ?? 0) + lum * 0.75) * f);
  const b = Math.min(255, ((c.b ?? 0) + lum * 0.5 + (c.uv ?? 0) * 0.6) * f);
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

// Read the base colour off a step, tolerating the legacy flat shape
function stepPar(s)  { return s.color?.par  ?? s.par  ?? null; }
function stepSpot(s) { return s.color?.spot ?? s.spot ?? null; }

export default function GridEditor({ steps, onUpdateSteps, onSelectStep, selectedId, currentTime, onSeek, maxBrightness = 100 }) {
  // The "armed" palette item — tap it, then tap cells to paint.
  // This works identically with mouse and touch, unlike HTML5 drag.
  const [armed, setArmed] = useState(null);   // { kind:'color'|'effect', key }
  const [brightness, setBrightness] = useState(50);

  const sorted = [...steps].sort((a, b) => a.time_s - b.time_s);

  function patch(id, changes) {
    onUpdateSteps(steps.map(s => s.id === id ? { ...s, ...changes } : s));
  }

  function applyToCell(step, row) {
    if (!armed) { onSelectStep(step.id); return; }

    if (armed.kind === 'color' && (row === 'par' || row === 'spot')) {
      const c   = COLORS.find(x => x.key === armed.key);
      const cur = { par: stepPar(step), spot: stepSpot(step) };
      const next = {
        ...cur,
        [row]: { ...c[row], brightness: Math.min(maxBrightness, brightness) },
      };
      // Migrate to the layered shape while clearing the legacy fields
      patch(step.id, { color: next, par: undefined, spot: undefined });
      return;
    }

    if (armed.kind === 'effect' && row === 'fx') {
      const meta = EFFECT_META[armed.key];
      const cur  = Array.isArray(step.effects) ? step.effects : [];
      // One of each type per step — re-tapping removes it (toggle)
      const has  = cur.some(e => e.type === armed.key);
      const next = has ? cur.filter(e => e.type !== armed.key) : [...cur, meta.make()];
      patch(step.id, { effects: next });
    }
  }

  function removeEffect(step, type) {
    patch(step.id, { effects: (step.effects ?? []).filter(e => e.type !== type) });
  }

  function splitStep(step) {
    const half = step.duration_s / 2;
    if (half < 0.5) return;
    const a = { ...step, duration_s: parseFloat(half.toFixed(2)) };
    const b = {
      ...step,
      id: crypto.randomUUID(),
      time_s: parseFloat((step.time_s + half).toFixed(2)),
      duration_s: parseFloat(half.toFixed(2)),
      memo: '',
    };
    onUpdateSteps([...steps.filter(s => s.id !== step.id), a, b].sort((x, y) => x.time_s - y.time_s));
  }

  function mergeWithNext(step) {
    const idx  = sorted.findIndex(s => s.id === step.id);
    const next = sorted[idx + 1];
    if (!next) return;
    const merged = { ...step, duration_s: parseFloat((step.duration_s + next.duration_s).toFixed(2)) };
    onUpdateSteps(steps.filter(s => s.id !== step.id && s.id !== next.id).concat(merged).sort((x, y) => x.time_s - y.time_s));
  }

  return (
    <div className="grid-editor">

      {/* ── Palette ── */}
      <div className="palette">
        <div className="palette-group">
          <div className="palette-label">
            Colours
            <span className="palette-hint">{armed ? 'now tap a cell' : 'tap one, then tap a cell'}</span>
          </div>
          <div className="palette-chips">
            {COLORS.map(c => (
              <button
                key={c.key}
                className={`chip chip-color${armed?.kind === 'color' && armed.key === c.key ? ' chip-armed' : ''}`}
                style={{ background: c.hex }}
                onClick={() => setArmed(a => (a?.kind === 'color' && a.key === c.key) ? null : { kind: 'color', key: c.key })}
                title={c.label}
              >
                <span className="chip-label">{c.label}</span>
              </button>
            ))}
          </div>
          <div className="palette-bright">
            <span>Brightness</span>
            <input
              type="range" min={5} max={maxBrightness} value={Math.min(brightness, maxBrightness)}
              onChange={e => setBrightness(+e.target.value)}
            />
            <span className="palette-bright-val">{Math.min(brightness, maxBrightness)}%</span>
          </div>
        </div>

        <div className="palette-group">
          <div className="palette-label">Effects<span className="palette-hint">layer on top of colour</span></div>
          <div className="palette-chips">
            {EFFECTS.map(e => (
              <button
                key={e.key}
                className={`chip chip-effect${armed?.kind === 'effect' && armed.key === e.key ? ' chip-armed' : ''}`}
                onClick={() => setArmed(a => (a?.kind === 'effect' && a.key === e.key) ? null : { kind: 'effect', key: e.key })}
                title={e.hint}
              >
                <span className="chip-icon">{e.icon}</span>
                <span className="chip-label">{e.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Grid ── */}
      <div className="grid-scroll">
        <div className="grid-rows">
          {/* Header row: section times */}
          <div className="grid-row grid-row-head">
            <div className="grid-rowlabel" />
            {sorted.map((s, i) => {
              const isNow = currentTime >= s.time_s && currentTime < s.time_s + s.duration_s;
              return (
                <div
                  key={s.id}
                  className={`grid-head${isNow ? ' grid-head-now' : ''}${s.id === selectedId ? ' grid-head-sel' : ''}`}
                  onClick={() => { onSelectStep(s.id); onSeek?.(s.time_s); }}
                >
                  <span className="grid-head-num">{i + 1}</span>
                  <span className="grid-head-time">{fmt(s.time_s)}</span>
                  <span className="grid-head-dur">{s.duration_s.toFixed(1)}s</span>
                </div>
              );
            })}
          </div>

          {/* PAR row */}
          <div className="grid-row">
            <div className="grid-rowlabel">PAR<span className="grid-rowlabel-sub">wash</span></div>
            {sorted.map(s => (
              <button
                key={s.id}
                className={`grid-cell${s.id === selectedId ? ' grid-cell-sel' : ''}`}
                style={{ background: swatch(stepPar(s), stepPar(s)?.brightness ?? 100) }}
                onClick={() => applyToCell(s, 'par')}
                title={`Par — ${stepPar(s)?.brightness ?? 0}%`}
              />
            ))}
          </div>

          {/* SPOT row */}
          <div className="grid-row">
            <div className="grid-rowlabel">SPOT<span className="grid-rowlabel-sub">moving</span></div>
            {sorted.map(s => (
              <button
                key={s.id}
                className={`grid-cell${s.id === selectedId ? ' grid-cell-sel' : ''}`}
                style={{ background: swatch(stepSpot(s), stepSpot(s)?.brightness ?? 100) }}
                onClick={() => applyToCell(s, 'spot')}
                title={`Spot — ${stepSpot(s)?.brightness ?? 0}%`}
              />
            ))}
          </div>

          {/* FX row */}
          <div className="grid-row">
            <div className="grid-rowlabel">FX<span className="grid-rowlabel-sub">layers</span></div>
            {sorted.map(s => (
              <button
                key={s.id}
                className={`grid-cell grid-cell-fx${s.id === selectedId ? ' grid-cell-sel' : ''}`}
                onClick={() => applyToCell(s, 'fx')}
              >
                {(s.effects ?? []).map(e => (
                  <span
                    key={e.type}
                    className="fx-badge"
                    title={`${EFFECT_META[e.type]?.label ?? e.type} — click to remove`}
                    onClick={ev => { ev.stopPropagation(); removeEffect(s, e.type); }}
                  >{EFFECT_META[e.type]?.icon ?? '?'}</span>
                ))}
                {(s.effects ?? []).length === 0 && <span className="fx-empty">+</span>}
              </button>
            ))}
          </div>

          {/* Section tools */}
          <div className="grid-row grid-row-tools">
            <div className="grid-rowlabel" />
            {sorted.map((s, i) => (
              <div key={s.id} className="grid-tools">
                <button className="grid-tool" title="Split this section in half" onClick={() => splitStep(s)}>⇥</button>
                <button className="grid-tool" title="Merge with the next section" disabled={i === sorted.length - 1} onClick={() => mergeWithNext(s)}>⇤</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {sorted.length === 0 && (
        <p className="muted grid-empty">No sections yet — run the 🪄 Wizard to build them from the song.</p>
      )}
    </div>
  );
}

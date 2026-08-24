import React, { useRef, useState, useEffect } from 'react';

// ── XY pad, GarageBand Drummer style ──────────────────────────────────────────
// Both axes describe *behavior*, never color — color is an explicit palette
// choice below the pad. That separation is the whole point: you can run the same
// palette chill or hype without repicking colors.
//
//   Y: 0 = Chill  (dim, restrained, few changes)  →  1 = Hype (bright, saturated, busy)
//   X: 0 = Smooth (long crossfades, slow drifts)  →  1 = Punchy (hard cuts, flashes, strobe)

export const ZONES = [
  { key: 'ambient',  label: 'Ambient',   x: 0.17, y: 0.16 },
  { key: 'lounge',   label: 'Lounge',    x: 0.18, y: 0.50 },
  { key: 'groove',   label: 'Groove',    x: 0.50, y: 0.50 },
  { key: 'accent',   label: 'Accent',    x: 0.82, y: 0.20 },
  { key: 'anthem',   label: 'Anthem',    x: 0.50, y: 0.86 },
  { key: 'peaktime', label: 'Peak Time', x: 0.85, y: 0.85 },
];

// ── Palettes: explicit color choice, independent of the pad ──
export const PALETTES = {
  ember:   { label: 'Ember',   colors: [
    { par: { r: 255, g: 70,  b: 0,   w: 40,  a: 140, uv: 0  }, spot: { r: 255, g: 90,  b: 10,  w: 30  } },
    { par: { r: 200, g: 0,   b: 30,  w: 0,   a: 60,  uv: 0  }, spot: { r: 220, g: 0,   b: 40,  w: 0   } },
    { par: { r: 255, g: 150, b: 30,  w: 120, a: 180, uv: 0  }, spot: { r: 255, g: 165, b: 55,  w: 100 } },
    { par: { r: 150, g: 20,  b: 60,  w: 0,   a: 20,  uv: 20 }, spot: { r: 170, g: 25,  b: 70,  w: 0   } },
  ]},
  midnight:{ label: 'Midnight', colors: [
    { par: { r: 0,   g: 40,  b: 220, w: 0,  a: 0, uv: 40 }, spot: { r: 10,  g: 60,  b: 235, w: 0 } },
    { par: { r: 110, g: 0,   b: 235, w: 0,  a: 0, uv: 70 }, spot: { r: 125, g: 0,   b: 245, w: 0 } },
    { par: { r: 0,   g: 150, b: 200, w: 0,  a: 0, uv: 0  }, spot: { r: 0,   g: 165, b: 215, w: 0 } },
    { par: { r: 40,  g: 0,   b: 130, w: 0,  a: 0, uv: 90 }, spot: { r: 50,  g: 0,   b: 145, w: 0 } },
  ]},
  neon:    { label: 'Neon', colors: [
    { par: { r: 255, g: 0,   b: 140, w: 0, a: 0, uv: 0  }, spot: { r: 255, g: 0,   b: 150, w: 0 } },
    { par: { r: 0,   g: 230, b: 200, w: 0, a: 0, uv: 0  }, spot: { r: 0,   g: 240, b: 210, w: 0 } },
    { par: { r: 180, g: 0,   b: 255, w: 0, a: 0, uv: 50 }, spot: { r: 190, g: 0,   b: 255, w: 0 } },
    { par: { r: 240, g: 240, b: 0,   w: 0, a: 90,uv: 0  }, spot: { r: 250, g: 250, b: 20,  w: 0 } },
  ]},
  candle:  { label: 'Candle', colors: [
    { par: { r: 255, g: 130, b: 30,  w: 180, a: 200, uv: 0 }, spot: { r: 255, g: 145, b: 50, w: 150 } },
    { par: { r: 235, g: 100, b: 10,  w: 130, a: 160, uv: 0 }, spot: { r: 245, g: 115, b: 25, w: 110 } },
    { par: { r: 255, g: 165, b: 70,  w: 220, a: 120, uv: 0 }, spot: { r: 255, g: 175, b: 90, w: 190 } },
    { par: { r: 210, g: 80,  b: 0,   w: 100, a: 220, uv: 0 }, spot: { r: 225, g: 95,  b: 5,  w: 85  } },
  ]},
  spectrum:{ label: 'Spectrum', colors: [
    { par: { r: 255, g: 20,  b: 0,   w: 0, a: 0, uv: 0 }, spot: { r: 255, g: 30,  b: 0,   w: 0 } },
    { par: { r: 255, g: 170, b: 0,   w: 0, a: 90,uv: 0 }, spot: { r: 255, g: 180, b: 10,  w: 0 } },
    { par: { r: 0,   g: 210, b: 60,  w: 0, a: 0, uv: 0 }, spot: { r: 0,   g: 220, b: 70,  w: 0 } },
    { par: { r: 0,   g: 90,  b: 245, w: 0, a: 0, uv: 0 }, spot: { r: 10,  g: 105, b: 250, w: 0 } },
    { par: { r: 170, g: 0,   b: 245, w: 0, a: 0, uv: 40}, spot: { r: 180, g: 0,   b: 250, w: 0 } },
  ]},
  mono:    { label: 'Mono', colors: [
    { par: { r: 190, g: 205, b: 235, w: 200, a: 0, uv: 0 }, spot: { r: 200, g: 215, b: 245, w: 180 } },
    { par: { r: 130, g: 150, b: 195, w: 120, a: 0, uv: 0 }, spot: { r: 140, g: 160, b: 205, w: 100 } },
    { par: { r: 225, g: 232, b: 250, w: 245, a: 0, uv: 0 }, spot: { r: 235, g: 240, b: 255, w: 225 } },
  ]},
};

/**
 * Turn a pad position + palette into concrete generation settings.
 * Exported so the pad preview and the generator can never drift apart.
 */
export function padToSettings(x, y, paletteKey = 'ember', maxBrightness = 100) {
  // ── Y: energy ──
  const brightness = Math.min(maxBrightness, Math.round(24 + y * 40));   // 24% → 64%
  const satBoost   = 0.75 + y * 0.25;                                    // washed → saturated
  const threshold  = 1.58 - y * 0.44;                                    // 1.58 → 1.14 (how big a change must be)

  // ── X: transition character ──
  const fadeDur    = +(2.2 - x * 2.05).toFixed(2);                       // 2.2s crossfade → 0.15s snap
  const targetGap  = Math.round(20 - y * 11 - x * 5);                    // both axes shorten sections
  const punch      = x;                                                  // drives flash/strobe likelihood

  const pal = (PALETTES[paletteKey] ?? PALETTES.ember).colors;
  const palette = pal.map(p => ({
    par:  { ...scale(p.par,  satBoost), strobe: 0, brightness },
    spot: { ...scale(p.spot, satBoost),            brightness },
  }));

  return { brightness, threshold, fadeDur, targetGap: Math.max(3, targetGap), punch, palette, x, y };
}

function scale(c, f) {
  const out = {};
  for (const k of ['r', 'g', 'b', 'w', 'a', 'uv']) out[k] = Math.min(255, Math.round((c[k] ?? 0) * f));
  return out;
}

/** Nearest named zone, for the readout. */
export function zoneLabel(x, y) {
  let best = ZONES[0], bestD = Infinity;
  for (const z of ZONES) {
    const d = (z.x - x) ** 2 + (z.y - y) ** 2;
    if (d < bestD) { bestD = d; best = z; }
  }
  return best.label;
}

export function swatchCss(c) {
  const s = (c.brightness ?? 100) / 100;
  const lum = (c.w ?? 0) * 0.4 + (c.a ?? 0) * 0.2;
  return `rgb(${Math.min(255, Math.round((c.r + lum) * s))},${Math.min(255, Math.round((c.g + lum * 0.75) * s))},${Math.min(255, Math.round((c.b + lum * 0.5 + (c.uv ?? 0) * 0.6) * s))})`;
}

export default function WizardPad({ x, y, paletteKey, onChange, onPalette, maxBrightness = 100 }) {
  const ref = useRef(null);
  const [dragging, setDragging] = useState(false);

  function posFromEvent(e) {
    const r = ref.current.getBoundingClientRect();
    const nx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    // Invert Y so up = more intense, matching the axis label
    const ny = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    return { nx, ny };
  }

  function down(e) {
    e.preventDefault();
    setDragging(true);
    const { nx, ny } = posFromEvent(e);
    onChange(nx, ny);
  }

  useEffect(() => {
    if (!dragging) return;
    const move = e => { const { nx, ny } = posFromEvent(e); onChange(nx, ny); };
    const up   = () => setDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [dragging, onChange]);

  const cfg = padToSettings(x, y, paletteKey, maxBrightness);
  const swatches = cfg.palette.map(p => swatchCss(p.par));

  return (
    <div className="wizpad-wrap">
      <div
        className="wizpad"
        ref={ref}
        onPointerDown={down}
        role="slider"
        aria-label="Energy and transition character"
        tabIndex={0}
        onKeyDown={e => {
          const s = e.shiftKey ? 0.1 : 0.02;
          if (e.key === 'ArrowLeft')  { e.preventDefault(); onChange(Math.max(0, x - s), y); }
          if (e.key === 'ArrowRight') { e.preventDefault(); onChange(Math.min(1, x + s), y); }
          if (e.key === 'ArrowUp')    { e.preventDefault(); onChange(x, Math.min(1, y + s)); }
          if (e.key === 'ArrowDown')  { e.preventDefault(); onChange(x, Math.max(0, y - s)); }
        }}
      >
        <div className="wizpad-grid" />
        {ZONES.map(z => (
          <span key={z.key} className="wizpad-zone" style={{ left: `${z.x * 100}%`, bottom: `${z.y * 100}%` }}>
            {z.label}
          </span>
        ))}
        <div
          className={`wizpad-puck${dragging ? ' wizpad-puck-drag' : ''}`}
          style={{ left: `${x * 100}%`, bottom: `${y * 100}%`, background: swatches[0] }}
        />
        <span className="wizpad-axis wizpad-axis-y">Chill → Hype</span>
        <span className="wizpad-axis wizpad-axis-x">Smooth → Punchy</span>
      </div>

      <div className="wizpad-readout">
        <span className="wizpad-zonename">{zoneLabel(x, y)}</span>
        <span className="wizpad-stat">~{cfg.targetGap}s sections</span>
        <span className="wizpad-stat">{cfg.brightness}% bright</span>
        <span className="wizpad-stat">{cfg.fadeDur}s fades</span>
        <span className="wizpad-stat">{cfg.punch > 0.66 ? 'flashes' : cfg.punch > 0.33 ? 'pulses' : 'smooth'}</span>
      </div>

      <div>
        <div className="side-title" style={{ marginBottom: 7 }}>Palette</div>
        <div className="wizpad-palettes">
          {Object.entries(PALETTES).map(([key, p]) => (
            <button
              key={key}
              className={`pal-btn${paletteKey === key ? ' pal-btn-active' : ''}`}
              onClick={() => onPalette(key)}
              type="button"
            >
              <span className="pal-dots">
                {p.colors.slice(0, 4).map((c, i) => (
                  <span key={i} className="pal-dot" style={{ background: swatchCss({ ...c.par, brightness: 100 }) }} />
                ))}
              </span>
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

import React from 'react';

// ── Helpers ───────────────────────────────────────────────────────────────────
function rgbToHex(r = 0, g = 0, b = 0) {
  return '#' + [r, g, b].map(v => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16) || 0,
    g: parseInt(hex.slice(3, 5), 16) || 0,
    b: parseInt(hex.slice(5, 7), 16) || 0,
  };
}

// ── Reusable channel slider ───────────────────────────────────────────────────
function ChanSlider({ label, value, max = 255, onChange, color, disabled }) {
  return (
    <label className={`chan-row${disabled ? ' chan-disabled' : ''}`}>
      <span className="chan-label" style={{ color: disabled ? '#444' : (color ?? '#ccc') }}>{label}</span>
      <input
        type="range" min={0} max={max} value={value ?? 0}
        onChange={e => onChange(parseInt(e.target.value))}
        className="chan-slider"
        style={{ accentColor: disabled ? '#333' : (color ?? '#4a9eff') }}
        disabled={disabled}
      />
      <input
        type="number" min={0} max={max} value={value ?? 0}
        onChange={e => onChange(Math.max(0, Math.min(max, parseInt(e.target.value) || 0)))}
        className="chan-num"
        disabled={disabled}
      />
    </label>
  );
}

// ── Seconds text input ─────────────────────────────────────────────────────────
function SecInput({ label, value, onChange, tooltip }) {
  return (
    <label className="sec-row" title={tooltip}>
      <span className="sec-label">{label}</span>
      <input
        type="number" min={0} step={0.1} value={value ?? 0}
        onChange={e => onChange(Math.max(0, parseFloat(e.target.value) || 0))}
        className="sec-input"
      />
      <span className="sec-unit">s</span>
    </label>
  );
}

// ── Track enable toggle ───────────────────────────────────────────────────────
function TrackToggle({ enabled, onToggle }) {
  return (
    <button
      className={`track-toggle${enabled ? ' track-toggle-on' : ' track-toggle-off'}`}
      onClick={onToggle}
      title={enabled ? 'Click to disable this track for this step' : 'Click to enable this track for this step'}
    >
      {enabled ? 'ON' : 'OFF'}
    </button>
  );
}

// ── Color picker row ──────────────────────────────────────────────────────────
function ColorPickerRow({ r = 0, g = 0, b = 0, onChange, disabled }) {
  const hex = rgbToHex(r, g, b);
  return (
    <div className={`color-picker-row${disabled ? ' chan-disabled' : ''}`}>
      <span className="chan-label" style={{ color: disabled ? '#444' : '#ccc' }}>Color</span>
      <input
        type="color"
        value={hex}
        onChange={e => {
          const { r: nr, g: ng, b: nb } = hexToRgb(e.target.value);
          onChange(nr, ng, nb);
        }}
        className="color-picker-input"
        disabled={disabled}
        title="Pick a colour — updates R, G, B sliders"
      />
      <span className="color-picker-hex" style={{ color: disabled ? '#333' : '#666' }}>{hex.toUpperCase()}</span>
    </div>
  );
}

// ── Par / Spot colour preview swatch ──────────────────────────────────────────
function ColorSwatch({ r = 0, g = 0, b = 0, w = 0 }) {
  const lum = w * 0.4;
  return (
    <div className="color-swatch" style={{
      background: `rgb(${Math.min(255, r + lum)},${Math.min(255, g + lum)},${Math.min(255, b + lum)})`,
    }} />
  );
}

// ── Par controls ──────────────────────────────────────────────────────────────
function ParControls({ par, enabled, onToggle, onChange }) {
  const u = (k, v) => onChange({ par: { ...par, [k]: v } });
  const dis = !enabled;
  return (
    <div className={`control-section${dis ? ' section-disabled' : ''}`}>
      <div className="section-header">
        <ColorSwatch {...par} />
        <span>Par Lights</span>
        <span className="section-tip" title="Controls Par 1 & Par 2 wash lights simultaneously. RGBWAU + strobe + brightness.">?</span>
        <TrackToggle enabled={enabled} onToggle={onToggle} />
      </div>

      <ColorPickerRow
        r={par.r} g={par.g} b={par.b}
        onChange={(r, g, b) => onChange({ par: { ...par, r, g, b } })}
        disabled={dis}
      />

      <ChanSlider label="R"          value={par.r}          color="#ff4444" onChange={v => u('r', v)}          disabled={dis} />
      <ChanSlider label="G"          value={par.g}          color="#44ff44" onChange={v => u('g', v)}          disabled={dis} />
      <ChanSlider label="B"          value={par.b}          color="#4488ff" onChange={v => u('b', v)}          disabled={dis} />
      <ChanSlider label="W"          value={par.w}          color="#ffffcc" onChange={v => u('w', v)}          disabled={dis} />
      <ChanSlider label="A"          value={par.a}          color="#ffaa22" onChange={v => u('a', v)}          disabled={dis} />
      <ChanSlider label="UV"         value={par.uv}         color="#cc44ff" onChange={v => u('uv', v)}         disabled={dis} />
      <ChanSlider label="Strobe"     value={par.strobe}     color="#ffffff" onChange={v => u('strobe', v)}     disabled={dis} />
      <ChanSlider label="Brightness" value={par.brightness} max={100} color="#aaaaaa" onChange={v => u('brightness', v)} disabled={dis} />
    </div>
  );
}

// ── Spot controls ─────────────────────────────────────────────────────────────
function SpotControls({ spot, enabled, onToggle, onChange }) {
  const u = (k, v) => onChange({ spot: { ...spot, [k]: v } });
  const dis = !enabled;
  return (
    <div className={`control-section${dis ? ' section-disabled' : ''}`}>
      <div className="section-header">
        <ColorSwatch {...spot} />
        <span>Spotlight</span>
        <span className="section-tip" title="Controls the moving head spotlight. Colour & intensity only — position is handled live by the operator.">?</span>
        <TrackToggle enabled={enabled} onToggle={onToggle} />
      </div>

      <ColorPickerRow
        r={spot.r} g={spot.g} b={spot.b}
        onChange={(r, g, b) => onChange({ spot: { ...spot, r, g, b } })}
        disabled={dis}
      />

      <ChanSlider label="R"          value={spot.r}          color="#ff4444" onChange={v => u('r', v)}          disabled={dis} />
      <ChanSlider label="G"          value={spot.g}          color="#44ff44" onChange={v => u('g', v)}          disabled={dis} />
      <ChanSlider label="B"          value={spot.b}          color="#4488ff" onChange={v => u('b', v)}          disabled={dis} />
      <ChanSlider label="W"          value={spot.w}          color="#ffffcc" onChange={v => u('w', v)}          disabled={dis} />
      <ChanSlider label="Brightness" value={spot.brightness} max={100} color="#aaaaaa" onChange={v => u('brightness', v)} disabled={dis} />
    </div>
  );
}

// ── Basic mode presets ────────────────────────────────────────────────────────
// Each preset stores base colour values at full brightness; brightness is applied on top.
const PRESETS = [
  { label: 'Red',        color: '#ff2222', par: { r: 255, g: 0,   b: 0,   w: 0,   a: 0,   uv: 0   }, spot: { r: 255, g: 0,   b: 0,   w: 0   } },
  { label: 'Orange',     color: '#ff7700', par: { r: 255, g: 80,  b: 0,   w: 0,   a: 200, uv: 0   }, spot: { r: 255, g: 80,  b: 0,   w: 0   } },
  { label: 'Yellow',     color: '#ffee00', par: { r: 255, g: 220, b: 0,   w: 0,   a: 100, uv: 0   }, spot: { r: 255, g: 220, b: 0,   w: 0   } },
  { label: 'Green',      color: '#22dd22', par: { r: 0,   g: 220, b: 0,   w: 0,   a: 0,   uv: 0   }, spot: { r: 0,   g: 220, b: 0,   w: 0   } },
  { label: 'Cyan',       color: '#00ccdd', par: { r: 0,   g: 200, b: 220, w: 0,   a: 0,   uv: 0   }, spot: { r: 0,   g: 200, b: 220, w: 0   } },
  { label: 'Blue',       color: '#3366ff', par: { r: 0,   g: 60,  b: 255, w: 0,   a: 0,   uv: 0   }, spot: { r: 0,   g: 60,  b: 255, w: 0   } },
  { label: 'Purple',     color: '#aa22ff', par: { r: 180, g: 0,   b: 255, w: 0,   a: 0,   uv: 0   }, spot: { r: 180, g: 0,   b: 255, w: 0   } },
  { label: 'Pink',       color: '#ff44aa', par: { r: 255, g: 0,   b: 140, w: 0,   a: 0,   uv: 0   }, spot: { r: 255, g: 0,   b: 140, w: 0   } },
  { label: 'Warm White', color: '#ffe0a0', par: { r: 255, g: 140, b: 20,  w: 255, a: 0,   uv: 0   }, spot: { r: 255, g: 160, b: 80,  w: 200 } },
  { label: 'Cool White', color: '#cce8ff', par: { r: 180, g: 210, b: 255, w: 200, a: 0,   uv: 0   }, spot: { r: 180, g: 210, b: 255, w: 200 } },
  { label: 'UV',         color: '#7700cc', par: { r: 0,   g: 0,   b: 0,   w: 0,   a: 0,   uv: 255 }, spot: { r: 40,  g: 0,   b: 100, w: 0   } },
];

// Scale a preset's colour values by a brightness factor (0–100) before applying
function applyBrightnessScale(colours, brightness) {
  const f = (brightness ?? 100) / 100;
  const scaled = {};
  for (const [k, v] of Object.entries(colours)) {
    scaled[k] = typeof v === 'number' ? Math.round(v * f) : v;
  }
  return scaled;
}

function PresetPicker({ step, onChange }) {
  const currentPreset = step._preset ?? null;
  const brightness    = step._brightness ?? 100;
  const strobe        = step.par?.strobe ?? 0;

  function applyPreset(idx) {
    const p   = PRESETS[idx];
    const par  = { ...applyBrightnessScale(p.par, brightness), strobe, brightness };
    const spot = { ...applyBrightnessScale(p.spot, brightness), brightness };
    onChange({ par, spot, _preset: idx, _brightness: brightness });
  }

  function changeBrightness(val) {
    const newBright = parseInt(val);
    if (currentPreset !== null) {
      const p    = PRESETS[currentPreset];
      const par  = { ...applyBrightnessScale(p.par, newBright), strobe, brightness: newBright };
      const spot = { ...applyBrightnessScale(p.spot, newBright), brightness: newBright };
      onChange({ par, spot, _brightness: newBright });
    } else {
      onChange({ _brightness: newBright });
    }
  }

  function changeStrobe(val) {
    const newStrobe = parseInt(val);
    onChange({ par: { ...(step.par ?? {}), strobe: newStrobe } });
  }

  return (
    <div className="preset-picker">

      {/* Row 1: colour swatches */}
      <div className="preset-section-label">Colour</div>
      <div className="preset-swatches">
        {PRESETS.map((p, i) => (
          <button
            key={i}
            className={`preset-swatch${currentPreset === i ? ' preset-swatch-active' : ''}`}
            style={{ background: p.color }}
            onClick={() => applyPreset(i)}
            title={p.label}
          ><span className="preset-swatch-label">{p.label}</span></button>
        ))}
      </div>

      {/* Row 2: Brightness + Strobe sliders */}
      <div className="preset-sliders">
        <div className="preset-slider-row">
          <span className="preset-bright-label">☀ Brightness</span>
          <input
            type="range" min={5} max={100} value={brightness}
            onChange={e => changeBrightness(e.target.value)}
            className="preset-bright-slider"
          />
          <span className="preset-bright-val">{brightness}%</span>
        </div>
        <div className="preset-slider-row">
          <span className="preset-bright-label">⚡ Strobe</span>
          <input
            type="range" min={0} max={255} value={strobe}
            onChange={e => changeStrobe(e.target.value)}
            className="preset-strobe-slider"
          />
          <span className="preset-bright-val">{strobe === 0 ? 'Off' : strobe}</span>
        </div>
      </div>

    </div>
  );
}

// ── Main StepPanel ─────────────────────────────────────────────────────────────
export default function StepPanel({ step, onChange, onDelete, mode = 'advanced' }) {
  const parEnabled  = step.parEnabled  !== false;   // default true
  const spotEnabled = step.spotEnabled !== false;   // default true

  const defaultPar  = { r: 255, g: 0,   b: 0,   w: 0, a: 0, uv: 0, strobe: 0, brightness: 100 };
  const defaultSpot = { r: 255, g: 255, b: 200, w: 0, brightness: 80 };

  return (
    <div className="step-panel">
      <div className="step-panel-header">
        <span className="step-panel-title">Step at {step.time_s}s</span>
        <button className="btn-delete-step" onClick={onDelete} title="Delete this step">Delete step</button>
      </div>

      {/* Timing */}
      <div className="timing-row">
        <SecInput label="Time"     value={step.time_s}     onChange={v => onChange({ time_s:     v })} tooltip="Start time from beginning of song" />
        <SecInput label="Duration" value={step.duration_s} onChange={v => onChange({ duration_s: v })} tooltip="How long this step holds before the next one" />
        <SecInput label="Fade in"  value={step.fade_in_s}  onChange={v => onChange({ fade_in_s:  v })} tooltip="Fade-in time in seconds (included in duration)" />
        <SecInput label="Fade out" value={step.fade_out_s} onChange={v => onChange({ fade_out_s: v })} tooltip="Fade-out time at the end of this step" />
      </div>

      {/* Memo */}
      <label className="memo-row">
        <span>Memo / operator note</span>
        <input
          className="text-input"
          value={step.memo ?? ''}
          onChange={e => onChange({ memo: e.target.value })}
          placeholder="Optional note for the operator…"
        />
      </label>

      {/* Light controls */}
      {mode === 'basic' ? (
        <PresetPicker step={step} onChange={onChange} />
      ) : (
        <div className="controls-grid">
          <ParControls
            par={step.par ?? defaultPar}
            enabled={parEnabled}
            onToggle={() => onChange({ parEnabled: !parEnabled })}
            onChange={onChange}
          />
          <SpotControls
            spot={step.spot ?? defaultSpot}
            enabled={spotEnabled}
            onToggle={() => onChange({ spotEnabled: !spotEnabled })}
            onChange={onChange}
          />
        </div>
      )}
    </div>
  );
}

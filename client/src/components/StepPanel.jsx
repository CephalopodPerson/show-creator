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
      <span className="chan-label" style={{ color: disabled ? 'var(--text-faint)' : (color ?? 'var(--text-dim)') }}>{label}</span>
      <input
        type="range" min={0} max={max} value={value ?? 0}
        onChange={e => onChange(parseInt(e.target.value))}
        className="chan-slider"
        style={{ accentColor: disabled ? 'var(--border-2)' : (color ?? 'var(--accent)') }}
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
      <span className="chan-label" style={{ color: disabled ? 'var(--text-faint)' : 'var(--text-dim)' }}>Color</span>
      <input
        type="color"
        value={hex}
        onChange={e => {
          const { r: nr, g: ng, b: nb } = hexToRgb(e.target.value);
          onChange(nr, ng, nb);
        }}
        className="color-picker-input"
        disabled={disabled}
        title="Pick a color — updates R, G, B sliders"
      />
      <span className="color-picker-hex">{hex.toUpperCase()}</span>
    </div>
  );
}

// ── Par / Spot color preview swatch ──────────────────────────────────────────
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

      <ChanSlider label="R"          value={par.r}          color="#dc2626" onChange={v => u('r', v)}          disabled={dis} />
      <ChanSlider label="G"          value={par.g}          color="#16a34a" onChange={v => u('g', v)}          disabled={dis} />
      <ChanSlider label="B"          value={par.b}          color="#2563eb" onChange={v => u('b', v)}          disabled={dis} />
      <ChanSlider label="W"          value={par.w}          color="#b8860b" onChange={v => u('w', v)}          disabled={dis} />
      <ChanSlider label="A"          value={par.a}          color="#d97706" onChange={v => u('a', v)}          disabled={dis} />
      <ChanSlider label="UV"         value={par.uv}         color="#9333ea" onChange={v => u('uv', v)}         disabled={dis} />
      <ChanSlider label="Strobe"     value={par.strobe}     color="var(--text-dim)" onChange={v => u('strobe', v)}     disabled={dis} />
      <ChanSlider label="Brightness" value={par.brightness} max={100} color="var(--text-dim)" onChange={v => u('brightness', v)} disabled={dis} />
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
        <span className="section-tip" title="Controls the moving head spotlight. Color & intensity only — position is handled live by the operator.">?</span>
        <TrackToggle enabled={enabled} onToggle={onToggle} />
      </div>

      <ColorPickerRow
        r={spot.r} g={spot.g} b={spot.b}
        onChange={(r, g, b) => onChange({ spot: { ...spot, r, g, b } })}
        disabled={dis}
      />

      <ChanSlider label="R"          value={spot.r}          color="#dc2626" onChange={v => u('r', v)}          disabled={dis} />
      <ChanSlider label="G"          value={spot.g}          color="#16a34a" onChange={v => u('g', v)}          disabled={dis} />
      <ChanSlider label="B"          value={spot.b}          color="#2563eb" onChange={v => u('b', v)}          disabled={dis} />
      <ChanSlider label="W"          value={spot.w}          color="#b8860b" onChange={v => u('w', v)}          disabled={dis} />
      <ChanSlider label="Brightness" value={spot.brightness} max={100} color="var(--text-dim)" onChange={v => u('brightness', v)} disabled={dis} />
    </div>
  );
}

// ── Main StepPanel ─────────────────────────────────────────────────────────────
export default function StepPanel({ step, onChange, onDelete }) {
  const parEnabled  = step.parEnabled  !== false;   // default true
  const spotEnabled = step.spotEnabled !== false;   // default true

  const defaultPar  = { r: 180, g: 60, b: 0,  w: 60, a: 40, uv: 0, strobe: 0, brightness: 45 };
  const defaultSpot = { r: 200, g: 80, b: 10, w: 50, brightness: 45 };

  // Steps may be in the layered shape ({ color: { par, spot } }) or the older
  // flat shape ({ par, spot }). Read from either; always write back layered.
  const curPar  = step.color?.par  ?? step.par  ?? defaultPar;
  const curSpot = step.color?.spot ?? step.spot ?? defaultSpot;

  function handleChange(patch) {
    if ('par' in patch || 'spot' in patch) {
      const nextColor = {
        par:  'par'  in patch ? patch.par  : curPar,
        spot: 'spot' in patch ? patch.spot : curSpot,
      };
      const { par, spot, ...rest } = patch;
      onChange({ ...rest, color: nextColor, par: undefined, spot: undefined });
    } else {
      onChange(patch);
    }
  }

  return (
    <div className="step-panel">
      <div className="step-panel-header">
        <span className="step-panel-title">Step at {step.time_s}s</span>
        <button className="btn-delete-step" onClick={onDelete} title="Delete this step">Delete step</button>
      </div>

      {/* Timing */}
      <div className="timing-row">
        <SecInput label="Time"     value={step.time_s}     onChange={v => handleChange({ time_s:     v })} tooltip="Start time from beginning of song" />
        <SecInput label="Duration" value={step.duration_s} onChange={v => handleChange({ duration_s: v })} tooltip="How long this step holds before the next one" />
        <SecInput label="Fade in"  value={step.fade_in_s}  onChange={v => handleChange({ fade_in_s:  v })} tooltip="Fade-in time in seconds (included in duration)" />
        <SecInput label="Fade out" value={step.fade_out_s} onChange={v => handleChange({ fade_out_s: v })} tooltip="Fade-out time at the end of this step" />
      </div>

      {/* Effect layers on this step */}
      {(step.effects ?? []).length > 0 && (
        <div className="steppanel-fx">
          <span className="steppanel-fx-label">Effect layers</span>
          {step.effects.map(e => (
            <span key={e.type} className="steppanel-fx-chip">
              {e.type}
              <button
                className="steppanel-fx-x"
                title="Remove this layer"
                onClick={() => handleChange({ effects: step.effects.filter(x => x.type !== e.type) })}
              >✕</button>
            </span>
          ))}
        </div>
      )}

      {/* Memo */}
      <label className="memo-row">
        <span>Memo / operator note</span>
        <input
          className="text-input"
          value={step.memo ?? ''}
          onChange={e => handleChange({ memo: e.target.value })}
          placeholder="Optional note for the operator…"
        />
      </label>

      {/* Light controls */}
      <div className="controls-grid">
        <ParControls
          par={curPar}
          enabled={parEnabled}
          onToggle={() => handleChange({ parEnabled: !parEnabled })}
          onChange={handleChange}
        />
        <SpotControls
          spot={curSpot}
          enabled={spotEnabled}
          onToggle={() => handleChange({ spotEnabled: !spotEnabled })}
          onChange={handleChange}
        />
      </div>
    </div>
  );
}

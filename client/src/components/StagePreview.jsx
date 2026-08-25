import React, { useMemo } from 'react';

// ── Stage light simulation ────────────────────────────────────────────────────
// Layout mirrors the real rig: two Par wash lights on either side, one moving
// head spot centered between them. Renders the state of whichever step is
// active at `time`, so it doubles as a scrubbable preview.

function rgbaFrom(c = {}, gain = 1) {
  const b   = (c.brightness ?? 100) / 100;
  const lum = (c.w ?? 0) * 0.35 + (c.a ?? 0) * 0.2;
  const r   = Math.min(255, (c.r ?? 0) + lum);
  const g   = Math.min(255, (c.g ?? 0) + lum * 0.75);
  const bl  = Math.min(255, (c.b ?? 0) + lum * 0.5 + (c.uv ?? 0) * 0.6);
  return { r, g: g, b: bl, alpha: Math.min(1, b * gain) };
}

function css({ r, g, b }, a) { return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`; }

function fmtT(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export default function StagePreview({
  steps = [], time = 0, playing = false,
  onTogglePlay, onSeek, duration = 0, big = false,
}) {
  const sortedSteps = useMemo(
    () => [...steps].sort((a, b) => a.time_s - b.time_s),
    [steps]
  );

  const active = useMemo(() =>
    sortedSteps.find(s => time >= s.time_s && time < s.time_s + s.duration_s)
      ?? sortedSteps.filter(s => s.time_s <= time).pop()
      ?? null,
  [sortedSteps, time]);

  const parOn  = active && active.parEnabled  !== false;
  const spotOn = active && active.spotEnabled !== false;

  // Supports both the layered shape (step.color.par) and the legacy flat one
  const rawPar  = active?.color?.par  ?? active?.par  ?? {};
  const rawSpot = active?.color?.spot ?? active?.spot ?? {};
  const par  = rgbaFrom(rawPar);
  const spot = rgbaFrom(rawSpot);

  const fx        = active?.effects ?? [];
  const strobeFx  = fx.find(e => e.type === 'strobe');
  const pulseFx   = fx.find(e => e.type === 'pulse');
  const strobe    = ((rawPar.strobe ?? 0) > 0 || !!strobeFx) && playing;

  // Fade-in progress within the current step, so the preview animates
  const intoStep = active ? time - active.time_s : 0;
  const fadeLayer = fx.find(e => e.type === 'fade');
  const fadeIn   = (fadeLayer && (fadeLayer.direction === 'in' || fadeLayer.direction === 'both'))
    ? (fadeLayer.duration_s ?? 1)
    : (active?.fade_in_s ?? 0);
  const fadeGain = fadeIn > 0 ? Math.min(1, intoStep / fadeIn) : 1;

  // Pulse modulates the preview so you can see the effect before exporting
  const pulseGain = (pulseFx && playing)
    ? 1 - (pulseFx.depth ?? 0.5) * (0.5 + 0.5 * Math.sin(intoStep * Math.PI * 2 * (pulseFx.rate_hz ?? 2)))
    : 1;

  const parA  = parOn  ? par.alpha  * fadeGain * pulseGain : 0;
  const spotA = spotOn ? spot.alpha * fadeGain * pulseGain : 0;

  return (
    <div className={`stage-preview${big ? " stage-preview-big" : ""}`}>
      <div className="stage-preview-label">
        Stage preview
        {playing && <span className="stage-live">● LIVE</span>}
        {active?.memo && <span className="stage-memo">{active.memo}</span>}
        <span className="stage-spacer" />
        {active && <span className="stage-section">Block {sortedSteps.indexOf(active) + 1} of {sortedSteps.length}</span>}
      </div>

      <div className={`stage-box${strobe ? ' stage-strobe' : ''}`}>
        {/* Ambient wash from both pars filling the room */}
        <div className="stage-ambient" style={{
          background: `radial-gradient(ellipse at 50% 120%, ${css(par, parA * 0.35)} 0%, transparent 70%)`,
        }} />

        {/* Left par beam */}
        <div className="stage-beam stage-beam-left" style={{
          background: `linear-gradient(to bottom right, ${css(par, parA * 0.55)} 0%, transparent 75%)`,
        }} />
        {/* Right par beam */}
        <div className="stage-beam stage-beam-right" style={{
          background: `linear-gradient(to bottom left, ${css(par, parA * 0.55)} 0%, transparent 75%)`,
        }} />

        {/* Center moving-head spot cone */}
        <div className="stage-spot-cone" style={{
          background: `linear-gradient(to bottom, ${css(spot, spotA * 0.75)} 0%, ${css(spot, spotA * 0.15)} 60%, transparent 100%)`,
        }} />
        {/* Pool of light on the floor under the spot */}
        <div className="stage-spot-pool" style={{
          background: `radial-gradient(ellipse, ${css(spot, spotA * 0.7)} 0%, transparent 70%)`,
        }} />

        {/* Fixture bodies */}
        <div className="fixture fixture-par fixture-par-left">
          <div className="fixture-lens" style={{ background: css(par, Math.max(0.08, parA)), boxShadow: parA > 0.05 ? `0 0 18px 4px ${css(par, parA * 0.8)}` : 'none' }} />
          <span className="fixture-tag">PAR L</span>
        </div>

        <div className="fixture fixture-spot">
          <div className="fixture-head" style={{ background: css(spot, Math.max(0.08, spotA)), boxShadow: spotA > 0.05 ? `0 0 22px 6px ${css(spot, spotA * 0.85)}` : 'none' }} />
          <span className="fixture-tag">SPOT</span>
        </div>

        <div className="fixture fixture-par fixture-par-right">
          <div className="fixture-lens" style={{ background: css(par, Math.max(0.08, parA)), boxShadow: parA > 0.05 ? `0 0 18px 4px ${css(par, parA * 0.8)}` : 'none' }} />
          <span className="fixture-tag">PAR R</span>
        </div>

        {/* Stage floor line */}
        <div className="stage-floor" />
      </div>

      {onTogglePlay && (
        <div className="stage-transport">
          <button className="stage-play" onClick={onTogglePlay} title={playing ? 'Pause' : 'Play'}>
            {playing ? '⏸' : '▶'}
          </button>
          <span className="stage-time">{fmtT(time)}</span>
          <div
            className="stage-scrub"
            onClick={e => {
              if (!duration || !onSeek) return;
              const r = e.currentTarget.getBoundingClientRect();
              onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration);
            }}
          >
            {/* Each block tinted along the bar, so the shape of the show is
                readable at a glance and you can seek straight to a section */}
            {duration > 0 && sortedSteps.map(st => {
              const c = st.color?.par ?? st.par ?? {};
              return (
                <div
                  key={st.id}
                  className={`stage-seg${st.id === active?.id ? ' stage-seg-on' : ''}${st.isFlash ? ' stage-seg-flash' : ''}`}
                  style={{
                    left:  `${(st.time_s / duration) * 100}%`,
                    width: `${Math.max(0.4, (st.duration_s / duration) * 100)}%`,
                    background: css(rgbaFrom(c), 0.85),
                  }}
                />
              );
            })}
            <div className="stage-scrub-head" style={{ left: duration ? `${(time / duration) * 100}%` : '0%' }} />
          </div>
          <span className="stage-time stage-time-dim">{fmtT(duration)}</span>
        </div>
      )}

      <div className="stage-readout">
        {active ? (
          <>
            <span className="stage-chip">
              <span className="stage-swatch" style={{ background: css(par, Math.max(0.15, parA)) }} />
              Par {parOn ? `${rawPar.brightness ?? 100}%` : 'off'}
            </span>
            <span className="stage-chip">
              <span className="stage-swatch" style={{ background: css(spot, Math.max(0.15, spotA)) }} />
              Spot {spotOn ? `${rawSpot.brightness ?? 100}%` : 'off'}
            </span>
            {fx.map(e => (
              <span key={e.type} className="stage-chip">
                {e.type === 'fade' ? '◐' : e.type === 'flash' ? '✦' : e.type === 'pulse' ? '◉' : '⚡'} {e.type}
              </span>
            ))}
            <span className="stage-chip stage-chip-dim">Step at {active.time_s}s · {active.duration_s}s</span>
          </>
        ) : (
          <span className="stage-chip stage-chip-dim">No step at this time</span>
        )}
      </div>
    </div>
  );
}

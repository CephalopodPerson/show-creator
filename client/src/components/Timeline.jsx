import React from 'react';
import { EFFECT_META } from './Palette';

// ── Layout constants (must match labels-col heights in SequenceEditor) ─────────
export const RULER_H = 24;
export const TRACK_H = 44;
export const FX_H    = 30;
export const MEMO_H  = 26;

const TRACKS = [
  { key: 'par',  label: 'Par Lights', h: TRACK_H, tip: 'Par wash lights — drop colors and effects straight onto a block' },
  { key: 'spot', label: 'Spotlight',  h: TRACK_H, tip: 'Moving head spot — color and intensity only, position stays live' },
  { key: 'memo', label: 'Memo',       h: MEMO_H,  tip: 'Operator note — visible in the timeline, not sent to lights' },
];

// Read colors off a step, tolerating the legacy flat shape
const stepPar  = s => s.color?.par  ?? s.par  ?? null;
const stepSpot = s => s.color?.spot ?? s.spot ?? null;

function cssFor(c) {
  if (!c) return 'off';
  const { r = 0, g = 0, b = 0, w = 0, a = 0, uv = 0, brightness = 100 } = c;
  const s   = brightness / 100;
  const lum = w * 0.4 + a * 0.2;
  return `rgb(${Math.min(255, Math.round((r + lum) * s))},${Math.min(255, Math.round((g + lum * 0.75) * s))},${Math.min(255, Math.round((b + lum * 0.5 + uv * 0.6) * s))})`;
}

function stepColor(step, trackKey) {
  if (trackKey === 'par')  return (stepPar(step)  && step.parEnabled  !== false) ? cssFor(stepPar(step))  : 'off';
  if (trackKey === 'spot') return (stepSpot(step) && step.spotEnabled !== false) ? cssFor(stepSpot(step)) : 'off';
  if (trackKey === 'memo') return step.memo ? '#2d3a4a' : null;
  return null;
}

function needsLightText(cssColor) {
  const m = cssColor?.match(/\d+/g);
  if (!m) return true;
  return (0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2]) < 130;
}

function hasStrobe(step, trackKey) {
  if (trackKey !== 'par' || step.parEnabled === false) return false;
  if ((stepPar(step)?.strobe ?? 0) > 0) return true;
  return (step.effects ?? []).some(e => e.type === 'strobe' && (!e.track || e.track === 'par'));
}

// ── Move drag with neighbor-clamping ──────────────────────────────────────────
function startMove(e, step, steps, pxPerSec, duration, onUpdateStep, onSelect, history) {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  e.preventDefault(); e.stopPropagation();
  onSelect(step.id);
  history?.begin();

  const sorted    = [...steps].sort((a, b) => a.time_s - b.time_s);
  const idx       = sorted.findIndex(s => s.id === step.id);
  const prevEnd   = idx > 0 ? sorted[idx - 1].time_s + sorted[idx - 1].duration_s : 0;
  const nextStart = idx < sorted.length - 1 ? sorted[idx + 1].time_s : duration;
  const origTime  = step.time_s;
  const origDur   = step.duration_s;
  const startX    = e.clientX;

  function onMove(ev) {
    const raw     = origTime + (ev.clientX - startX) / pxPerSec;
    const clamped = Math.max(prevEnd, Math.min(nextStart - origDur, raw));
    onUpdateStep(step.id, { time_s: parseFloat(clamped.toFixed(2)) });
  }
  function onUp() {
    history?.end();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// ── Resize drag — right edge of A moves with left edge of B (linked) ─────────
function startResize(e, step, steps, pxPerSec, duration, onUpdateStep, onUpdateSteps, history) {
  e.preventDefault(); e.stopPropagation();
  history?.begin();

  const sorted   = [...steps].sort((a, b) => a.time_s - b.time_s);
  const idx      = sorted.findIndex(s => s.id === step.id);
  const nextStep = idx < sorted.length - 1 ? sorted[idx + 1] : null;

  const fixedEnd = nextStep ? nextStep.time_s + nextStep.duration_s : duration;
  const maxDur   = fixedEnd - step.time_s - (nextStep ? 0.2 : 0);
  const origDur  = step.duration_s;
  const startX   = e.clientX;

  function onMove(ev) {
    const raw     = origDur + (ev.clientX - startX) / pxPerSec;
    const clamped = Math.max(0.2, Math.min(maxDur, raw));
    if (nextStep) {
      const newNextStart = parseFloat((step.time_s + clamped).toFixed(2));
      onUpdateSteps([
        { id: step.id,     patch: { duration_s: parseFloat(clamped.toFixed(2)) } },
        { id: nextStep.id, patch: { time_s: newNextStart, duration_s: parseFloat((fixedEnd - newNextStart).toFixed(2)) } },
      ]);
    } else {
      onUpdateStep(step.id, { duration_s: parseFloat(clamped.toFixed(2)) });
    }
  }
  function onUp() {
    history?.end();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// ── Timeline component ────────────────────────────────────────────────────────
export default function Timeline({
  steps, duration, pxPerSec, selectedId, onSelect,
  onUpdateStep, onUpdateSteps, onRemoveEffect, history,
}) {
  const totalWidth = pxPerSec * duration;

  const tickStep = duration > 180 ? 30 : duration > 60 ? 10 : 5;
  const ticks = [];
  for (let t = 0; t <= duration; t += tickStep) {
    const m   = Math.floor(t / 60);
    const sec = String(Math.floor(t % 60)).padStart(2, '0');
    ticks.push(
      <div key={t} className="tick" style={{ left: t * pxPerSec }}>
        <span className="tick-label">{m}:{sec}</span>
      </div>
    );
  }

  return (
    <div className="timeline-tracks" style={{ width: totalWidth }}>
      {/* Ruler */}
      <div className="time-ruler" style={{ height: RULER_H, width: totalWidth }}>{ticks}</div>

      {/* Track rows */}
      {TRACKS.map(tr => (
        <div
          key={tr.key}
          className="track-row"
          style={{ height: tr.h, width: totalWidth, position: 'relative' }}
          onClick={() => onSelect(null)}
        >
          {steps.map(step => {
            const left  = step.time_s * pxPerSec;
            const width = Math.max(16, step.duration_s * pxPerSec);
            const isSelected = step.id === selectedId;

            const color = stepColor(step, tr.key);
            if (color === null) return null;   // memo with no text → invisible

            const isOff    = color === 'off';
            const strobe   = !isOff && hasStrobe(step, tr.key);
            const lightTxt = !isOff && needsLightText(color);
            const h        = tr.h - 8;

            // Effects attached to this track (no track set = applies to both)
            const trackFx = (step.effects ?? []).filter(e => !e.track || e.track === tr.key);

            // Fade overlays, from either the legacy field or a fade layer
            const fadeLayer = trackFx.find(e => e.type === 'fade');
            const fIn  = fadeLayer && (fadeLayer.direction === 'in'  || fadeLayer.direction === 'both')
              ? fadeLayer.duration_s : step.fade_in_s;
            const fOut = fadeLayer && (fadeLayer.direction === 'out' || fadeLayer.direction === 'both')
              ? fadeLayer.duration_s : step.fade_out_s;
            const fadeInPx  = !isOff && fIn  > 0 ? Math.min(width * 0.45, fIn  * pxPerSec) : 0;
            const fadeOutPx = !isOff && fOut > 0 ? Math.min(width * 0.45, fOut * pxPerSec) : 0;

            const droppable = tr.key === 'par' || tr.key === 'spot';

            return (
              <div
                key={`${step.id}-${tr.key}`}
                className={[
                  'step-block',
                  isSelected  ? 'selected'    : '',
                  isOff       ? 'step-off'    : '',
                  strobe      ? 'step-strobe' : '',
                  step.isFlash ? 'step-flash' : '',
                ].filter(Boolean).join(' ')}
                style={{ left, top: 4, width, height: h, background: isOff ? 'transparent' : color }}
                {...(droppable ? { 'data-drop-step': step.id, 'data-drop-track': tr.key } : {})}
                onPointerDown={e => startMove(e, step, steps, pxPerSec, duration, onUpdateStep, onSelect, history)}
                onClick={e => { e.stopPropagation(); onSelect(step.id); }}
                title={`${tr.label} @ ${step.time_s}s — drag to move, right edge to resize, drop a color here`}
              >
                {isOff
                  ? <span className="block-off-label">OFF</span>
                  : <>
                      {fadeInPx  > 0 && <div className="step-fade-in"  style={{ width: fadeInPx  }} />}
                      {fadeOutPx > 0 && <div className="step-fade-out" style={{ width: fadeOutPx }} />}
                      {tr.key !== 'memo' && trackFx.length > 0 && (
                        <span className="block-fx">
                          {trackFx.map(e => (
                            <span
                              key={e.type}
                              className="fx-badge"
                              title={`${EFFECT_META[e.type]?.label ?? e.type} on ${tr.label} — click to remove`}
                              onPointerDown={ev => ev.stopPropagation()}
                              onClick={ev => { ev.stopPropagation(); onRemoveEffect?.(step.id, e.type, tr.key); }}
                            >{EFFECT_META[e.type]?.icon ?? '?'}</span>
                          ))}
                        </span>
                      )}
                      <span className="block-label" style={{ color: lightTxt ? '#fff' : '#111' }}>
                        {tr.key === 'memo' ? step.memo : (width > 54 ? `${step.duration_s.toFixed(1)}s` : '')}
                      </span>
                      <div
                        className="resize-handle"
                        onPointerDown={e => startResize(e, step, steps, pxPerSec, duration, onUpdateStep, onUpdateSteps, history)}
                        onClick={e => e.stopPropagation()}
                        title="Drag to resize"
                      />
                    </>
                }
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export { TRACKS };

import React from 'react';

// ── Layout constants (must match labels-col heights in SequenceEditor) ─────────
export const RULER_H = 24;
export const TRACK_H = 40;
export const MEMO_H  = 28;

const TRACKS = [
  { key: 'par',  label: 'Par Lights', tip: 'Par wash lights (RGBWAU + strobe)' },
  { key: 'spot', label: 'Spotlight',  tip: 'Moving head spotlight (colour & intensity only — position handled live)' },
  { key: 'memo', label: 'Memo',       tip: 'Operator note — visible in timeline, not sent to lights' },
];

// ── Block colour ───────────────────────────────────────────────────────────────
// Returns a CSS colour string, 'off', or null (memo with no text → hide entirely)
function stepColor(step, trackKey) {
  if (trackKey === 'par') {
    if (!step.par || step.parEnabled === false) return 'off';
    const { r=0, g=0, b=0, w=0, brightness=100 } = step.par;
    const s = brightness / 100;
    const lum = w * 0.4;
    return `rgb(${Math.min(255,Math.round((r+lum)*s))},${Math.min(255,Math.round((g+lum)*s))},${Math.min(255,Math.round((b+lum)*s))})`;
  }
  if (trackKey === 'spot') {
    if (!step.spot || step.spotEnabled === false) return 'off';
    const { r=0, g=0, b=0, w=0, brightness=100 } = step.spot;
    const s = brightness / 100;
    const lum = w * 0.4;
    return `rgb(${Math.min(255,Math.round((r+lum)*s))},${Math.min(255,Math.round((g+lum)*s))},${Math.min(255,Math.round((b+lum)*s))})`;
  }
  if (trackKey === 'memo') return step.memo ? '#2d3a4a' : null;
  return null;
}

function needsLightText(cssColor) {
  const m = cssColor?.match(/\d+/g);
  if (!m) return true;
  return (0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2]) < 130;
}

function hasStrobe(step, trackKey) {
  if (trackKey === 'par'  && step.parEnabled  !== false) return (step.par?.strobe  ?? 0) > 0;
  if (trackKey === 'spot' && step.spotEnabled !== false) return (step.spot?.strobe ?? 0) > 0;
  return false;
}

// ── Move drag with neighbour-clamping ─────────────────────────────────────────
function startMove(e, step, steps, pxPerSec, duration, onUpdateStep, onSelect) {
  e.preventDefault(); e.stopPropagation();
  onSelect(step.id);

  const sorted    = [...steps].sort((a, b) => a.time_s - b.time_s);
  const idx       = sorted.findIndex(s => s.id === step.id);
  const prevEnd   = idx > 0 ? sorted[idx-1].time_s + sorted[idx-1].duration_s : 0;
  const nextStart = idx < sorted.length - 1 ? sorted[idx+1].time_s : duration;
  const origTime  = step.time_s;
  const origDur   = step.duration_s;
  const startX    = e.clientX;

  function onMove(ev) {
    const raw     = origTime + (ev.clientX - startX) / pxPerSec;
    const clamped = Math.max(prevEnd, Math.min(nextStart - origDur, raw));
    onUpdateStep(step.id, { time_s: parseFloat(clamped.toFixed(2)) });
  }
  function onUp() { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

// ── Resize drag — right edge of A moves with left edge of B (linked) ─────────
function startResize(e, step, steps, pxPerSec, duration, onUpdateStep, onUpdateSteps) {
  e.preventDefault(); e.stopPropagation();

  const sorted   = [...steps].sort((a, b) => a.time_s - b.time_s);
  const idx      = sorted.findIndex(s => s.id === step.id);
  const nextStep = idx < sorted.length - 1 ? sorted[idx + 1] : null;

  // If there's a next step: combined [A+B] end stays fixed; clamp so B keeps ≥ 0.2s
  // If last step: simply clamp to song end
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
  function onUp() { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

// ── Timeline component ────────────────────────────────────────────────────────
export default function Timeline({ steps, duration, pxPerSec, selectedId, onSelect, onUpdateStep, onUpdateSteps }) {
  const totalWidth = pxPerSec * duration;

  // Ruler ticks
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

  const rowH = { par: TRACK_H, spot: TRACK_H, memo: MEMO_H };

  return (
    <div className="timeline-tracks" style={{ width: totalWidth }}>
      {/* Ruler */}
      <div className="time-ruler" style={{ height: RULER_H, width: totalWidth }}>
        {ticks}
      </div>

      {/* Track rows */}
      {TRACKS.map(tr => (
        <div
          key={tr.key}
          className="track-row"
          style={{ height: rowH[tr.key], width: totalWidth, position: 'relative' }}
          onClick={() => onSelect(null)}
        >
          {steps.map(step => {
            const color      = stepColor(step, tr.key);
            if (color === null) return null;  // memo track with no text → invisible

            const isOff      = color === 'off';
            const isSelected = step.id === selectedId;
            const strobe     = !isOff && hasStrobe(step, tr.key);
            const lightTxt   = !isOff && needsLightText(color);
            const left       = step.time_s * pxPerSec;
            const width      = Math.max(16, step.duration_s * pxPerSec);
            const h          = rowH[tr.key] - 8;

            // Fade overlays — clamped to 45% of block each so they can't overlap
            const fadeInPx  = !isOff && step.fade_in_s  > 0 ? Math.min(width * 0.45, step.fade_in_s  * pxPerSec) : 0;
            const fadeOutPx = !isOff && step.fade_out_s > 0 ? Math.min(width * 0.45, step.fade_out_s * pxPerSec) : 0;

            return (
              <div
                key={`${step.id}-${tr.key}`}
                className={[
                  'step-block',
                  isSelected ? 'selected'     : '',
                  isOff      ? 'step-off'     : '',
                  strobe     ? 'step-strobe'  : '',
                ].filter(Boolean).join(' ')}
                style={{
                  left,
                  top: 4,
                  width,
                  height: h,
                  background: isOff ? 'transparent' : color,
                }}
                onMouseDown={e => !isOff && startMove(e, step, steps, pxPerSec, duration, onUpdateStep, onSelect)}
                onClick={e => { e.stopPropagation(); onSelect(step.id); }}
                title={`${tr.label} @ ${step.time_s}s — ${isOff ? 'disabled' : 'drag to move, right edge to resize'}`}
              >
                {isOff
                  ? <span className="block-off-label">OFF</span>
                  : <>
                      {fadeInPx  > 0 && <div className="step-fade-in"  style={{ width: fadeInPx  }} />}
                      {fadeOutPx > 0 && <div className="step-fade-out" style={{ width: fadeOutPx }} />}
                      <span className="block-label" style={{ color: lightTxt ? '#fff' : '#111', position: 'relative', zIndex: 2 }}>
                        {tr.key === 'memo' ? step.memo : `${step.time_s}s`}
                      </span>
                      <div
                        className="resize-handle"
                        onMouseDown={e => startResize(e, step, steps, pxPerSec, duration, onUpdateStep, onUpdateSteps)}
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

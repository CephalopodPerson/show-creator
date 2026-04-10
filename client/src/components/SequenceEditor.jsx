import React, { useState, useEffect, useRef, useCallback } from 'react';
import WaveformPlayer from './WaveformPlayer';
import Timeline, { RULER_H, TRACK_H, MEMO_H } from './Timeline';
import StepPanel from './StepPanel';

// ── Constants ──────────────────────────────────────────────────────────────────
const WAVEFORM_H  = 88;
const DEBOUNCE_MS = 800;
const MIN_PX_SEC  = 2;    // never go below 2px/s no matter how wide the container
const ZOOM_STEPS  = [1, 1.5, 2, 3, 5, 8, 12];  // discrete zoom multipliers

function formatTime(s) {
  const m   = Math.floor(s / 60);
  const sec = String(Math.floor(s % 60)).padStart(2, '0');
  const ds  = Math.floor((s % 1) * 10);
  return `${m}:${sec}.${ds}`;
}

const TRACK_DEFS = [
  { key: 'par',  label: 'PAR',  tip: 'Par wash lights (RGBWAU + strobe)',                     h: TRACK_H },
  { key: 'spot', label: 'SPOT', tip: 'Moving head spotlight (colour only — position is live)', h: TRACK_H },
  { key: 'memo', label: 'MEMO', tip: 'Operator notes',                                          h: MEMO_H  },
];

export default function SequenceEditor({ sequence, showName, fixtures, onSave, mode = 'advanced' }) {
  const [steps,        setSteps]       = useState(sequence.steps ?? []);
  const [audioPath,    setAudioPath]   = useState(sequence.audioPath ?? null);
  const [audioDur,     setAudioDur]    = useState(sequence.audioDuration ?? 0);
  const [currentTime,  setCurrentTime] = useState(0);
  const [selectedStep, setSelectedStep] = useState(null);
  const [warnings,     setWarnings]    = useState([]);
  const [playing,      setPlaying]     = useState(false);
  const [zoomIdx,      setZoomIdx]     = useState(0);    // index into ZOOM_STEPS
  const [containerW,   setContainerW]  = useState(0);   // scroll-area pixel width

  // Audio analysis state
  const [analyzing,    setAnalyzing]   = useState(false);
  const [suggestions,  setSuggestions] = useState([]);   // array of { t, label }
  const [selSugg,      setSelSugg]     = useState(new Set());
  const [showAnalysis, setShowAnalysis] = useState(false);

  const saveTimer  = useRef(null);
  const scrollRef  = useRef(null);
  const wsRef      = useRef(null);

  const duration = audioDur || 300;

  // ── Measure scroll-area width so we can fit the song to it ─────────────────
  useEffect(() => {
    if (!scrollRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      setContainerW(entry.contentRect.width);
    });
    ro.observe(scrollRef.current);
    return () => ro.disconnect();
  }, []);

  // ── Derive pxPerSec: fit the whole song at zoom 1, multiply for higher zoom ─
  // base = containerW / duration (fill the visible area at 1×)
  // clamp to MIN_PX_SEC so very short shows don't get absurdly stretched
  const basePxSec = containerW > 0 ? containerW / duration : MIN_PX_SEC;
  const pxPerSec  = Math.max(MIN_PX_SEC, basePxSec * ZOOM_STEPS[zoomIdx]);
  const totalWidth = Math.round(pxPerSec * duration);

  // ── Zoom controls ───────────────────────────────────────────────────────────
  const zoomIn  = () => setZoomIdx(i => Math.min(i + 1, ZOOM_STEPS.length - 1));
  const zoomOut = () => setZoomIdx(i => Math.max(i - 1, 0));
  const zoomFit = () => setZoomIdx(0);

  // ── Auto-create full-song step when audio first loads ─────────────────────
  // Only fires when we had no steps (brand-new sequence).
  useEffect(() => {
    if (audioDur > 0 && steps.length === 0) {
      const s = {
        id:          crypto.randomUUID(),
        time_s:      0,
        duration_s:  parseFloat(audioDur.toFixed(2)),
        fade_in_s:   0,
        fade_out_s:  0,
        parEnabled:  true,
        spotEnabled: true,
        par:  { r: 200, g: 200, b: 200, w: 0, a: 0, uv: 0, strobe: 0, brightness: 80 },
        spot: { r: 255, g: 255, b: 200, w: 0, brightness: 80 },
        memo: '',
      };
      setSteps([s]);
      triggerSave([s]);
      setSelectedStep(s.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioDur]);

  // ── Auto-save (debounced) ───────────────────────────────────────────────────
  const triggerSave = useCallback((newSteps, newAudioPath) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      onSave({ ...sequence, steps: newSteps, audioPath: newAudioPath ?? audioPath });
    }, DEBOUNCE_MS);
  }, [sequence, audioPath, onSave]);

  function updateSteps(newSteps) {
    setSteps(newSteps);
    triggerSave(newSteps);
  }

  // ── Audio upload ────────────────────────────────────────────────────────────
  async function uploadAudio(e) {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('audio', file);
    const res  = await fetch(`/api/shows/${encodeURIComponent(showName)}/audio`, { method: 'POST', body: fd });
    const data = await res.json();
    setWarnings(data.warnings ?? []);
    setAudioPath(data.path);
    triggerSave(steps, data.path);
  }

  // ── Audio analysis: detect energy transitions and suggest splits ────────────
  async function analyzeAudio() {
    if (!audioPath || analyzing) return;
    setAnalyzing(true);
    setSuggestions([]);
    try {
      const res = await fetch(audioPath);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arrayBuf = await res.arrayBuffer();

      // Decode using OfflineAudioContext (mono downmix, full duration)
      const tmpCtx  = new (window.AudioContext || window.webkitAudioContext)();
      const decoded = await tmpCtx.decodeAudioData(arrayBuf);
      tmpCtx.close();

      const sr       = decoded.sampleRate;
      const WINDOW_S = 0.5;                          // analysis window in seconds
      const winSamp  = Math.round(WINDOW_S * sr);
      const numWin   = Math.ceil(decoded.length / winSamp);

      // Mix all channels to mono and compute RMS per window
      const numCh = decoded.numberOfChannels;
      const rms = [];
      for (let i = 0; i < numWin; i++) {
        const start = i * winSamp;
        const end   = Math.min(start + winSamp, decoded.length);
        let   sum   = 0;
        for (let ch = 0; ch < numCh; ch++) {
          const data = decoded.getChannelData(ch);
          for (let j = start; j < end; j++) sum += data[j] * data[j];
        }
        rms.push(Math.sqrt(sum / ((end - start) * numCh)));
      }

      // Smooth with 5-point average
      const smooth = rms.map((_, i) => {
        const lo = Math.max(0, i - 2), hi = Math.min(rms.length - 1, i + 2);
        const slice = rms.slice(lo, hi + 1);
        return slice.reduce((a, b) => a + b, 0) / slice.length;
      });

      // Find windows where energy jumps significantly vs. preceding 2 seconds
      const LOOK_BACK = Math.round(2 / WINDOW_S);   // windows in 2s
      const LOOK_AHEAD = Math.round(0.5 / WINDOW_S);
      const THRESHOLD  = 1.6;                        // 60% increase
      const MIN_GAP_S  = 4;                          // min seconds between suggestions
      const found = [];

      for (let i = LOOK_BACK; i < smooth.length - LOOK_AHEAD; i++) {
        const before = smooth.slice(i - LOOK_BACK, i).reduce((a, b) => a + b, 0) / LOOK_BACK;
        const after  = smooth.slice(i, i + LOOK_AHEAD).reduce((a, b) => a + b, 0) / LOOK_AHEAD;
        if (before > 0.0005 && after > before * THRESHOLD) {
          const t = parseFloat((i * WINDOW_S).toFixed(1));
          if (!found.find(f => Math.abs(f.t - t) < MIN_GAP_S)) {
            found.push({ t, energy: after });
          }
        }
      }

      // Sort by time, label by strength
      found.sort((a, b) => a.t - b.t);
      const labeled = found.map(f => ({
        t:     f.t,
        label: f.energy > 0.05 ? 'Big drop' : f.energy > 0.02 ? 'Energy rise' : 'Transition',
      }));

      setSuggestions(labeled);
      setSelSugg(new Set(labeled.map((_, i) => i)));  // pre-select all
      setShowAnalysis(true);
    } catch (err) {
      console.error('Audio analysis failed:', err);
      setWarnings(w => [...w, `Analysis failed: ${err.message}`]);
    }
    setAnalyzing(false);
  }

  // Apply selected suggestions as splits
  function applySuggestions() {
    let current = [...steps].sort((a, b) => a.time_s - b.time_s);
    const times  = suggestions
      .filter((_, i) => selSugg.has(i))
      .map(s => s.t)
      .sort((a, b) => a - b);

    for (const t of times) {
      const host = current.find(s => t > s.time_s + 0.1 && t < s.time_s + s.duration_s - 0.1);
      if (host) {
        const stepA = { ...host, duration_s: parseFloat((t - host.time_s).toFixed(2)) };
        const stepB = {
          ...host,
          id:         crypto.randomUUID(),
          time_s:     t,
          duration_s: parseFloat((host.time_s + host.duration_s - t).toFixed(2)),
          memo:       '',
        };
        current = current.map(s => s.id === host.id ? stepA : s);
        current.push(stepB);
        current.sort((a, b) => a.time_s - b.time_s);
      }
    }
    updateSteps(current);
    setShowAnalysis(false);
  }

  // ── Split the step under the playhead into two, or add in a gap ───────────
  function splitAtCursor() {
    const sorted = [...steps].sort((a, b) => a.time_s - b.time_s);
    const t      = parseFloat(currentTime.toFixed(2));

    // Case 1: cursor is inside an existing step — split it at t
    const host = sorted.find(s => t > s.time_s && t < s.time_s + s.duration_s);
    if (host) {
      const stepA = { ...host, duration_s: parseFloat((t - host.time_s).toFixed(2)) };
      const stepB = {
        ...host,
        id:         crypto.randomUUID(),
        time_s:     t,
        duration_s: parseFloat((host.time_s + host.duration_s - t).toFixed(2)),
        memo:       '',
      };
      const newSteps = sorted.map(s => s.id === host.id ? stepA : s);
      newSteps.push(stepB);
      updateSteps(newSteps.sort((a, b) => a.time_s - b.time_s));
      setSelectedStep(stepB.id);
      return;
    }

    // Case 2: cursor is in a gap — fill the gap with a new step
    const gapEnd  = sorted.find(s => s.time_s > t);
    const gapDur  = gapEnd ? gapEnd.time_s - t : Math.max(2, duration - t);
    if (gapDur < 0.2) return;
    const newStep = {
      id:          crypto.randomUUID(),
      time_s:      t,
      duration_s:  parseFloat(gapDur.toFixed(2)),
      fade_in_s:   0,
      fade_out_s:  0,
      parEnabled:  true,
      spotEnabled: true,
      par:  { r: 200, g: 200, b: 200, w: 0, a: 0, uv: 0, strobe: 0, brightness: 80 },
      spot: { r: 255, g: 255, b: 200, w: 0, brightness: 80 },
      memo: '',
    };
    updateSteps([...sorted, newStep].sort((a, b) => a.time_s - b.time_s));
    setSelectedStep(newStep.id);
  }

  // What the split button says depending on whether cursor is inside a step
  const splitLabel = (() => {
    const t    = currentTime;
    const host = steps.find(s => t > s.time_s && t < s.time_s + s.duration_s);
    return host ? `✂ Split at ${formatTime(t)}` : `＋ Add at ${formatTime(t)}`;
  })();

  // ── Step mutations ──────────────────────────────────────────────────────────
  function updateStep(id, patch) {
    updateSteps(steps.map(s => s.id === id ? { ...s, ...patch } : s).sort((a, b) => a.time_s - b.time_s));
  }
  // Update multiple steps atomically (e.g. linked resize of two adjacent steps)
  function updateMultipleSteps(patches) {
    const newSteps = steps.map(s => {
      const match = patches.find(p => p.id === s.id);
      return match ? { ...s, ...match.patch } : s;
    }).sort((a, b) => a.time_s - b.time_s);
    updateSteps(newSteps);
  }
  function deleteStep(id) {
    updateSteps(steps.filter(s => s.id !== id));
    if (selectedStep === id) setSelectedStep(null);
  }

  // ── Seek on click anywhere in scroll area ──────────────────────────────────
  function handleScrollAreaClick(e) {
    const el = scrollRef.current;
    if (!el) return;
    const x = e.clientX - el.getBoundingClientRect().left + el.scrollLeft;
    const t = Math.max(0, Math.min(duration, x / pxPerSec));
    setCurrentTime(t);
    wsRef.current?.seek(t / duration);
  }

  function togglePlay() { wsRef.current?.togglePlay(); }

  const selected = steps.find(s => s.id === selectedStep);

  return (
    <div className="sequence-editor">
      {/* ── Header ── */}
      <div className="seq-editor-header">
        <h2 className="seq-title">{sequence.name}</h2>

        {/* Zoom controls */}
        <div className="zoom-controls">
          <button className="zoom-btn" onClick={zoomOut} disabled={zoomIdx === 0} title="Zoom out">－</button>
          <button className="zoom-fit" onClick={zoomFit} title="Fit whole song in view">
            {ZOOM_STEPS[zoomIdx] === 1 ? 'Fit' : `${ZOOM_STEPS[zoomIdx]}×`}
          </button>
          <button className="zoom-btn" onClick={zoomIn} disabled={zoomIdx === ZOOM_STEPS.length - 1} title="Zoom in">＋</button>
        </div>

        <label className="btn-secondary file-btn">
          {audioPath ? '🎵 Change audio' : '🎵 Upload audio'}
          <input type="file" accept="audio/*" hidden onChange={uploadAudio} />
        </label>
        {audioPath && (
          <button
            className="btn-secondary"
            onClick={analyzeAudio}
            disabled={analyzing}
            title="Analyse the song for energy changes and suggest where to split sequences"
          >
            {analyzing ? '⏳ Analysing…' : '✨ Analyse'}
          </button>
        )}
        <button className="btn-primary" onClick={splitAtCursor}>
          {splitLabel}
        </button>
      </div>

      {/* ── Warnings ── */}
      {warnings.map((w, i) => <div key={i} className="warning-banner">⚠ {w}</div>)}

      {/* ── Combined timeline ── */}
      <div className="combined-timeline">

        {/* Fixed left column: play button + track labels */}
        <div className="labels-col">
          <div className="label-play-cell" style={{ height: WAVEFORM_H }}>
            <button className="play-btn" onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
              {playing ? '⏸' : '▶'}
            </button>
            <span className="time-display">{formatTime(currentTime)}</span>
          </div>
          <div className="label-ruler-spacer" style={{ height: RULER_H }} />
          {TRACK_DEFS.map(td => (
            <div key={td.key} className="track-label label-cell" style={{ height: td.h }}>
              <span>{td.label}</span>
              <span className="track-tip" title={td.tip}>?</span>
            </div>
          ))}
        </div>

        {/* Scrollable: waveform + ruler + tracks + playhead all in one scroll */}
        <div className="scroll-area" ref={scrollRef} onClick={handleScrollAreaClick}>
          <div className="scroll-inner" style={{ width: totalWidth }}>

            <WaveformPlayer
              ref={wsRef}
              src={audioPath ?? null}
              width={totalWidth}
              pxPerSec={pxPerSec}
              onTimeUpdate={setCurrentTime}
              onDuration={setAudioDur}
              onPlayingChange={setPlaying}
            />

            <Timeline
              steps={steps}
              duration={duration}
              pxPerSec={pxPerSec}
              selectedId={selectedStep}
              onSelect={setSelectedStep}
              onUpdateStep={updateStep}
              onUpdateSteps={updateMultipleSteps}
            />

            {/* Single playhead spanning waveform + all tracks */}
            <div className="unified-playhead" style={{ left: currentTime * pxPerSec }} />
          </div>
        </div>
      </div>

      {/* ── Step panel ── */}
      {selected && (
        <StepPanel
          step={selected}
          onChange={patch => updateStep(selected.id, patch)}
          onDelete={() => deleteStep(selected.id)}
          mode={mode}
        />
      )}

      {/* ── Audio analysis suggestions modal ── */}
      {showAnalysis && (
        <div className="modal-overlay" onClick={() => setShowAnalysis(false)}>
          <div className="modal-box analysis-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">✨ Suggested split points</span>
              <button className="modal-close" onClick={() => setShowAnalysis(false)}>✕</button>
            </div>

            {suggestions.length === 0 ? (
              <p className="analysis-empty">No significant energy changes detected — the song may be consistently energetic or quiet throughout.</p>
            ) : (
              <>
                <p className="analysis-hint">Select the transitions you'd like to use as split points. Each creates a new step.</p>
                <div className="analysis-list">
                  {suggestions.map((s, i) => (
                    <label key={i} className="analysis-item">
                      <input
                        type="checkbox"
                        checked={selSugg.has(i)}
                        onChange={() => {
                          const next = new Set(selSugg);
                          next.has(i) ? next.delete(i) : next.add(i);
                          setSelSugg(next);
                        }}
                      />
                      <span className="analysis-time">{formatTime(s.t)}</span>
                      <span className="analysis-tag">{s.label}</span>
                    </label>
                  ))}
                </div>
                <div className="analysis-actions">
                  <button className="btn-secondary" onClick={() => setSelSugg(new Set())}>None</button>
                  <button className="btn-secondary" onClick={() => setSelSugg(new Set(suggestions.map((_, i) => i)))}>All</button>
                  <button
                    className="btn-primary"
                    disabled={selSugg.size === 0}
                    onClick={applySuggestions}
                  >
                    Apply {selSugg.size} split{selSugg.size !== 1 ? 's' : ''}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

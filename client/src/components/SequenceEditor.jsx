import React, { useState, useEffect, useRef, useCallback } from 'react';
import WaveformPlayer from './WaveformPlayer';
import Timeline, { RULER_H, TRACK_H, MEMO_H } from './Timeline';
import StepPanel from './StepPanel';
import StagePreview from './StagePreview';
import GridEditor from './GridEditor';

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

// ── Vibe themes ────────────────────────────────────────────────────────────────
// Each vibe is a named palette of (par, spot) colour pairs that get cycled
// across steps when the user applies a vibe. Brightness is deliberately kept
// below 60% for all presets — bright white is almost never the right call.
const VIBES = {
  sexy: {
    label: '🌹 Sexy',
    desc:  'Deep reds, warm amber, slow purple — intimate and moody',
    steps: [
      { par: { r: 180, g: 0,  b: 0,   w: 0,   a: 0, uv: 0, strobe: 0, brightness: 45 }, spot: { r: 200, g: 0,  b: 0,   w: 0,   brightness: 45 } },
      { par: { r: 160, g: 20, b: 0,   w: 40,  a: 60, uv: 0, strobe: 0, brightness: 40 }, spot: { r: 180, g: 30, b: 0,   w: 30,  brightness: 40 } },
      { par: { r: 120, g: 0,  b: 80,  w: 0,   a: 0, uv: 0, strobe: 0, brightness: 50 }, spot: { r: 140, g: 0,  b: 90,  w: 0,   brightness: 50 } },
      { par: { r: 200, g: 10, b: 0,   w: 20,  a: 0, uv: 0, strobe: 0, brightness: 35 }, spot: { r: 220, g: 10, b: 0,   w: 10,  brightness: 35 } },
      { par: { r: 80,  g: 0,  b: 60,  w: 0,   a: 0, uv: 20, strobe: 0, brightness: 40 }, spot: { r: 100, g: 0,  b: 70,  w: 0,   brightness: 40 } },
    ],
  },
  fun: {
    label: '🎉 Fun',
    desc:  'Bold cycling colours — blues, pinks, greens, lively and bright',
    steps: [
      { par: { r: 0,   g: 80,  b: 255, w: 0,  a: 0, uv: 0, strobe: 0, brightness: 55 }, spot: { r: 0,   g: 80,  b: 255, w: 0,  brightness: 55 } },
      { par: { r: 255, g: 0,   b: 120, w: 0,  a: 0, uv: 0, strobe: 0, brightness: 55 }, spot: { r: 255, g: 0,   b: 120, w: 0,  brightness: 55 } },
      { par: { r: 0,   g: 200, b: 0,   w: 0,  a: 0, uv: 0, strobe: 0, brightness: 50 }, spot: { r: 0,   g: 200, b: 0,   w: 0,  brightness: 50 } },
      { par: { r: 255, g: 100, b: 0,   w: 0,  a: 0, uv: 0, strobe: 0, brightness: 55 }, spot: { r: 255, g: 100, b: 0,   w: 0,  brightness: 55 } },
      { par: { r: 120, g: 0,   b: 255, w: 0,  a: 0, uv: 0, strobe: 0, brightness: 55 }, spot: { r: 120, g: 0,   b: 255, w: 0,  brightness: 55 } },
      { par: { r: 0,   g: 200, b: 200, w: 0,  a: 0, uv: 0, strobe: 0, brightness: 50 }, spot: { r: 0,   g: 200, b: 200, w: 0,  brightness: 50 } },
    ],
  },
  dark: {
    label: '🖤 Dark',
    desc:  'Deep blues, purples, UV hints — dramatic and shadowy',
    steps: [
      { par: { r: 0,   g: 0,   b: 120, w: 0,  a: 0, uv: 30, strobe: 0, brightness: 30 }, spot: { r: 0,   g: 0,   b: 140, w: 0,  brightness: 30 } },
      { par: { r: 60,  g: 0,   b: 100, w: 0,  a: 0, uv: 40, strobe: 0, brightness: 25 }, spot: { r: 70,  g: 0,   b: 120, w: 0,  brightness: 25 } },
      { par: { r: 0,   g: 0,   b: 80,  w: 0,  a: 0, uv: 60, strobe: 0, brightness: 20 }, spot: { r: 20,  g: 0,   b: 80,  w: 0,  brightness: 20 } },
      { par: { r: 80,  g: 0,   b: 80,  w: 0,  a: 0, uv: 20, strobe: 0, brightness: 30 }, spot: { r: 90,  g: 0,   b: 90,  w: 0,  brightness: 30 } },
    ],
  },
  warm: {
    label: '🕯 Warm',
    desc:  'Amber, candlelight, soft orange — cosy and flattering',
    steps: [
      { par: { r: 255, g: 100, b: 10,  w: 100, a: 80, uv: 0, strobe: 0, brightness: 50 }, spot: { r: 255, g: 120, b: 30,  w: 80,  brightness: 50 } },
      { par: { r: 220, g: 80,  b: 0,   w: 80,  a: 60, uv: 0, strobe: 0, brightness: 45 }, spot: { r: 240, g: 100, b: 10,  w: 60,  brightness: 45 } },
      { par: { r: 255, g: 140, b: 20,  w: 180, a: 0,  uv: 0, strobe: 0, brightness: 55 }, spot: { r: 255, g: 160, b: 60,  w: 150, brightness: 55 } },
      { par: { r: 200, g: 60,  b: 0,   w: 60,  a: 100, uv: 0, strobe: 0, brightness: 40 }, spot: { r: 220, g: 80,  b: 0,   w: 50,  brightness: 40 } },
    ],
  },
  hype: {
    label: '⚡ Hype',
    desc:  'Punchy reds, hot white hits, high energy',
    steps: [
      { par: { r: 255, g: 0,   b: 0,   w: 0,  a: 0, uv: 0, strobe: 0, brightness: 60 }, spot: { r: 255, g: 0,   b: 0,   w: 0,  brightness: 60 } },
      { par: { r: 255, g: 80,  b: 0,   w: 0,  a: 0, uv: 0, strobe: 0, brightness: 58 }, spot: { r: 255, g: 80,  b: 0,   w: 0,  brightness: 58 } },
      { par: { r: 200, g: 200, b: 200, w: 200, a: 0, uv: 0, strobe: 0, brightness: 55 }, spot: { r: 220, g: 220, b: 200, w: 180, brightness: 55 } },
      { par: { r: 255, g: 0,   b: 0,   w: 0,  a: 0, uv: 0, strobe: 0, brightness: 60 }, spot: { r: 255, g: 0,   b: 0,   w: 0,  brightness: 60 } },
      { par: { r: 0,   g: 0,   b: 255, w: 0,  a: 0, uv: 0, strobe: 0, brightness: 58 }, spot: { r: 0,   g: 0,   b: 255, w: 0,  brightness: 58 } },
    ],
  },
};

// Warm amber default — used for auto-created and split steps
const DEFAULT_PAR  = { r: 180, g: 60, b: 0, w: 60, a: 40, uv: 0, strobe: 0, brightness: 45 };
const DEFAULT_SPOT = { r: 200, g: 80, b: 10, w: 50, brightness: 45 };

export default function SequenceEditor({ sequence, showName, fixtures, onSave, view = 'grid', settings = {} }) {
  const [steps,        setSteps]       = useState(sequence.steps ?? []);
  const [audioPath,    setAudioPath]   = useState(sequence.audioPath ?? null);
  const [audioDur,     setAudioDur]    = useState(sequence.audioDuration ?? 0);
  const [currentTime,  setCurrentTime] = useState(0);
  const [selectedStep, setSelectedStep] = useState(null);
  const [warnings,     setWarnings]    = useState([]);
  const [playing,      setPlaying]     = useState(false);
  const [zoomIdx,      setZoomIdx]     = useState(0);    // index into ZOOM_STEPS
  const [containerW,   setContainerW]  = useState(0);   // scroll-area pixel width

  // Vibe + analysis + wizard state
  const [showVibes,    setShowVibes]   = useState(false);
  const [showWizard,   setShowWizard]  = useState(false);
  const [wizardStep,   setWizardStep]  = useState(1);
  const [wizardMood,   setWizardMood]  = useState('fun');
  const [wizardAggr,   setWizardAggr]  = useState(3);   // 1=subtle … 5=intense
  const [wizardMinLen, setWizardMinLen] = useState(8);   // seconds min step length
  const [wizardRunning, setWizardRunning] = useState(false);
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
        par:  { ...DEFAULT_PAR },
        spot: { ...DEFAULT_SPOT },
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

  // ── Apply a vibe theme across all steps ────────────────────────────────────
  function applyVibe(vibeKey) {
    const vibe    = VIBES[vibeKey];
    const palette = vibe.steps;
    const sorted  = [...steps].sort((a, b) => a.time_s - b.time_s);
    const newSteps = sorted.map((step, i) => ({
      ...step,
      color: {
        par:  { ...palette[i % palette.length].par  },
        spot: { ...palette[i % palette.length].spot },
      },
      par: undefined, spot: undefined,   // clear legacy fields
    }));
    updateSteps(newSteps);
    setShowVibes(false);
  }

  // ── Auto lighting wizard ────────────────────────────────────────────────────
  async function runWizard() {
    if (!audioPath) return;
    setWizardRunning(true);
    try {
      const res    = await fetch(audioPath);
      const buf    = await res.arrayBuffer();
      const tmpCtx = new (window.AudioContext || window.webkitAudioContext)();
      const decoded = await tmpCtx.decodeAudioData(buf);
      tmpCtx.close();

      const sr        = decoded.sampleRate;
      const WINDOW_S  = 0.25;  // finer windows for beat detection
      const winSamp   = Math.round(WINDOW_S * sr);
      const numWin    = Math.ceil(decoded.length / winSamp);
      const numCh     = decoded.numberOfChannels;

      // Compute RMS energy per window (mono mix)
      const rms = [];
      for (let i = 0; i < numWin; i++) {
        const start = i * winSamp, end = Math.min(start + winSamp, decoded.length);
        let sum = 0;
        for (let ch = 0; ch < numCh; ch++) {
          const d = decoded.getChannelData(ch);
          for (let j = start; j < end; j++) sum += d[j] * d[j];
        }
        rms.push(Math.sqrt(sum / ((end - start) * numCh)));
      }

      // Smooth: 7-point moving average
      const smooth = rms.map((_, i) => {
        const lo = Math.max(0, i - 3), hi = Math.min(rms.length - 1, i + 3);
        return rms.slice(lo, hi + 1).reduce((a, b) => a + b, 0) / (hi - lo + 1);
      });

      // Aggressiveness controls how sensitive we are to change.
      //   1 = only major drops   … 5 = follows the track closely
      // Thresholds are much lower than the first pass — the old 2.5× floor
      // meant anything below "intense" found almost nothing.
      const aggr      = wizardAggr;
      const threshold = [1.55, 1.38, 1.25, 1.15, 1.08][aggr - 1];
      const lookBack  = Math.round([3.0, 2.5, 2.0, 1.5, 1.0][aggr - 1] / WINDOW_S);
      const lookAhead = Math.round(0.5 / WINDOW_S);
      // Target section length drives the min gap, floored by the user's setting
      const targetGap = [22, 16, 11, 7, 4][aggr - 1];
      const minGapS   = Math.max(wizardMinLen, targetGap);

      // Collect every candidate transition with its strength, then keep the
      // strongest ones that respect minGapS. Ranking by strength (rather than
      // taking the first hit and skipping ahead) means we land on the *biggest*
      // moment in each region instead of whatever happened to come first.
      const peakRms = Math.max(...smooth, 0.0001);
      const cands = [];
      for (let i = lookBack; i < smooth.length - lookAhead; i++) {
        const before = smooth.slice(Math.max(0, i - lookBack), i).reduce((a, b) => a + b, 0) / lookBack;
        const after  = smooth.slice(i, Math.min(smooth.length, i + lookAhead)).reduce((a, b) => a + b, 0) / lookAhead;
        if (before < 0.00005) continue;
        const ratio = after / before;
        // Both rises and drops are interesting — a breakdown matters as much as a drop
        const strength = Math.max(ratio, 1 / Math.max(ratio, 0.0001));
        if (strength >= threshold) {
          cands.push({ t: parseFloat((i * WINDOW_S).toFixed(2)), strength, rising: ratio >= 1 });
        }
      }
      cands.sort((a, b) => b.strength - a.strength);

      const chosen = [];
      for (const c of cands) {
        if (chosen.every(x => Math.abs(x.t - c.t) >= minGapS)) chosen.push(c);
      }

      // Fallback: if the track is very even and we found nothing, divide it
      // evenly so the wizard always produces a usable starting point.
      if (chosen.length === 0) {
        const n = Math.max(2, Math.min(12, Math.floor(decoded.duration / Math.max(minGapS, 8))));
        for (let k = 1; k < n; k++) chosen.push({ t: parseFloat((decoded.duration * k / n).toFixed(2)), strength: 1, rising: true });
      }

      const splitPoints = [0, ...chosen.map(c => c.t)]
        .filter((t, i, arr) => arr.indexOf(t) === i)
        .sort((a, b) => a - b);

      // Build steps from split points
      const totalDur = parseFloat(decoded.duration.toFixed(2));
      const palette  = VIBES[wizardMood]?.steps ?? VIBES.fun.steps;

      const newSteps = splitPoints.map((t, idx) => {
        const nextT    = splitPoints[idx + 1] ?? totalDur;
        const dur      = parseFloat((nextT - t).toFixed(2));
        const colours  = palette[idx % palette.length];

        // Vary brightness slightly based on local energy at this split point
        const winIdx   = Math.round(t / WINDOW_S);
        const localRms = smooth[Math.min(winIdx, smooth.length - 1)] ?? 0;
        const peak     = Math.max(...smooth);
        const energyPct = peak > 0 ? Math.min(1, localRms / peak) : 0.5;
        // Scale brightness: quiet = 70% of preset brightness, loud = 100%
        const bScale   = 0.7 + 0.3 * energyPct;

        const scalePar  = { ...colours.par,  brightness: Math.round(colours.par.brightness  * bScale) };
        const scaleSpot = { ...colours.spot, brightness: Math.round(colours.spot.brightness * bScale) };

        // Calmer vibes get longer fades; aggressive ones snap
        const fadeDur = aggr <= 2 ? 1.5 : aggr <= 3 ? 0.8 : 0.3;
        const fadeOut = idx === splitPoints.length - 1 ? 2 : 0;

        // Effect layers the wizard chooses for you
        const effects = [];
        if (idx > 0) effects.push({ type: 'fade', direction: 'in', duration_s: fadeDur });
        // On high-energy sections at higher aggressiveness, add movement
        if (aggr >= 4 && energyPct > 0.75) {
          effects.push({ type: 'flash', at: 0, duration_s: 0.12, repeat: 3, gap_s: 0.28 });
        } else if (aggr >= 3 && energyPct > 0.6) {
          effects.push({ type: 'pulse', rate_hz: 2, depth: 0.35 });
        }

        return {
          id:          crypto.randomUUID(),
          time_s:      t,
          duration_s:  dur,
          fade_in_s:   idx === 0 ? 0 : fadeDur,
          fade_out_s:  fadeOut,
          parEnabled:  true,
          spotEnabled: true,
          color:       { par: scalePar, spot: scaleSpot },
          effects,
          memo:        '',
        };
      });

      updateSteps(newSteps);
      setShowWizard(false);
      setWizardStep(1);
    } catch (err) {
      console.error('Wizard failed:', err);
      setWarnings(w => [...w, `Wizard failed: ${err.message}`]);
    }
    setWizardRunning(false);
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
            className="btn-primary"
            onClick={() => { setShowWizard(true); setWizardStep(1); }}
            title="Auto-generate lighting steps from the song"
          >🪄 Wizard</button>
        )}
        {steps.length > 0 && (
          <button
            className="btn-secondary"
            onClick={() => setShowVibes(v => !v)}
            title="Apply a lighting vibe theme to all steps"
          >🎨 Vibe</button>
        )}
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

      {/* ── Grid view ── */}
      {view === 'grid' && (
        <GridEditor
          steps={steps}
          onUpdateSteps={updateSteps}
          onSelectStep={setSelectedStep}
          selectedId={selectedStep}
          currentTime={currentTime}
          onSeek={t => { setCurrentTime(t); wsRef.current?.seek(t / duration); }}
          maxBrightness={settings.maxBrightness ?? 100}
        />
      )}

      {/* ── Combined timeline ── */}
      <div className="combined-timeline" style={view === 'grid' ? { display: 'none' } : undefined}>

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

      {/* ── Stage preview ── */}
      <StagePreview steps={steps} time={currentTime} playing={playing} />

      {/* ── Step panel — fine control for the selected section ── */}
      {selected && view === 'timeline' && (
        <StepPanel
          step={selected}
          onChange={patch => updateStep(selected.id, patch)}
          onDelete={() => deleteStep(selected.id)}
          mode="advanced"
        />
      )}

      {/* ── Auto lighting wizard ── */}
      {showWizard && (
        <div className="modal-overlay" onClick={() => !wizardRunning && setShowWizard(false)}>
          <div className="modal-box wizard-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">🪄 Lighting Wizard</span>
              {!wizardRunning && <button className="modal-close" onClick={() => setShowWizard(false)}>✕</button>}
            </div>

            {wizardRunning ? (
              <div className="wizard-running">
                <div className="wizard-spinner" />
                <p>Analysing song and building your light show…</p>
              </div>
            ) : (
              <>
                {/* Step 1: Mood */}
                {wizardStep === 1 && (
                  <div className="wizard-step">
                    <p className="wizard-step-label">Step 1 of 3 — What's the mood?</p>
                    <div className="vibe-list">
                      {Object.entries(VIBES).map(([key, v]) => (
                        <button
                          key={key}
                          className={`vibe-card${wizardMood === key ? ' vibe-card-selected' : ''}`}
                          onClick={() => setWizardMood(key)}
                        >
                          <span className="vibe-label">{v.label}</span>
                          <span className="vibe-desc">{v.desc}</span>
                          <div className="vibe-swatches">
                            {v.steps.map((s, i) => (
                              <span key={i} className="vibe-dot" style={{
                                background: `rgb(${Math.round(s.par.r * s.par.brightness / 100)},${Math.round(s.par.g * s.par.brightness / 100)},${Math.round(s.par.b * s.par.brightness / 100)})`
                              }} />
                            ))}
                          </div>
                        </button>
                      ))}
                    </div>
                    <div className="wizard-nav">
                      <span />
                      <button className="btn-primary" onClick={() => setWizardStep(2)}>Next →</button>
                    </div>
                  </div>
                )}

                {/* Step 2: Aggressiveness */}
                {wizardStep === 2 && (
                  <div className="wizard-step">
                    <p className="wizard-step-label">Step 2 of 3 — How aggressive should the changes be?</p>
                    <div className="wizard-aggr-grid">
                      {[
                        { val: 1, label: 'Very subtle',  desc: 'Few changes, long sections, slow fades' },
                        { val: 2, label: 'Gentle',       desc: 'Changes on big song moments only' },
                        { val: 3, label: 'Moderate',     desc: 'Balanced — good for most shows' },
                        { val: 4, label: 'Dynamic',      desc: 'Frequent changes, follows energy closely' },
                        { val: 5, label: 'Intense',      desc: 'Maximum changes, tight beat-following' },
                      ].map(o => (
                        <button
                          key={o.val}
                          className={`wizard-aggr-btn${wizardAggr === o.val ? ' wizard-aggr-active' : ''}`}
                          onClick={() => setWizardAggr(o.val)}
                        >
                          <span className="wizard-aggr-label">{o.label}</span>
                          <span className="wizard-aggr-desc">{o.desc}</span>
                        </button>
                      ))}
                    </div>
                    <div className="wizard-nav">
                      <button className="btn-secondary" onClick={() => setWizardStep(1)}>← Back</button>
                      <button className="btn-primary"   onClick={() => setWizardStep(3)}>Next →</button>
                    </div>
                  </div>
                )}

                {/* Step 3: Min length + confirm */}
                {wizardStep === 3 && (
                  <div className="wizard-step">
                    <p className="wizard-step-label">Step 3 of 3 — Minimum section length</p>
                    <p className="analysis-hint">Sections shorter than this will be merged. Raise it if you want fewer, longer steps.</p>
                    <div className="wizard-minlen-row">
                      <input
                        type="range" min={2} max={30} value={wizardMinLen}
                        onChange={e => setWizardMinLen(+e.target.value)}
                        className="preset-bright-slider"
                        style={{ flex: 1 }}
                      />
                      <span className="preset-bright-val">{wizardMinLen}s</span>
                    </div>
                    <div className="wizard-summary">
                      <span>Mood: <strong>{VIBES[wizardMood]?.label}</strong></span>
                      <span>Changes: <strong>{'★'.repeat(wizardAggr)}{'☆'.repeat(5 - wizardAggr)}</strong></span>
                      <span>Min section: <strong>{wizardMinLen}s</strong></span>
                    </div>
                    {steps.length > 0 && (
                      <p className="wizard-warn">⚠ This will replace your {steps.length} existing step{steps.length !== 1 ? 's' : ''}.</p>
                    )}
                    <div className="wizard-nav">
                      <button className="btn-secondary" onClick={() => setWizardStep(2)}>← Back</button>
                      <button className="btn-primary" onClick={runWizard}>✨ Generate</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Vibe picker ── */}
      {showVibes && (
        <div className="modal-overlay" onClick={() => setShowVibes(false)}>
          <div className="modal-box vibe-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">🎨 Choose a vibe</span>
              <button className="modal-close" onClick={() => setShowVibes(false)}>✕</button>
            </div>
            <p className="analysis-hint">Applies a colour palette across all {steps.length} steps. You can still tweak individual steps after.</p>
            <div className="vibe-list">
              {Object.entries(VIBES).map(([key, v]) => (
                <button key={key} className="vibe-card" onClick={() => applyVibe(key)}>
                  <span className="vibe-label">{v.label}</span>
                  <span className="vibe-desc">{v.desc}</span>
                  <div className="vibe-swatches">
                    {v.steps.map((s, i) => (
                      <span key={i} className="vibe-dot" style={{
                        background: `rgb(${Math.round(s.par.r * s.par.brightness / 100)},${Math.round(s.par.g * s.par.brightness / 100)},${Math.round(s.par.b * s.par.brightness / 100)})`
                      }} />
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
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

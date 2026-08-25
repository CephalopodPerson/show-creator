import React, { useState, useEffect, useRef, useCallback } from 'react';
import WaveformPlayer from './WaveformPlayer';
import Timeline, { RULER_H, TRACK_H, MEMO_H, TRACKS } from './Timeline';
import StepPanel from './StepPanel';
import StagePreview from './StagePreview';
import PaletteSidebar, { COLOR_META, EFFECT_META, usePaletteDrag, DragGhost, useUsage, useCustomColors } from './Palette';
import WizardPad, { padToSettings } from './WizardPad';
import useHistory, { useUndoShortcuts } from '../hooks/useHistory';
import useIsTouch from '../hooks/useTouch';
import MobileBar from './MobileBar';
import { detectTempo, syncToHz } from '../lib/beats';
import { api, u } from '../api';

const WAVEFORM_H  = 88;
const DEBOUNCE_MS = 800;
const MIN_PX_SEC  = 2;
const ZOOM_STEPS  = [1, 1.5, 2, 3, 5, 8, 12];

function formatTime(s) {
  const m   = Math.floor(s / 60);
  const sec = String(Math.floor(s % 60)).padStart(2, '0');
  const ds  = Math.floor((s % 1) * 10);
  return `${m}:${sec}.${ds}`;
}

// Warm amber default for new and split steps — bright white is rarely right
const DEFAULT_PAR  = { r: 180, g: 60, b: 0, w: 60, a: 40, uv: 0, strobe: 0, brightness: 45 };
const DEFAULT_SPOT = { r: 200, g: 80, b: 10, w: 50, brightness: 45 };

const newStep = (time_s, duration_s) => ({
  id: crypto.randomUUID(),
  time_s, duration_s,
  fade_in_s: 0, fade_out_s: 0,
  parEnabled: true, spotEnabled: true,
  color: { par: { ...DEFAULT_PAR }, spot: { ...DEFAULT_SPOT } },
  effects: [],
  memo: '',
});

export default function SequenceEditor({ sequence, showName, fixtures, onSave, settings = {}, onBack }) {
  const maxBrightness = settings.maxBrightness ?? 100;

  // ── Steps live in history so every edit is undoable ──
  const hist = useHistory(sequence.steps ?? []);
  const steps = hist.state;

  const [audioPath,   setAudioPath]   = useState(sequence.audioPath ?? null);
  const [audioDur,    setAudioDur]    = useState(sequence.audioDuration ?? 0);
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedId,  setSelectedId]  = useState(null);
  const [warnings,    setWarnings]    = useState([]);
  const [playing,     setPlaying]     = useState(false);
  const [zoomIdx,     setZoomIdx]     = useState(0);
  const [containerW,  setContainerW]  = useState(0);
  const [brightness,  setBrightness]  = useState(Math.min(50, maxBrightness));
  const [clipboard,   setClipboard]   = useState(null);
  const [sheet,       setSheet]       = useState(null);   // mobile: null|'colors'|'effects'
  const [picker,      setPicker]      = useState('#ff8800');
  const [showPanel,   setShowPanel]   = useState(false);
  const [page,        setPage]        = useState('edit');   // 'edit' | 'preview'
  const [armed,       setArmed]       = useState(null);     // touch: tap-to-arm

  const isTouch = useIsTouch();

  // Wizard
  const [showWizard,    setShowWizard]    = useState(false);
  const [padX,          setPadX]          = useState(0.4);
  const [padY,          setPadY]          = useState(0.5);
  const [paletteKey,    setPaletteKey]    = useState('ember');
  const [keepSections,  setKeepSections]  = useState(false);
  const [wizardRunning, setWizardRunning] = useState(false);

  const [bpm,       setBpm]       = useState(sequence.bpm ?? null);
  const [bpmConf,   setBpmConf]   = useState(sequence.bpmConfidence ?? null);
  const [detecting, setDetecting] = useState(false);

  const { bump, topColors, topEffects } = useUsage();
  const { custom, addColor, removeColor } = useCustomColors();

  // Held in a ref so the tempo effect can persist without depending on `steps`,
  // which would otherwise re-trigger detection on every edit.
  const onSaveRef = useRef(null);
  useEffect(() => {
    onSaveRef.current = (patch) => onSave({ ...sequence, steps, audioPath, ...patch });
  });

  const saveTimer = useRef(null);
  const scrollRef = useRef(null);
  const wsRef     = useRef(null);

  const duration = audioDur || 300;

  useEffect(() => {
    if (!scrollRef.current) return;
    const ro = new ResizeObserver(([e]) => setContainerW(e.contentRect.width));
    ro.observe(scrollRef.current);
    return () => ro.disconnect();
  }, []);

  const basePxSec  = containerW > 0 ? containerW / duration : MIN_PX_SEC;
  const pxPerSec   = Math.max(MIN_PX_SEC, basePxSec * ZOOM_STEPS[zoomIdx]);
  const totalWidth = Math.round(pxPerSec * duration);

  // ── Auto-save (debounced) ──
  const triggerSave = useCallback((newSteps, newAudioPath) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      onSave({ ...sequence, steps: newSteps, audioPath: newAudioPath ?? audioPath });
    }, DEBOUNCE_MS);
  }, [sequence, audioPath, onSave]);

  useEffect(() => { triggerSave(steps); /* eslint-disable-next-line */ }, [steps]);

  // Seed a full-length step when audio first loads into an empty sequence
  useEffect(() => {
    if (audioDur > 0 && steps.length === 0) {
      const s = newStep(0, parseFloat(audioDur.toFixed(2)));
      hist.reset([s]);
      setSelectedId(s.id);
    }
  // eslint-disable-next-line
  }, [audioDur]);

  // ── Auto-detect tempo on load ──
  // Fires once per audio file. The result is persisted on the sequence, so
  // reopening a song reuses it rather than decoding the file again.
  const bpmForPath = useRef(null);
  useEffect(() => {
    if (!audioPath) return;
    if (bpmForPath.current === audioPath) return;              // already handled this file
    if (bpm && sequence.audioPath === audioPath) {             // saved from a previous session
      bpmForPath.current = audioPath;
      return;
    }

    let cancelled = false;
    bpmForPath.current = audioPath;
    (async () => {
      setDetecting(true);
      try {
        const buf = await (await fetch(u(audioPath))).arrayBuffer();
        if (cancelled) return;
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const decoded = await ctx.decodeAudioData(buf);
        ctx.close();
        if (cancelled) return;
        const { bpm: found, confidence } = detectTempo(decoded);
        setBpm(found);
        setBpmConf(confidence);
        onSaveRef.current?.({ bpm: found, bpmConfidence: confidence });
      } catch {
        // Not fatal — effects fall back to a free-running rate
      }
      if (!cancelled) setDetecting(false);
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line
  }, [audioPath]);

  // ── Step mutations ──
  const updateStep = useCallback((id, patch) => {
    hist.set(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s).sort((a, b) => a.time_s - b.time_s));
  }, [hist]);

  const updateMany = useCallback((patches) => {
    hist.set(prev => prev.map(s => {
      const m = patches.find(p => p.id === s.id);
      return m ? { ...s, ...m.patch } : s;
    }).sort((a, b) => a.time_s - b.time_s));
  }, [hist]);

  const setSteps = useCallback((next) => {
    hist.set(typeof next === 'function' ? next : [...next].sort((a, b) => a.time_s - b.time_s));
  }, [hist]);

  function deleteStep(id) {
    hist.set(prev => prev.filter(s => s.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function removeEffect(stepId, type, track) {
    hist.set(prev => prev.map(s => s.id === stepId
      ? { ...s, effects: (s.effects ?? []).filter(e => !(e.type === type && (!e.track || e.track === track))) }
      : s));
  }

  // ── Beat detection ──
  const detectBpm = useCallback(async () => {
    if (!audioPath || detecting) return;
    setDetecting(true);
    try {
      const buf = await (await fetch(u(audioPath))).arrayBuffer();
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const decoded = await ctx.decodeAudioData(buf);
      ctx.close();
      const { bpm: found, confidence } = detectTempo(decoded);
      setBpm(found);
      setBpmConf(confidence);
      onSaveRef.current?.({ bpm: found, bpmConfidence: confidence });
    } catch (err) {
      setWarnings(w => [...w, `Beat detection failed: ${err.message}`]);
    }
    setDetecting(false);
  }, [audioPath, detecting, sequence, steps, onSave]);

  // ── Drag-and-drop from the palette ──
  const handleDrop = useCallback(({ payload, stepId, track, frac = 0 }) => {
    if (!payload || !stepId) return;
    setSelectedId(stepId);

    // ── Color ──
    if (payload.kind === 'color') {
      const c = payload.color ?? COLOR_META[payload.key];
      if (!c) return;
      bump('color', payload.key);
      hist.set(prev => prev.map(s => {
        if (s.id !== stepId) return s;
        const cur = { par: s.color?.par ?? s.par ?? {}, spot: s.color?.spot ?? s.spot ?? {} };
        return {
          ...s,
          color: { ...cur, [track]: { ...c[track], brightness: Math.min(brightness, maxBrightness) } },
          par: undefined, spot: undefined,
        };
      }));
      return;
    }

    // ── Flash: carve a short block out of the host at the drop point ──
    if (payload.kind === 'flash') {
      bump('effect', 'flash');
      hist.set(prev => {
        const sorted = [...prev].sort((a, b) => a.time_s - b.time_s);
        const host = sorted.find(s => s.id === stepId);
        if (!host) return prev;

        const FLASH_S = 0.15;
        // Land on the drop point, but keep the flash inside the host block
        let at = host.time_s + frac * host.duration_s;
        at = Math.max(host.time_s, Math.min(at, host.time_s + host.duration_s - FLASH_S));
        if (host.duration_s <= FLASH_S * 2) return prev;   // too short to split

        const headDur = +(at - host.time_s).toFixed(3);
        const tailAt  = +(at + FLASH_S).toFixed(3);
        const tailDur = +(host.time_s + host.duration_s - tailAt).toFixed(3);

        // Flash inherits the host color, punched up to full
        const hostCol = { par: host.color?.par ?? host.par ?? {}, spot: host.color?.spot ?? host.spot ?? {} };
        const punch = c => ({ ...c, brightness: Math.min(maxBrightness, Math.round((c.brightness ?? 50) * 1.7)) });

        const flash = {
          id: crypto.randomUUID(),
          time_s: +at.toFixed(3),
          duration_s: FLASH_S,
          fade_in_s: 0, fade_out_s: 0,
          parEnabled: host.parEnabled, spotEnabled: host.spotEnabled,
          color: { par: punch(hostCol.par), spot: punch(hostCol.spot) },
          effects: [],
          isFlash: true,
          memo: '',
        };

        const out = prev.filter(s => s.id !== host.id);
        if (headDur > 0.02) out.push({ ...host, duration_s: headDur });
        out.push(flash);
        if (tailDur > 0.02) {
          out.push({
            ...JSON.parse(JSON.stringify(host)),
            id: crypto.randomUUID(),
            time_s: tailAt,
            duration_s: tailDur,
            memo: '',
          });
        }
        return out.sort((a, b) => a.time_s - b.time_s);
      });
      return;
    }

    // ── Effect layer, attached to the track it was dropped on ──
    if (payload.kind === 'effect') {
      bump('effect', payload.key);
      hist.set(prev => prev.map(s => {
        if (s.id !== stepId) return s;
        const cur  = s.effects ?? [];
        const rest = cur.filter(e => !(e.type === payload.key && (!e.track || e.track === track)));
        const made = { ...EFFECT_META[payload.key].make(), track };
        // Resolve beat-synced rates now so the exporter stays simple
        if (made.sync && bpm) made.rate_hz = +syncToHz(bpm, made.sync).toFixed(3);
        else if (made.sync) made.rate_hz = 2;
        return { ...s, effects: [...rest, made] };
      }));
    }
  }, [hist, brightness, maxBrightness, bump, bpm]);

  const { drag, startDrag } = usePaletteDrag(handleDrop);

  // Touch path: tap a palette chip to arm it, then tap a block to apply. Drag
  // fights with page scrolling on a phone and hides the target under a thumb.
  const applyArmed = useCallback((stepId, track) => {
    if (!armed) return false;
    const ok = (armed.kind === 'color' || armed.kind === 'effect' || armed.kind === 'flash');
    if (!ok) return false;
    handleDrop({ payload: armed, stepId, track, frac: 0.5 });
    return true;
  }, [armed, handleDrop]);

  const onBlockTap = useCallback((stepId, track) => {
    if (isTouch && armed) {
      applyArmed(stepId, track);
      return true;    // consumed — don't also select
    }
    return false;
  }, [isTouch, armed, applyArmed]);

  // ── Copy / paste of color + effect pairings ──
  const selected = steps.find(s => s.id === selectedId);

  const doCopy = useCallback(() => {
    if (!selected) return;
    setClipboard({
      color: {
        par:  selected.color?.par  ?? selected.par  ?? null,
        spot: selected.color?.spot ?? selected.spot ?? null,
      },
      effects: JSON.parse(JSON.stringify(selected.effects ?? [])),
      parEnabled:  selected.parEnabled,
      spotEnabled: selected.spotEnabled,
    });
  }, [selected]);

  const doPaste = useCallback(() => {
    if (!clipboard || !selectedId) return;
    hist.set(prev => prev.map(s => s.id === selectedId ? {
      ...s,
      color:   JSON.parse(JSON.stringify(clipboard.color)),
      effects: JSON.parse(JSON.stringify(clipboard.effects)),
      parEnabled:  clipboard.parEnabled,
      spotEnabled: clipboard.spotEnabled,
      par: undefined, spot: undefined,
    } : s));
  }, [clipboard, selectedId, hist]);

  useUndoShortcuts({ undo: hist.undo, redo: hist.redo, onCopy: doCopy, onPaste: doPaste });

  // ── Split / add at playhead ──
  function splitAtCursor() {
    const sorted = [...steps].sort((a, b) => a.time_s - b.time_s);
    const t = parseFloat(currentTime.toFixed(2));
    const host = sorted.find(s => t > s.time_s && t < s.time_s + s.duration_s);

    if (host) {
      const a = { ...host, duration_s: parseFloat((t - host.time_s).toFixed(2)) };
      const b = {
        ...JSON.parse(JSON.stringify(host)),
        id: crypto.randomUUID(),
        time_s: t,
        duration_s: parseFloat((host.time_s + host.duration_s - t).toFixed(2)),
        memo: '',
      };
      setSteps(sorted.map(s => s.id === host.id ? a : s).concat(b));
      setSelectedId(b.id);
      return;
    }

    const gapEnd = sorted.find(s => s.time_s > t);
    const gapDur = gapEnd ? gapEnd.time_s - t : Math.max(2, duration - t);
    if (gapDur < 0.2) return;
    const s = newStep(t, parseFloat(gapDur.toFixed(2)));
    setSteps([...sorted, s]);
    setSelectedId(s.id);
  }

  const splitLabel = (() => {
    const host = steps.find(s => currentTime > s.time_s && currentTime < s.time_s + s.duration_s);
    return host ? `✂ Split at ${formatTime(currentTime)}` : `＋ Add at ${formatTime(currentTime)}`;
  })();

  // ── Wizard ──
  async function runWizard() {
    if (!audioPath) return;
    setWizardRunning(true);
    try {
      const cfg = padToSettings(padX, padY, paletteKey, maxBrightness);

      const buf     = await (await fetch(u(audioPath))).arrayBuffer();
      const ctx     = new (window.AudioContext || window.webkitAudioContext)();
      const decoded = await ctx.decodeAudioData(buf);
      ctx.close();

      const sr = decoded.sampleRate, W = 0.25;
      const winSamp = Math.round(W * sr);
      const nWin    = Math.ceil(decoded.length / winSamp);
      const nCh     = decoded.numberOfChannels;

      const rms = [];
      for (let i = 0; i < nWin; i++) {
        const a = i * winSamp, b = Math.min(a + winSamp, decoded.length);
        let sum = 0;
        for (let ch = 0; ch < nCh; ch++) {
          const d = decoded.getChannelData(ch);
          for (let j = a; j < b; j++) sum += d[j] * d[j];
        }
        rms.push(Math.sqrt(sum / ((b - a) * nCh)));
      }
      const smooth = rms.map((_, i) => {
        const lo = Math.max(0, i - 3), hi = Math.min(rms.length - 1, i + 3);
        return rms.slice(lo, hi + 1).reduce((x, y) => x + y, 0) / (hi - lo + 1);
      });
      const peak = Math.max(...smooth, 0.0001);

      // Detect tempo once here so synced pulses land on the beat
      let tempo = bpm;
      try {
        const t = detectTempo(decoded);
        tempo = t.bpm;
        setBpm(t.bpm);
        setBpmConf(t.confidence);
      } catch { /* fall back to whatever bpm we already had */ }

      let splitPoints;
      if (keepSections && steps.length > 0) {
        splitPoints = [...steps].sort((a, b) => a.time_s - b.time_s).map(s => s.time_s);
      } else {
        const lookBack  = Math.round((3.0 - padY * 2.0) / W);
        const lookAhead = Math.round(0.5 / W);
        const cands = [];
        for (let i = lookBack; i < smooth.length - lookAhead; i++) {
          const before = smooth.slice(Math.max(0, i - lookBack), i).reduce((x, y) => x + y, 0) / lookBack;
          const after  = smooth.slice(i, i + lookAhead).reduce((x, y) => x + y, 0) / lookAhead;
          if (before < 0.00005) continue;
          const ratio = after / before;
          const strength = Math.max(ratio, 1 / Math.max(ratio, 0.0001));
          if (strength >= cfg.threshold) cands.push({ t: +(i * W).toFixed(2), strength });
        }
        cands.sort((a, b) => b.strength - a.strength);
        const chosen = [];
        for (const c of cands) if (chosen.every(x => Math.abs(x.t - c.t) >= cfg.targetGap)) chosen.push(c);
        if (chosen.length === 0) {
          const n = Math.max(2, Math.min(12, Math.floor(decoded.duration / Math.max(cfg.targetGap, 8))));
          for (let k = 1; k < n; k++) chosen.push({ t: +(decoded.duration * k / n).toFixed(2) });
        }
        splitPoints = [0, ...chosen.map(c => c.t)].filter((t, i, a) => a.indexOf(t) === i).sort((a, b) => a - b);
      }

      const totalDur = +decoded.duration.toFixed(2);
      const built = splitPoints.map((t, i) => {
        const next = splitPoints[i + 1] ?? totalDur;
        const pal  = cfg.palette[i % cfg.palette.length];
        const wIdx = Math.min(Math.round(t / W), smooth.length - 1);
        const energy = smooth[wIdx] / peak;
        const scale  = 0.75 + 0.25 * energy;

        // X (punch) picks the effect character, Y (energy) gates how often it fires
        // X (punch) picks the character, Y (energy) gates how often it fires.
        // Pulses are beat-synced when we have a tempo, so they sit on the music.
        const effects = [];
        if (i > 0 && cfg.fadeDur > 0.25) {
          effects.push({ type: 'fade', direction: 'in', duration_s: cfg.fadeDur, track: 'par' });
          effects.push({ type: 'fade', direction: 'in', duration_s: cfg.fadeDur, track: 'spot' });
        }
        const lively = energy > 0.85 - padY * 0.35;
        if (lively && cfg.punch > 0.45 && cfg.punch <= 0.75) {
          const sync = padY > 0.7 ? 'eighth' : 'quarter';
          effects.push({
            type: 'pulse', sync, track: 'par',
            rate_hz: +syncToHz(tempo, sync).toFixed(3),
            depth: 0.25 + padY * 0.25,
          });
        } else if (lively && padY > 0.7 && cfg.punch <= 0.45) {
          effects.push({
            type: 'pulse', sync: 'half', track: 'par',
            rate_hz: +syncToHz(tempo, 'half').toFixed(3), depth: 0.18,
          });
        }
        if (cfg.punch > 0.9 && energy > 0.9) effects.push({ type: 'strobe', value: 180, track: 'par' });

        return {
          id: crypto.randomUUID(),
          time_s: t,
          duration_s: +(next - t).toFixed(2),
          fade_in_s: i === 0 ? 0 : cfg.fadeDur,
          fade_out_s: i === splitPoints.length - 1 ? 2 : 0,
          parEnabled: true, spotEnabled: true,
          color: {
            par:  { ...pal.par,  brightness: Math.round(pal.par.brightness  * scale) },
            spot: { ...pal.spot, brightness: Math.round(pal.spot.brightness * scale) },
          },
          effects,
          memo: '',
        };
      });

      // At high punch, drop one-shot flash blocks right on each section start —
      // these are real blocks the user can move, resize or recolor afterwards.
      let final = built;
      if (cfg.punch > 0.75) {
        const FLASH_S = 0.14;
        final = [];
        for (const b of built) {
          const energyHere = smooth[Math.min(Math.round(b.time_s / W), smooth.length - 1)] / peak;
          if (b.time_s > 0 && b.duration_s > FLASH_S * 3 && energyHere > 0.55) {
            const punch = c => ({ ...c, brightness: Math.min(maxBrightness, Math.round(c.brightness * 1.7)) });
            final.push({
              id: crypto.randomUUID(),
              time_s: b.time_s, duration_s: FLASH_S,
              fade_in_s: 0, fade_out_s: 0,
              parEnabled: true, spotEnabled: true,
              color: { par: punch(b.color.par), spot: punch(b.color.spot) },
              effects: [], isFlash: true, memo: '',
            });
            final.push({ ...b, time_s: +(b.time_s + FLASH_S).toFixed(3), duration_s: +(b.duration_s - FLASH_S).toFixed(3), effects: b.effects });
          } else {
            final.push(b);
          }
        }
        final.sort((a, b) => a.time_s - b.time_s);
      }

      hist.set(final);
      setShowWizard(false);
    } catch (err) {
      console.error('Wizard failed:', err);
      setWarnings(w => [...w, `Wizard failed: ${err.message}`]);
    }
    setWizardRunning(false);
  }

  function handleScrollAreaClick(e) {
    const el = scrollRef.current;
    if (!el) return;
    const x = e.clientX - el.getBoundingClientRect().left + el.scrollLeft;
    const t = Math.max(0, Math.min(duration, x / pxPerSec));
    setCurrentTime(t);
    wsRef.current?.seek(t / duration);
  }

  const seekTo = useCallback((t) => {
    setCurrentTime(t);
    if (duration > 0) wsRef.current?.seek(t / duration);
  }, [duration]);

  const preview = (big) => (
    <StagePreview
      steps={steps}
      time={currentTime}
      playing={playing}
      duration={duration}
      big={big}
      droppable={!isTouch}
      onTogglePlay={() => wsRef.current?.togglePlay()}
      onSeek={seekTo}
    />
  );

  return (
    <div className="editor-shell">
      <DragGhost drag={drag} />

      {!isTouch && <PaletteSidebar
        startDrag={startDrag}
        brightness={brightness}
        onBrightness={setBrightness}
        maxBrightness={maxBrightness}
        topColors={topColors}
        topEffects={topEffects}
        custom={custom}
        onAddColor={addColor}
        onRemoveColor={removeColor}
        bpm={bpm}
        bpmConfidence={bpmConf}
        onDetectBpm={detectBpm}
        detecting={detecting}
        onCopy={doCopy}
        onPaste={doPaste}
        canPaste={!!clipboard}
        hasSelection={!!selected}
        onUndo={hist.undo}
        onRedo={hist.redo}
        canUndo={hist.canUndo}
        canRedo={hist.canRedo}
      />}

      <div className="editor-main">
      {/* ── Toolbar ── */}
      <div className="editor-toolbar">
        {onBack && <button className="btn-ghost btn-icon-only" onClick={onBack} title="Back to all songs">←</button>}
        <h2 className="song-title">{sequence.name}</h2>

        {/* Desktop keeps everything inline; mobile moves tools to the bottom bar */}
        {!isTouch && (
          <>
            <div className="zoom-controls">
              <button className="zoom-btn" onClick={() => setZoomIdx(i => Math.max(i - 1, 0))} disabled={zoomIdx === 0} title="Zoom out">－</button>
              <button className="zoom-fit" onClick={() => setZoomIdx(0)} title="Fit whole song">
                {ZOOM_STEPS[zoomIdx] === 1 ? 'Fit' : `${ZOOM_STEPS[zoomIdx]}×`}
              </button>
              <button className="zoom-btn" onClick={() => setZoomIdx(i => Math.min(i + 1, ZOOM_STEPS.length - 1))} disabled={zoomIdx === ZOOM_STEPS.length - 1} title="Zoom in">＋</button>
            </div>
            <button className="btn-secondary" onClick={splitAtCursor}>{splitLabel}</button>
            {selected && (
              <button className="btn-secondary" onClick={() => setShowPanel(p => !p)} title="Fine controls for the selected block">
                {showPanel ? '▼ Details' : '▶ Details'}
              </button>
            )}
          </>
        )}

        {!isTouch && audioPath && (
          <button className="btn-primary" onClick={() => setShowWizard(true)} title="Rebuild the whole show from the song">
            🪄 Wizard
          </button>
        )}
      </div>

      {warnings.map((w, i) => <div key={i} className="warning-banner">⚠ {w}</div>)}

      {/* ── Preview page ── */}
      {page === 'preview' && (
        <div className="preview-page">
          {preview(true)}
        </div>
      )}

      {/* ── Timeline + preview scroll region ── */}
      <div className="editor-scroll" style={page === 'preview' ? { display: 'none' } : undefined}>
      <div className="combined-timeline">
        <div className="labels-col">
          <div className="label-play-cell" style={{ height: WAVEFORM_H }}>
            <button className="play-btn" onClick={() => wsRef.current?.togglePlay()} title={playing ? 'Pause' : 'Play'}>
              {playing ? '⏸' : '▶'}
            </button>
            <span className="time-display">{formatTime(currentTime)}</span>
          </div>
          <div className="label-ruler-spacer" style={{ height: RULER_H }} />
          {TRACKS.map(td => (
            <div key={td.key} className="track-label label-cell" style={{ height: td.h }}>
              <span>{td.label}</span>
              <span className="track-tip" title={td.tip}>?</span>
            </div>
          ))}
        </div>

        <div className="scroll-area" ref={scrollRef} onClick={handleScrollAreaClick}>
          <div className="scroll-inner" style={{ width: totalWidth }}>
            <WaveformPlayer
              ref={wsRef}
              src={audioPath ? u(audioPath) : null}
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
              selectedId={selectedId}
              onSelect={setSelectedId}
              onUpdateStep={updateStep}
              onUpdateSteps={updateMany}
              onRemoveEffect={removeEffect}
              onBlockTap={onBlockTap}
              dragDisabled={isTouch}
              history={hist}
            />
            <div className="unified-playhead" style={{ left: currentTime * pxPerSec }} />
          </div>
        </div>
      </div>

      {/* ── Stage preview: docked or floating ── */}
      {page === 'edit' && preview(false)}
      </div>

      {/* ── Details panel ── */}
      {selected && showPanel && page === 'edit' && (
        <StepPanel
          step={selected}
          onChange={patch => updateStep(selected.id, patch)}
          onDelete={() => deleteStep(selected.id)}
        />
      )}

      {isTouch && (
        <MobileBar
          sheet={sheet} onSheet={setSheet}
          armed={armed} onArm={setArmed}
          page={page} onPage={setPage}
          brightness={brightness} onBrightness={setBrightness} maxBrightness={maxBrightness}
          custom={custom} onAddColor={addColor} onRemoveColor={removeColor}
          onUndo={hist.undo} canUndo={hist.canUndo}
          onSplit={splitAtCursor}
          onWizard={() => setShowWizard(true)}
          canWizard={!!audioPath}
          pickerValue={picker} onPickerChange={setPicker}
        />
      )}
      </div>{/* /editor-main */}

      {/* ── Wizard ── */}
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
                <p>Listening to the song and building your show…</p>
              </div>
            ) : (
              <div className="wizard-step">
                <p className="wizard-step-label">
                  Drag the puck: up for more energy, right for punchier changes. Then pick a palette.
                </p>

                <WizardPad
                  x={padX} y={padY}
                  paletteKey={paletteKey}
                  onChange={(nx, ny) => { setPadX(nx); setPadY(ny); }}
                  onPalette={setPaletteKey}
                  maxBrightness={maxBrightness}
                />

                <label className="wizard-check">
                  <input type="checkbox" checked={keepSections} onChange={e => setKeepSections(e.target.checked)} />
                  <span>
                    Keep my existing sections — only change colors
                    <span className="wizard-check-sub">Re-colors the {steps.length} block{steps.length !== 1 ? 's' : ''} you already have instead of re-cutting the song</span>
                  </span>
                </label>

                {steps.length > 0 && !keepSections && (
                  <p className="wizard-warn">⚠ This replaces your {steps.length} existing block{steps.length !== 1 ? 's' : ''}. Ctrl+Z undoes it.</p>
                )}

                <div className="wizard-nav">
                  <button className="btn-secondary" onClick={() => setShowWizard(false)}>Cancel</button>
                  <button className="btn-primary" onClick={runWizard}>✨ Generate</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

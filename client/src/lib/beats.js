// ── Beat detection ────────────────────────────────────────────────────────────
// Estimates tempo from an AudioBuffer by autocorrelating the onset envelope.
//
// Why not just peak-pick: raw peaks are noisy and give wildly unstable BPM on
// anything with syncopation. Autocorrelating the *rate of energy increase*
// finds the period that best explains the whole track, which is far steadier.

const MIN_BPM = 70;
const MAX_BPM = 180;
const HOP_S   = 0.01;   // 10ms envelope resolution

/**
 * @returns {{ bpm:number, confidence:number, offset:number }}
 *   bpm        estimated tempo
 *   confidence 0–1, how strongly the track supports that period
 *   offset     seconds to the first detected beat
 */
export function detectTempo(buffer) {
  const sr   = buffer.sampleRate;
  const hop  = Math.max(1, Math.round(HOP_S * sr));
  const n    = Math.floor(buffer.length / hop);
  const nCh  = buffer.numberOfChannels;

  // 1. Energy envelope (mono sum, RMS per hop)
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = i * hop, b = Math.min(a + hop, buffer.length);
    let sum = 0;
    for (let ch = 0; ch < nCh; ch++) {
      const d = buffer.getChannelData(ch);
      for (let j = a; j < b; j++) sum += d[j] * d[j];
    }
    env[i] = Math.sqrt(sum / ((b - a) * nCh));
  }

  // 2. Onset strength = positive first difference (energy rising = transient)
  const onset = new Float32Array(n);
  for (let i = 1; i < n; i++) onset[i] = Math.max(0, env[i] - env[i - 1]);

  // Normalize so confidence is comparable across tracks
  let mean = 0;
  for (let i = 0; i < n; i++) mean += onset[i];
  mean /= n || 1;
  for (let i = 0; i < n; i++) onset[i] = Math.max(0, onset[i] - mean);

  // 3. Autocorrelate over the plausible tempo range
  const minLag = Math.floor(60 / MAX_BPM / HOP_S);
  const maxLag = Math.ceil (60 / MIN_BPM / HOP_S);

  let bestLag = minLag, bestScore = -Infinity, total = 0;
  const scores = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0;
    for (let i = 0; i + lag < n; i++) acc += onset[i] * onset[i + lag];
    acc /= (n - lag) || 1;
    scores.push(acc);
    total += acc;
    if (acc > bestScore) { bestScore = acc; bestLag = lag; }
  }

  const avg = total / (scores.length || 1);
  const confidence = avg > 0 ? Math.min(1, (bestScore / avg - 1) / 2) : 0;

  let bpm = 60 / (bestLag * HOP_S);
  // Fold into a musically sensible range — autocorrelation happily locks onto
  // half or double time, which reads as obviously wrong to a human.
  while (bpm < 70)  bpm *= 2;
  while (bpm > 180) bpm /= 2;

  // 4. Find the first strong onset so pulses land on a beat, not mid-bar
  let offset = 0, peak = 0;
  const searchTo = Math.min(n, Math.round(10 / HOP_S));
  for (let i = 0; i < searchTo; i++) {
    if (onset[i] > peak) { peak = onset[i]; offset = i * HOP_S; }
  }

  return { bpm: Math.round(bpm * 10) / 10, confidence, offset: +offset.toFixed(3) };
}

// ── Beat divisions for synced effects ─────────────────────────────────────────
// Stored on the effect as `sync`, resolved to a rate at export time so changing
// the detected BPM updates every synced effect at once.
export const DIVISIONS = [
  { key: 'whole',   label: '1 bar',   beats: 4 },
  { key: 'half',    label: '1/2',     beats: 2 },
  { key: 'quarter', label: '1/4',     beats: 1 },
  { key: 'eighth',  label: '1/8',     beats: 0.5 },
  { key: 'six',     label: '1/16',    beats: 0.25 },
];

export const DIVISION_META = Object.fromEntries(DIVISIONS.map(d => [d.key, d]));

/** Convert a beat division into a pulse rate in Hz for a given tempo. */
export function syncToHz(bpm, divisionKey) {
  const beats = DIVISION_META[divisionKey]?.beats ?? 1;
  if (!bpm || bpm <= 0) return 2;
  // One full on/off cycle per division
  return (bpm / 60) / beats;
}

/** Seconds per beat division — handy for snapping. */
export function divisionSeconds(bpm, divisionKey) {
  const beats = DIVISION_META[divisionKey]?.beats ?? 1;
  if (!bpm || bpm <= 0) return 0.5;
  return (60 / bpm) * beats;
}

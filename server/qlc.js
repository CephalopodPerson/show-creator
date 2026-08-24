/**
 * qlc.js — QLC+ .qxw parser and sequence writer
 * Reads fixtures from an existing .qxw, merges in new sequences, writes back.
 */

const { XMLParser, XMLBuilder } = require('fast-xml-parser');
const fs = require('fs');

const PARSER_OPTS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: true,
  allowBooleanAttributes: true,
  preserveOrder: false,
  ignoreDeclaration: true,   // don't store <?xml?> as a node — we write it ourselves
};

const BUILDER_OPTS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  indentBy: ' ',
  suppressEmptyNode: true,    // use self-closing tags — QLC+ requires <Speed/> not <Speed></Speed>
};

// ── Parse a .qxw file ────────────────────────────────────────────────────────
function parseQxw(filePath) {
  const xml = fs.readFileSync(filePath, 'utf8');
  const parser = new XMLParser(PARSER_OPTS);
  return parser.parse(xml);
}

// ── Extract fixture info from parsed doc ─────────────────────────────────────
function extractFixtures(doc) {
  const engine = doc?.Workspace?.Engine;
  if (!engine) return [];

  const raw = engine.Fixture;
  const fixtures = Array.isArray(raw) ? raw : raw ? [raw] : [];

  return fixtures.map(f => ({
    id:        f['@_ID'] ?? f.ID,
    name:      f.Name,
    universe:  f.Universe,
    address:   f.Address,   // 0-based DMX address
    channels:  f.Channels,
    mode:      f.Mode,
    model:     f.Model,
    manufacturer: f.Manufacturer,
  }));
}

// ── Find highest Function ID in doc ─────────────────────────────────────────
function maxFunctionId(doc) {
  const engine = doc?.Workspace?.Engine;
  const funcs  = engine?.Function;
  if (!funcs) return 199;
  const arr = Array.isArray(funcs) ? funcs : [funcs];
  return arr.reduce((max, f) => {
    const id = parseInt(f['@_ID'] ?? 0, 10);
    return id > max ? id : max;
  }, 0);
}

// ── Convert seconds to milliseconds (round to nearest ms) ───────────────────
const s2ms = s => Math.round(parseFloat(s) * 1000);

// Channels on the Beam Machine that belong to the operator (pan/tilt) —
// the sequence must never own these or manual control is lost mid-show.
const SPOT_EXCLUDED_CHANNELS = new Set([0, 1, 12, 13]); // pan, tilt, pan fine, tilt fine

// ── Build bound scene element (all channels zeroed) ──────────────────────────
// spotFixtureId: ID of the moving-head fixture — its position channels are excluded
//               so the sequence never takes ownership of pan/tilt.
function buildBoundScene(id, name, fixtures, spotFixtureId) {
  const fixtureVals = fixtures.map(f => {
    const exclude = (spotFixtureId != null && f.id === spotFixtureId)
      ? SPOT_EXCLUDED_CHANNELS : new Set();
    const pairs = Array.from({ length: parseInt(f.channels) }, (_, i) => i)
      .filter(i => !exclude.has(i))
      .map(i => `${i},0`)
      .join(',');
    return { '@_ID': f.id, '#text': pairs };
  });
  return {
    '@_ID': id,
    '@_Type': 'Scene',
    '@_Name': name,
    '@_Hidden': 'True',
    Speed: { '@_FadeIn': '0', '@_FadeOut': '0', '@_Duration': '0' },
    FixtureVal: fixtureVals,
  };
}

// ── Map our track params → DMX channel pairs for each fixture ────────────────
// fixture roles are passed in as config, e.g.:
//   { par: [fixId, ...], spot: [fixId, ...] }
// Channel layout (from the user's rig):
//   Beam Machine (spot): ch0=Pan, ch1=Tilt, ch3=Shutter(205=open,77=strobe,0=closed)
//                         ch4=R, ch5=G, ch6=B, ch7=W, ch9=Dimmer
//   rgbwau (par):        ch0=Master, ch1=Strobe-spd, ch4=R, ch5=G, ch6=B,
//                         ch7=W, ch8=Amber, ch9=UV
// ── Effect layer flattening ───────────────────────────────────────────────────
// A step carries a base colour plus zero or more effect layers. QLC+ sequences
// are a flat list of timed steps, so anything time-varying (flash, pulse) has
// to be expanded into multiple real steps at export time. Fade and strobe are
// properties of a step rather than extra steps, so they're applied in place.
//
// Returns an array of { par, spot, fade_in, duration, fade_out, note }.
function flattenStep(step) {
  const dur     = step.duration_s ?? 0;
  const effects = Array.isArray(step.effects) ? step.effects : [];

  // Base colour — supports both the new shape (step.color.par) and the legacy
  // flat shape (step.par) so existing shows keep working untouched.
  const basePar  = step.color?.par  ?? step.par  ?? null;
  const baseSpot = step.color?.spot ?? step.spot ?? null;

  const scale = (c, f) => c ? { ...c, brightness: Math.max(0, Math.round((c.brightness ?? 100) * f)) } : c;

  const fadeFx   = effects.find(e => e.type === 'fade');
  const strobeFx = effects.find(e => e.type === 'strobe');
  const pulseFx  = effects.find(e => e.type === 'pulse');
  const flashFx  = effects.filter(e => e.type === 'flash');

  // Strobe is a channel value on the par fixture, applied to every sub-step
  const withStrobe = p => (p && strobeFx) ? { ...p, strobe: strobeFx.value ?? 200 } : p;

  let fadeIn  = step.fade_in_s  ?? 0;
  let fadeOut = step.fade_out_s ?? 0;
  if (fadeFx) {
    if (fadeFx.direction === 'in'  || fadeFx.direction === 'both') fadeIn  = fadeFx.duration_s ?? 1;
    if (fadeFx.direction === 'out' || fadeFx.direction === 'both') fadeOut = fadeFx.duration_s ?? 1;
  }

  // ── Pulse: alternate bright/dim across the step ──
  if (pulseFx) {
    const rate  = Math.max(0.25, pulseFx.rate_hz ?? 2);
    const depth = Math.min(1, Math.max(0, pulseFx.depth ?? 0.5));
    // Cap the expansion so a pulse on a long section can't generate hundreds of
    // steps — QLC+ slows badly with very large sequences.
    const MAX_SUBSTEPS = 120;
    let count = Math.max(2, Math.round(dur / (1 / (rate * 2))));
    if (count > MAX_SUBSTEPS) count = MAX_SUBSTEPS;

    // Durations are derived from cumulative millisecond boundaries rather than
    // a fixed per-step value. Rounding each step independently would drift by
    // up to half a millisecond per step, which across ~50 substeps pushes the
    // sequence noticeably out of sync with the audio.
    const totalMs = Math.round(dur * 1000);
    const out = [];
    let prevMs = 0;
    for (let i = 0; i < count; i++) {
      const edgeMs = Math.round((totalMs * (i + 1)) / count);
      const sliceS = (edgeMs - prevMs) / 1000;
      prevMs = edgeMs;
      const f = i % 2 === 0 ? 1 : (1 - depth);
      out.push({
        par:      withStrobe(scale(basePar,  f)),
        spot:     scale(baseSpot, f),
        fade_in:  i === 0 ? fadeIn : sliceS * 0.4,
        duration: sliceS,
        fade_out: i === count - 1 ? fadeOut : 0,
        note:     i === 0 ? (step.memo ?? '') : '',
      });
    }
    return out;
  }

  // ── Flash: base colour interrupted by short bursts ──
  if (flashFx.length > 0) {
    const out = [];
    let cursor = 0;
    // Expand repeats into concrete flash times
    const bursts = flashFx.flatMap(fx => {
      const at     = fx.at ?? 0;
      const fdur   = fx.duration_s ?? 0.15;
      const repeat = Math.max(1, fx.repeat ?? 1);
      const gap    = fx.gap_s ?? fdur * 2;
      return Array.from({ length: repeat }, (_, i) => ({
        at: at + i * (fdur + gap), duration: fdur, color: fx.color ?? null,
      }));
    }).filter(b => b.at < dur).sort((a, b) => a.at - b.at);

    for (const b of bursts) {
      const gapDur = b.at - cursor;
      if (gapDur > 0.01) {
        out.push({
          par:      withStrobe(basePar),
          spot:     baseSpot,
          fade_in:  cursor === 0 ? fadeIn : 0,
          duration: gapDur,
          fade_out: 0,
          note:     cursor === 0 ? (step.memo ?? '') : '',
        });
      }
      const fPar  = b.color?.par  ?? scale(basePar,  1.6);
      const fSpot = b.color?.spot ?? scale(baseSpot, 1.6);
      out.push({
        par: withStrobe(fPar), spot: fSpot,
        fade_in: 0, duration: Math.min(b.duration, dur - b.at), fade_out: 0, note: 'flash',
      });
      cursor = b.at + b.duration;
    }

    const tail = dur - cursor;
    if (tail > 0.01) {
      out.push({
        par: withStrobe(basePar), spot: baseSpot,
        fade_in: 0, duration: tail, fade_out: fadeOut, note: '',
      });
    }
    if (out.length > 0) {
      out[out.length - 1].fade_out = fadeOut;
      return out;
    }
  }

  // ── No time-varying effects: a single step ──
  return [{
    par:      withStrobe(basePar),
    spot:     baseSpot,
    fade_in:  fadeIn,
    duration: dur,
    fade_out: fadeOut,
    note:     step.memo ?? '',
  }];
}

function parDmx(params) {
  // params: { r,g,b,w,a,uv, strobe, brightness, fade_in, fade_out }
  // NOTE: brightness is a 0–100 percentage, but strobe is a raw 0–255 DMX value
  // (that's what the strobe slider and the strobe effect layer both produce).
  // Rescaling it as a percentage used to emit values above 255.
  const dim = Math.round((params.brightness ?? 100) / 100 * 255);
  const pairs = [[0, dim]];
  if (params.strobe > 0) pairs.push([1, Math.max(0, Math.min(255, Math.round(params.strobe)))]);
  if (params.r   > 0) pairs.push([4, params.r]);
  if (params.g   > 0) pairs.push([5, params.g]);
  if (params.b   > 0) pairs.push([6, params.b]);
  if (params.w   > 0) pairs.push([7, params.w]);
  if (params.a   > 0) pairs.push([8, params.a]);
  if (params.uv  > 0) pairs.push([9, params.uv]);
  return pairs;
}

function spotDmx(params) {
  // params: { r,g,b,w, brightness }
  // Pan/Tilt (ch 0,1,12,13) are NEVER written — operator controls position live.
  const dim = Math.round((params.brightness ?? 100) / 100 * 50); // max ~50 for spot dimmer
  const shutter = (params.brightness ?? 100) > 0 ? 205 : 0;     // open or closed
  return [
    [3, shutter],
    [4, params.r  ?? 0],
    [5, params.g  ?? 0],
    [6, params.b  ?? 0],
    [7, params.w  ?? 0],
    [9, dim],
  ];
}

// ── Build step text string from cues at a given step ─────────────────────────
// cues: array of { track:'par'|'spot', params:{...}, fixtureId }
function buildStepText(cues) {
  const parts = [];
  for (const cue of cues) {
    const pairs = cue.track === 'spot' ? spotDmx(cue.params) : parDmx(cue.params);
    parts.push(`${cue.fixtureId}:` + pairs.map(([c, v]) => `${c},${v}`).join(','));
  }
  return parts.join(':');
}

// ── Build a Sequence function element ────────────────────────────────────────
// steps: sorted array of timeline cue events grouped by time
function buildSequence(id, name, boundSceneId, steps, valuesCount) {
  const stepEls = steps.map((s, i) => ({
    '@_Number': i,
    '@_FadeIn':  s2ms(s.fade_in  ?? 0),
    '@_Hold':    s2ms(s.duration ?? 0),
    '@_FadeOut': s2ms(s.fade_out ?? 0),
    '@_Note':    s.note ?? '',
    '@_Values':  valuesCount,
    '#text':     s.dmxText,
  }));

  return {
    '@_ID':          id,
    '@_Type':        'Sequence',
    '@_Name':        name,
    '@_BoundScene':  boundSceneId,
    Speed:    { '@_FadeIn': '2000', '@_FadeOut': '0', '@_Duration': '0' },
    Direction: 'Forward',
    RunOrder:  'SingleShot',
    SpeedModes:{ '@_FadeIn': 'PerStep', '@_FadeOut': 'PerStep', '@_Duration': 'PerStep' },
    Step: stepEls,
  };
}

// ── Find the highest widget ID anywhere in the VirtualConsole tree ───────────
function maxVcId(node) {
  let max = 0;
  function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const id = parseInt(n['@_ID'] ?? -1, 10);
    if (!isNaN(id) && id > max) max = id;
    Object.values(n).forEach(walk);
  }
  walk(node);
  return max;
}

// ── Build a VC Show Frame with one Toggle button per sequence ─────────────────
function buildVcShowFrame(frameId, caption, seqs, startBtnId) {
  const BTN_W = 115, BTN_H = 100, PAD = 10, TOP = 40;

  const buttons = seqs.map((s, i) => ({
    '@_Caption': s.name,
    '@_ID':      startBtnId + i,
    '@_Icon':    '',
    WindowState: { '@_Visible': 'True', '@_X': PAD + i * (BTN_W + PAD), '@_Y': TOP, '@_Width': BTN_W, '@_Height': BTN_H },
    Appearance:  { FrameStyle: 'None', ForegroundColor: 'Default', BackgroundColor: 'Default', BackgroundImage: 'None', Font: 'Default' },
    Function:    { '@_ID': s.seqId },
    Action:      'Toggle',
    Intensity:   { '@_Adjust': 'False', '#text': '100' },
  }));

  const frameW = Math.max(200, seqs.length * (BTN_W + PAD) + PAD);
  const frameH = TOP + BTN_H + PAD * 2;

  return {
    '@_Caption':     caption,
    '@_ID':          frameId,
    Appearance:      { FrameStyle: 'Sunken', ForegroundColor: 'Default', BackgroundColor: 'Default', BackgroundImage: 'None', Font: 'Default' },
    WindowState:     { '@_Visible': 'True', '@_X': 30, '@_Y': 1010, '@_Width': frameW, '@_Height': frameH },
    AllowChildren:   'True',
    AllowResize:     'True',
    ShowHeader:      'True',
    ShowEnableButton:'True',
    Collapsed:       'False',
    Disabled:        'False',
    // fast-xml-parser needs array vs object — single button must still be in array
    Button: buttons,
  };
}

// ── Main export: merge sequences into a .qxw and write out ──────────────────
// sequences: array of { name, steps: [{time_s, duration_s, fade_in_s, fade_out_s, track, params}] }
// fixtureRoles: { par: fixtureId, spot: fixtureId }
// showName: label used for the Virtual Console Show Frame
function mergeAndWrite(sourceQxwPath, outputPath, sequences, fixtureRoles, showName = 'Show') {
  const doc      = parseQxw(sourceQxwPath);
  const fixtures = extractFixtures(doc);
  let   nextId   = maxFunctionId(doc) + 1;

  // Calculate values count from all fixture channels
  const valuesCount = fixtures.reduce((sum, f) => sum + parseInt(f.channels), 0);

  const engine = doc.Workspace.Engine;
  let funcs = engine.Function;
  if (!funcs) funcs = [];
  if (!Array.isArray(funcs)) funcs = [funcs];

  const vcSeqs = [];  // collect { name, seqId } for VC button building

  for (const seq of sequences) {
    // 1. Bound scene
    const boundId = nextId++;
    funcs.push(buildBoundScene(boundId, `${seq.name} - Bound`, fixtures, fixtureRoles.spot));

    // 2. Sort steps by time, flatten effect layers, convert to DMX
    const sorted = [...(seq.steps ?? [])].sort((a, b) => a.time_s - b.time_s);
    const dmxSteps = sorted.flatMap(step => flattenStep(step).map(sub => {
      const cues = [];
      if (sub.par  && fixtureRoles.par  != null && step.parEnabled  !== false)
        cues.push({ track:'par',  fixtureId: fixtureRoles.par,  params: sub.par  });
      if (sub.spot && fixtureRoles.spot != null && step.spotEnabled !== false)
        cues.push({ track:'spot', fixtureId: fixtureRoles.spot, params: sub.spot });
      return {
        dmxText:  buildStepText(cues),
        fade_in:  sub.fade_in  ?? 0,
        duration: sub.duration ?? 0,
        fade_out: sub.fade_out ?? 0,
        note:     sub.note     ?? '',
      };
    }));

    // 3. Sequence function
    const seqId = nextId++;
    funcs.push(buildSequence(seqId, seq.name, boundId, dmxSteps, valuesCount));
    vcSeqs.push({ name: seq.name, seqId, sequenceUuid: seq.id });
  }

  engine.Function = funcs;

  // ── Virtual Console Show Frame ───────────────────────────────────────────
  // Add (or replace) a frame inside the root VC Frame containing one Toggle
  // button per exported sequence, so the operator can trigger each song.
  if (vcSeqs.length > 0) {
    const vc = doc.Workspace?.VirtualConsole;
    const rootFrame = vc?.Frame;
    if (rootFrame && typeof rootFrame === 'object' && !Array.isArray(rootFrame)) {
      // Find max existing VC widget ID so we don't collide
      const maxId    = maxVcId(vc);
      const frameId  = maxId + 1;
      const btnStart = frameId + 1;

      // Get existing child Frames as array; remove any frame with same caption
      let childFrames = rootFrame.Frame
        ? (Array.isArray(rootFrame.Frame) ? rootFrame.Frame : [rootFrame.Frame])
        : [];
      childFrames = childFrames.filter(f => f['@_Caption'] !== showName);

      // Build and append new show frame
      childFrames.push(buildVcShowFrame(frameId, showName, vcSeqs, btnStart));
      rootFrame.Frame = childFrames;
    }
  }

  // Rebuild XML — find where <Workspace starts and take everything from there,
  // discarding any <?xml?> declarations the builder emits (it can emit multiple).
  // Then prepend the single correct declaration + DOCTYPE that QLC+ requires.
  const builder  = new XMLBuilder(BUILDER_OPTS);
  const built    = builder.build(doc);
  const wsStart  = built.indexOf('<Workspace');
  const xmlBody  = wsStart >= 0 ? built.slice(wsStart) : built.replace(/<\?xml[\s\S]*?\?>\s*/gi, '');
  const xml      = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE Workspace>\n' + xmlBody;

  fs.writeFileSync(outputPath, xml, 'utf8');
  // Build uuid → qlcFunctionId map so the caller can store it in show.json
  const seqIdMap = {};
  for (const { sequenceUuid, seqId } of vcSeqs) {
    if (sequenceUuid) seqIdMap[sequenceUuid] = seqId;
  }
  return { success: true, functionsAdded: sequences.length * 2, seqIdMap };
}

module.exports = { parseQxw, extractFixtures, mergeAndWrite };

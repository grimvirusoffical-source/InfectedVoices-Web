// Non-destructive arrangement model; immutable audio assets live outside undo snapshots.
import {validateMixer} from './mixer-schema.js';
import {validatePrecision} from './precision-schema.js';
import {validateProducer} from './producer-schema.js';
import {validateReliabilityFields, CORE_REVISION} from './reliability-schema.js';
export const VERSION = '0.6.5-core5.1';
export const FORMAT = 'InfectedVoicesArrangement';
export const ENGINE_IDS = ['legacy', 'infected'];
export const ROOTS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const uid = () => {
  if(typeof crypto.randomUUID==='function')return crypto.randomUUID();
  const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
  const h=[...b].map(v=>v.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
};
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const copy = value => structuredClone(value);
export const finite = (v, min, max, name = 'Value') => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return v;
};
export const SOUND_DEFAULTS = {
  root: 7, scale: 'minor', tune: 0.7, retune: 65, shift: 0, sub: 0,
  drive: 0, gate: -52, highpass: 85, body: 0, presence: 2,
  compression: -20, ratio: 3, echo: 0.08, delay: 0.25, reverb: 0.08,
  gain: 0, glitch: 0, deess: 0.25
};
export const SOUND_RANGES = {
  root: [0, 11], tune: [0, 1], retune: [1, 250], shift: [-12, 12],
  sub: [0, 0.7], drive: [0, 0.8], gate: [-70, -20], highpass: [40, 250],
  body: [-9, 9], presence: [-6, 6], compression: [-40, 0], ratio: [1, 12],
  echo: [0, 0.7], delay: [0.05, 1], reverb: [0, 0.8], gain: [-18, 12],
  glitch: [0, 0.8], deess: [0, 1]
};
export const PRESETS = {
  'Clean rap': {...SOUND_DEFAULTS},
  'Grim': {...SOUND_DEFAULTS, shift: -5, sub: 0.3, drive: 0.3, body: 4, presence: 1, echo: 0.14, reverb: 0.14, glitch: 0.06},
  'Grim abyss': {...SOUND_DEFAULTS, shift: -9, sub: 0.48, drive: 0.5, body: 6, presence: 0, echo: 0.2, reverb: 0.23, glitch: 0.13},
  'Singing': {...SOUND_DEFAULTS, tune: 0.8, retune: 90, compression: -22, echo: 0.2, reverb: 0.3},
  'Hard tune': {...SOUND_DEFAULTS, tune: 1, retune: 5, echo: 0.12, reverb: 0.16},
  'Acapella': {...SOUND_DEFAULTS, echo: 0, reverb: 0, tune: 0.4, retune: 130}
};
export const TIMING_PRESETS = {
  'Natural rap': {division: 16, strength: 0.65, maxMove: 65, swing: 0, sensitivity: 0.14, preserve: 0.9, minGapMs: 90},
  'Tight trap': {division: 16, strength: 0.88, maxMove: 90, swing: 0.05, sensitivity: 0.16, preserve: 0.75, minGapMs: 70},
  'Triplet flow': {division: 12, strength: 0.7, maxMove: 75, swing: 0, sensitivity: 0.14, preserve: 0.85, minGapMs: 70},
  'Singing': {division: 8, strength: 0.35, maxMove: 45, swing: 0, sensitivity: 0.12, preserve: 1, minGapMs: 120}
};
export const MASTER_PRESETS = {
  'Balanced': {targetDb: -16, ceiling: -1, compression: 0.25, width: 1, drive: 0},
  'Rap': {targetDb: -14, ceiling: -1, compression: 0.45, width: 1.02, drive: 0.02},
  'Grim / EDM': {targetDb: -12, ceiling: -1, compression: 0.55, width: 1.1, drive: 0.05},
  'Dynamic': {targetDb: -19, ceiling: -1.5, compression: 0.12, width: 1, drive: 0}
};
export function newProject() {
  return {
    format: FORMAT, version: 1, coreRevision: CORE_REVISION, id: uid(), title: 'Untitled session', bpm: 150,
    gridOffset: 0, root: 7, scale: 'minor', cursor: 0, loopStart: 0, loopEnd: 6.4,
    loop: false, metronome: false, countIn: 1, compensationMs: 0, snap: 16,
    zoom: 36, engines: {sound: 'legacy', tune: 'legacy', timing: 'legacy', master: 'legacy'},
    mastering: {...MASTER_PRESETS.Balanced}, timing: {...TIMING_PRESETS['Natural rap']},
    tracks: [], clips: [], sections: [], plugins: [], notes: '', modified: Date.now()
  };
}
export function newTrack(name = 'Vocal', kind = 'vocal') {
  if (!['vocal', 'beat', 'effect'].includes(kind)) throw new Error('Unsupported track kind.');
  return {id: uid(), name, kind, gainDb: 0, pan: 0, mute: false, solo: false, armed: false,
    settings: {...SOUND_DEFAULTS}, effects: []};
}
export function newClip(trackId, assetId, duration, name = 'Audio', start = 0) {
  finite(duration, 0.001, 21600, 'Clip duration');
  return {id: uid(), trackId, assetId, originalAssetId: assetId, name, start,
    offset: 0, duration, gainDb: 0, fadeIn: Math.min(0.005, duration / 2), fadeOut: Math.min(0.005, duration / 2), muted: false, takeGroup: ''};
}
export function endTime(p) {
  return p.clips.reduce((end,c)=>Math.max(end,c.start+c.duration),Math.max(8*60/p.bpm,p.loopEnd));
}
export function snapTime(seconds, p, bypass = false) {
  if (bypass || !p.snap) return Math.max(0, seconds);
  const step = 60 / p.bpm * 4 / p.snap;
  return Math.max(0, p.gridOffset + Math.round((seconds - p.gridOffset) / step) * step);
}
export function splitClip(p, clipId, time) {
  const c = p.clips.find(c => c.id === clipId);
  if (!c || time <= c.start + 0.01 || time >= c.start + c.duration - 0.01) {
    throw new Error('Place the playhead inside the selected clip, away from its edges.');
  }
  const duration = time - c.start;
  const right = {...copy(c), id: uid(), start: time, offset: c.offset + duration,
    duration: c.duration - duration, fadeIn: Math.min(0.005, c.duration - duration)};
  c.duration = duration;
  c.fadeOut = Math.min(0.005, duration);
  c.fadeIn = Math.min(c.fadeIn, duration);
  right.fadeOut = Math.min(right.fadeOut, right.duration);
  p.clips.push(right);
  return right;
}
export function trimClip(c, edge, delta, sourceDuration) {
  if (edge === 'left') {
    const move = clamp(delta, -Math.min(c.offset, c.start), c.duration - 0.01);
    c.start += move; c.offset += move; c.duration -= move;
  } else {
    c.duration = clamp(c.duration + delta, 0.01, sourceDuration - c.offset);
  }
  c.fadeIn = Math.min(c.fadeIn, c.duration / 2);
  c.fadeOut = Math.min(c.fadeOut, c.duration / 2);
}
export function duplicateClip(p, id) {
  const c = p.clips.find(c => c.id === id);
  if (!c) throw new Error('Select a clip first.');
  const d = {...copy(c), id: uid(), start: c.start + c.duration, takeGroup: ''};
  p.clips.push(d); return d;
}
export function audibleTracks(p) {
  const solo = p.tracks.some(t => t.solo && !t.mute);
  return p.tracks.filter(t => !t.mute && (!solo || t.solo));
}
export function validateSettings(s) {
  if (!s || typeof s !== 'object') throw new Error('Missing sound settings.');
  for (const [key, range] of Object.entries(SOUND_RANGES)) finite(s[key], ...range, key);
  if (!Number.isInteger(s.root) || !['minor', 'major', 'chromatic', 'pentatonic'].includes(s.scale)) {
    throw new Error('Invalid key or scale.');
  }
  return s;
}
export function validateProject(p, assets) {
  validateReliabilityFields(p);
  validateMixer(p);
  validatePrecision(p);
  validateProducer(p);
  if (!p || p.format !== FORMAT || ![1,2,3,4].includes(p.version) || typeof p.id !== 'string' || typeof p.title !== 'string' || p.title.length > 120) throw new Error('Invalid arrangement project.');
  finite(p.bpm, 30, 300, 'BPM');
  finite(p.gridOffset, 0, 21600, 'Grid start');
  finite(p.cursor, 0, 21600, 'Playhead');
  finite(p.loopStart, 0, 21600, 'Loop start');
  finite(p.loopEnd, p.loopStart + 0.01, 21600, 'Loop end');
  finite(p.compensationMs, -1000, 1000, 'Recording compensation');
  finite(p.countIn, 0, 4, 'Count-in'); finite(p.zoom, 4, 240, 'Zoom');
  if (!Number.isInteger(p.root) || p.root < 0 || p.root > 11 ||
      !['minor', 'major', 'chromatic', 'pentatonic'].includes(p.scale) ||
      ![0, 4, 8, 12, 16, 32].includes(p.snap)) throw new Error('Invalid musical grid.');
  if (!p.engines || !['sound', 'tune', 'timing', 'master'].every(k => ENGINE_IDS.includes(p.engines[k]))) {
    throw new Error('Unsupported engine selection.');
  }
  for (const [key, min, max] of [['targetDb', -24, -8], ['ceiling', -6, -0.1], ['compression', 0, 1], ['width', 0, 1.5], ['drive', 0, 0.35]]) {
    finite(p.mastering?.[key], min, max, key);
  }
  for (const [key, min, max] of [['strength', 0, 1], ['maxMove', 0, 250], ['swing', -0.35, 0.35], ['sensitivity', 0.03, 0.8], ['preserve', 0, 1], ['minGapMs', 25, 250]]) {
    finite(p.timing?.[key], min, max, key);
  }
  if (![4, 8, 12, 16, 32].includes(p.timing?.division)) throw new Error('Invalid timing division.');
  if (!Array.isArray(p.tracks) || !Array.isArray(p.clips) || !Array.isArray(p.sections) || !Array.isArray(p.plugins)) {
    throw new Error('Invalid arrangement lists.');
  }
  const trackIds = new Set(), clipIds = new Set();
  for (const t of p.tracks) {
    if (typeof t.id !== 'string' || trackIds.has(t.id) || typeof t.name !== 'string' || t.name.length > 120 ||
        !['vocal', 'beat', 'effect'].includes(t.kind) || !Array.isArray(t.effects)) throw new Error('Invalid track.');
    trackIds.add(t.id); finite(t.gainDb, -60, 12, 'Track gain'); finite(t.pan, -1, 1, 'Pan');
    validateSettings(t.settings);
    if (![t.mute, t.solo, t.armed].every(v => typeof v === 'boolean')) throw new Error('Invalid track flags.');
  }
  for (const c of p.clips) {
    const a = assets.get(c.assetId), original = assets.get(c.originalAssetId);
    if (typeof c.id !== 'string' || clipIds.has(c.id) || !trackIds.has(c.trackId) || !a || !original ||
        typeof c.name !== 'string' || c.name.length > 160) throw new Error('A clip has missing or invalid audio.');
    clipIds.add(c.id); finite(c.start, 0, 21600, 'Clip start');
    finite(c.offset, 0, a.duration, 'Source offset');
    finite(c.duration, 0.001, a.duration + 0.00001 - c.offset, 'Clip length');
    finite(c.gainDb, -60, 12, 'Clip gain'); finite(c.fadeIn, 0, c.duration, 'Fade-in');
    finite(c.fadeOut, 0, c.duration, 'Fade-out');
    if (typeof c.muted !== 'boolean') throw new Error('Invalid clip flag.');
  }
  for (const s of p.sections) {
    finite(s.start, 0, 21600, 'Section start'); finite(s.end, s.start + 0.001, 21600, 'Section end');
    if (!Number.isInteger(s.root) || s.root < 0 || s.root > 11 || !['minor', 'major', 'chromatic', 'pentatonic'].includes(s.scale)) {
      throw new Error('Invalid key section.');
    }
  }
  return p;
}
export class History {
  constructor(limit = 80) {this.limit = limit; this.past = []; this.future = [];}
  push(p) {this.past.push(copy(p)); if (this.past.length > this.limit) this.past.shift(); this.future = [];}
  undo(p) {if (!this.past.length) return p; this.future.push(copy(p)); return this.past.pop();}
  redo(p) {if (!this.future.length) return p; this.past.push(copy(p)); return this.future.pop();}
  clear() {this.past = []; this.future = [];}
}
export function barBeat(seconds, p) {
  const beats = Math.max(0, (seconds - p.gridOffset) * p.bpm / 60);
  return `${Math.floor(beats / 4) + 1}:${Math.floor(beats % 4) + 1}`;
}

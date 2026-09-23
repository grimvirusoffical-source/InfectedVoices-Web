import {copy} from './workstation/model.js';

export const sharedKeys = ['title', 'bpm', 'gridOffset'];
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function ownContribution(project, userId) {
  const tracks = project.tracks.filter(t => t.ownerId === userId);
  const ids = new Set(tracks.map(t => t.id));
  return copy({tracks, clips: project.clips.filter(c => ids.has(c.trackId))});
}
export function fingerprint(project, userId, creatorId) {
  return JSON.stringify({
    ...ownContribution(project, userId),
    shared: userId === creatorId ? Object.fromEntries(sharedKeys.map(k => [k, project[k]])) : undefined
  });
}
export function normalizeOwnEdit(before, next, userId, creatorId, selectedTrack) {
  // Client guard improves UX; the server independently rechecks every write.
  for (const type of ['tracks', 'clips']) {
    for (const original of before[type]) {
      if (original.ownerId !== userId && !equal(original, next[type].find(v => v.id === original.id))) {
        throw Error('Your collaborator owns this track or clip. You can listen to it, but cannot change it.');
      }
    }
  }
  if (userId !== creatorId && sharedKeys.some(k => !equal(before[k], next[k]))) {
    throw Error('Only the collaboration creator can change the song title, tempo or grid start.');
  }
  for (const track of next.tracks) {
    if (!track.ownerId) {
      track.ownerId = userId;
      track.songKey = {root: before.root, scale: before.scale};
      track.engines = {sound: before.engines.sound, tune: before.engines.tune};
      track.keySections = copy(before.sections);
    }
  }
  const ownTracks = new Set(next.tracks.filter(t => t.ownerId === userId).map(t => t.id));
  for (const clip of next.clips) {
    if (!clip.ownerId) clip.ownerId = userId;
    if (clip.ownerId === userId && !ownTracks.has(clip.trackId)) {
      throw Error('Move your vocal only between your own tracks.');
    }
  }
  // Older plugins/parameter controls can still write global pitch settings.
  // Convert those into selected-track overrides, never partner processing.
  const keyChanged = before.root !== next.root || before.scale !== next.scale;
  const engineChanged = ['sound', 'tune'].some(k => before.engines[k] !== next.engines[k]);
  const sectionsChanged = !equal(before.sections, next.sections);
  if (keyChanged || engineChanged || sectionsChanged) {
    const track = next.tracks.find(t => t.id === selectedTrack && t.ownerId === userId);
    if (!track) throw Error('Select your own track to change its key or processing engine.');
    if (keyChanged) track.songKey = {root: next.root, scale: next.scale};
    if (engineChanged) track.engines = {sound: next.engines.sound, tune: next.engines.tune};
    if (sectionsChanged) track.keySections = copy(next.sections);
    next.root = before.root;
    next.scale = before.scale;
    next.sections = copy(before.sections);
    next.engines.sound = before.engines.sound;
    next.engines.tune = before.engines.tune;
  }
}
export function mergeRemote(remote, local, userId, preserveOwn, creatorId) {
  const next = copy(remote);
  // Editing preferences and master preview are local to this artist.
  for (const k of ['cursor', 'loopStart', 'loopEnd', 'loop', 'metronome', 'countIn', 'compensationMs', 'snap', 'zoom', 'timing', 'mastering', 'plugins', 'notes']) {
    next[k] = copy(local[k]);
  }
  next.engines.timing = local.engines.timing;
  next.engines.master = local.engines.master;
  if (preserveOwn) {
    const own = ownContribution(local, userId);
    next.tracks = [...remote.tracks.filter(t => t.ownerId !== userId), ...own.tracks];
    next.clips = [...remote.clips.filter(c => c.ownerId !== userId), ...own.clips];
    if (userId === creatorId) for (const k of sharedKeys) next[k] = local[k];
  }
  return next;
}
export function scopedHistory(current, historical, userId, creatorId) {
  // Undo the local contribution, not a partner's edits made since that history entry.
  historical.tracks = [...current.tracks.filter(t => t.ownerId !== userId), ...historical.tracks.filter(t => t.ownerId === userId)];
  historical.clips = [...current.clips.filter(c => c.ownerId !== userId), ...historical.clips.filter(c => c.ownerId === userId)];
  if (userId !== creatorId) for (const k of sharedKeys) historical[k] = current[k];
  normalizeOwnEdit(current, historical, userId, creatorId, null);
}
export function encodePCM(asset) {
  const channels = asset.channels.length, length = asset.channels[0].length;
  const buffer = new ArrayBuffer(24 + 4 * channels * length), view = new DataView(buffer);
  new Uint8Array(buffer, 0, 4).set([73, 86, 80, 67]);
  [1, asset.rate, channels, length, 0].forEach((n, i) => view.setUint32(4 + i * 4, n, true));
  let offset = 24;
  for (const channel of asset.channels) for (const sample of channel) {view.setFloat32(offset, sample, true); offset += 4;}
  return buffer;
}
export function decodePCM(buffer, metadata) {
  const v = new DataView(buffer);
  if (buffer.byteLength < 24 || v.getUint32(0, false) !== 0x49565043 || v.getUint32(4, true) !== 1) throw Error('Audio download format was invalid.');
  const rate = v.getUint32(8, true), count = v.getUint32(12, true), length = v.getUint32(16, true);
  if (![1, 2].includes(count) || rate < 8000 || rate > 192000 || buffer.byteLength !== 24 + count * length * 4) throw Error('Audio download length was invalid.');
  const channels = [];
  for (let c = 0; c < count; c++) {
    const x = new Float32Array(length);
    for (let i = 0; i < length; i++) {x[i] = v.getFloat32(24 + (c * length + i) * 4, true); if (!Number.isFinite(x[i])) throw Error('Invalid audio sample.');}
    channels.push(x);
  }
  return {...metadata, rate, length, channels, duration: length / rate, bytes: count * length * 4};
}
export async function digest(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
}

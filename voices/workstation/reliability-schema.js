// Additive v1 project extension. An absent revision retains the original sound.
export const CORE_REVISION = 'reliability-1';
export const COMPAT_REVISION = 'legacy-2026-09';
const scales = ['minor', 'major', 'chromatic', 'pentatonic'];
const engineKeys = ['sound', 'tune', 'timing', 'master'];
const engineIds = ['legacy', 'infected'];

export function correctedCore(projectOrSettings) {
  return projectOrSettings?.coreRevision === CORE_REVISION ||
    projectOrSettings?.__ivCoreRevision === CORE_REVISION;
}

function object(value, label) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(label + ' must be an object.');
  }
}

function musicalKey(value, label) {
  object(value, label);
  if (!Number.isInteger(value.root) || value.root < 0 || value.root > 11 || !scales.includes(value.scale)) {
    throw new Error(label + ' has an invalid root or scale.');
  }
}

function sections(value, label) {
  if (!Array.isArray(value) || value.length > 2048) throw new Error(label + ' must be a bounded list.');
  for (const item of value) {
    musicalKey(item, label);
    if (!Number.isFinite(item.start) || !Number.isFinite(item.end) ||
        item.start < 0 || item.end <= item.start || item.end > 21600) {
      throw new Error(label + ' contains an invalid time range.');
    }
  }
}

export function validateReliabilityFields(project) {
  object(project, 'Project');
  if (project.coreRevision !== undefined && ![CORE_REVISION, COMPAT_REVISION].includes(project.coreRevision)) {
    throw new Error('This project needs a different core revision. The current project was not replaced.');
  }
  if (typeof project.loop !== 'boolean' || typeof project.metronome !== 'boolean' ||
      !Number.isInteger(project.countIn) || typeof project.id !== 'string' ||
      !project.id || project.id.length > 160) throw new Error('Invalid project flags or identifier.');
  if (!Array.isArray(project.tracks) || project.tracks.length > 256 ||
      !Array.isArray(project.clips) || project.clips.length > 20000) {
    throw new Error('The arrangement exceeds the validated list limits.');
  }
  if (project.punch !== undefined && typeof project.punch !== 'boolean') throw new Error('Invalid punch recording flag.');
  sections(project.sections, 'Song key sections');
  for (const track of project.tracks) {
    object(track, 'Track');
    if (track.channelMode !== undefined && !['mono','left','right','stereo-dry'].includes(track.channelMode)) throw new Error('Unsupported vocal channel treatment.');
    if (track.songKey !== undefined) musicalKey(track.songKey, 'Track key');
    if (track.keySections !== undefined) sections(track.keySections, 'Track key sections');
    if (track.engines !== undefined) {
      object(track.engines, 'Track engines');
      for (const [key, value] of Object.entries(track.engines)) {
        if (!engineKeys.includes(key) || !engineIds.includes(value)) throw new Error('Unsupported track engine.');
      }
    }
    if (track.coreRevision !== undefined && ![CORE_REVISION, COMPAT_REVISION].includes(track.coreRevision)) {
      throw new Error('Unsupported track core revision.');
    }
  }
  return project;
}

export function requiredTailFrames(settings, rate) {
  if (!Number.isInteger(rate) || rate < 8000 || rate > 192000) throw new Error('Unsupported sample rate.');
  // Both corrected ambience paths are finite taps; no unbounded feedback loop.
  return Math.ceil(rate * Math.max(settings.echo > 0 ? 2 * settings.delay : 0,
    settings.reverb > 0 ? 0.251 : 0));
}

export function minimumGapHops(milliseconds, rate, hop) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0 || !Number.isInteger(rate) ||
      rate < 8000 || rate > 192000 || !Number.isInteger(hop) || hop < 1) {
    throw new Error('Invalid silence analysis units.');
  }
  return Math.max(1, Math.ceil(milliseconds * rate / (1000 * hop)));
}

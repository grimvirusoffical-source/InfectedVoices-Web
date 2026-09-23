import {copy, uid} from './model.js';

function cut(clip, start, end) {
  const c = copy(clip), offset = Math.max(start, clip.start) - clip.start;
  c.id = uid(); c.start = Math.max(start, clip.start);
  c.duration = Math.min(end, clip.start + clip.duration) - c.start;
  c.offset += offset;
  if (offset > 1e-8) c.fadeIn = Math.min(0.005, c.duration / 2);
  if (end < clip.start + clip.duration - 1e-8) c.fadeOut = Math.min(0.005, c.duration / 2);
  c.fadeIn = Math.min(c.fadeIn, c.duration / 2);
  c.fadeOut = Math.min(c.fadeOut, c.duration / 2);
  return c;
}

export function rangeCheck(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end - start < 0.01 || end > 21600) {
    throw new Error('Choose an A-B range of at least 10 milliseconds inside the session.');
  }
}

function regions(clip, start, end, useMiddle) {
  const result = [], final = clip.start + clip.duration;
  if (clip.start < start - 0.001) result.push(cut(clip, clip.start, Math.min(start, final)));
  if (final > start && clip.start < end) {
    const middle = cut(clip, start, end);
    if (middle.duration >= 0.001) result.push({...middle, muted: !useMiddle});
  }
  if (final > end + 0.001) result.push(cut(clip, Math.max(end, clip.start), final));
  return result;
}

export function compTakeRange(project, clipId, start, end) {
  rangeCheck(start, end);
  const selected = project.clips.find(clip => clip.id === clipId);
  if (!selected || !selected.takeGroup) throw new Error('Select a take from a loop-recorded take group first.');
  if (selected.start > start + 1e-8 || selected.start + selected.duration < end - 1e-8) throw new Error('The chosen take does not cover the whole A-B range.');
  const candidates = project.clips.filter(clip => clip.trackId === selected.trackId && clip.takeGroup === selected.takeGroup);
  if (candidates.length < 2) throw new Error('This take group has no alternate take to comp.');
  const rewritten = [];
  for (const clip of project.clips) {
    if (clip.trackId !== selected.trackId || clip.takeGroup !== selected.takeGroup || clip.start >= end || clip.start + clip.duration <= start) rewritten.push(clip);
    else rewritten.push(...regions(clip, start, end, clip.id === selected.id));
  }
  project.clips = rewritten;
  return rewritten.find(clip => clip.trackId === selected.trackId && clip.takeGroup === selected.takeGroup && !clip.muted && Math.abs(clip.start - start) < 0.001)?.id;
}

export function insertPunchTake(project, clips, start, end) {
  rangeCheck(start, end);
  if (!clips.length) return;
  const trackId = clips[0].trackId;
  if (clips.some(clip => clip.trackId !== trackId)) throw new Error('Punch recording has inconsistent tracks.');
  // Only replace the time actually captured, not unrecorded space after an early stop.
  const coveredStart = Math.max(start, Math.min(...clips.map(clip => clip.start)));
  const coveredEnd = Math.min(end, Math.max(...clips.map(clip => clip.start + clip.duration)));
  if (coveredEnd - coveredStart < 0.001) { project.clips.push(...clips); return; }
  const rewritten = [];
  for (const clip of project.clips) {
    if (clip.trackId !== trackId || clip.start >= coveredEnd || clip.start + clip.duration <= coveredStart) rewritten.push(clip);
    else rewritten.push(...regions(clip, coveredStart, coveredEnd, false));
  }
  project.clips = [...rewritten, ...clips];
}

import {copy, validateProject, endTime, audibleTracks} from './model.js';
import {memoryLimit, zip} from './files.js';
import {measure} from './core.js';
import {hasProducer} from './producer-schema.js';
import {masterProducer,masteringMetrics} from './producer-dsp.js';

export const EXPORT_RATES = [44100, 48000, 96000];
const abortCheck = signal => { if (signal?.aborted) throw new DOMException('Export canceled. Original recordings are unchanged.', 'AbortError'); };
const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));

export function validateExportOptions({rate = 48000, bits = 24, master = false,
    channels = 'stereo', range = 'full', tails = true, dither = false} = {}) {
  if (!EXPORT_RATES.includes(rate) || ![16, 24, 32].includes(bits) || typeof master !== 'boolean' ||
      !['stereo', 'left', 'right', 'mono'].includes(channels) || !['full', 'loop'].includes(range) ||
      typeof tails !== 'boolean' || typeof dither !== 'boolean') throw new Error('Invalid export settings.');
  if (bits === 32 && master) throw new Error('32-bit float is an unmastered handoff. Turn mastering off or choose integer PCM.');
  if (bits === 32 && dither) throw new Error('Dither applies to integer PCM only.');
  return {rate, bits, master, channels, range, tails, dither};
}

export function wavHeader(frameCount, channelCount, rate, bits) {
  if (!Number.isSafeInteger(frameCount) || frameCount < 1 || ![1, 2].includes(channelCount) ||
      !Number.isInteger(rate) || rate < 8000 || rate > 192000 || ![16, 24, 32].includes(bits)) throw new Error('Invalid WAV metadata.');
  const size = frameCount * channelCount * (bits / 8), headerBytes = bits === 32 ? 56 : 44;
  if (!Number.isSafeInteger(size) || size > 0xffffffff - headerBytes) throw new Error('WAV exceeds the RIFF limit. Export a shorter range.');
  const data = new Uint8Array(headerBytes), view = new DataView(data.buffer);
  const text = (at, value) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, size + headerBytes - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, bits === 32 ? 3 : 1, true);
  view.setUint16(22, channelCount, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * channelCount * bits / 8, true); view.setUint16(32, channelCount * bits / 8, true); view.setUint16(34, bits, true);
  let at = 36;
  if (bits === 32) {text(at, 'fact'); view.setUint32(at + 4, 4, true); view.setUint32(at + 8, frameCount, true); at += 12;}
  text(at, 'data'); view.setUint32(at + 4, size, true);
  return data;
}

export async function encodeDeliveryWav(channels, rate, bits = 24,
    {dither = false, seed = 0x1a2b3c4d, signal, progress = () => {}} = {}) {
  const length = channels[0]?.length;
  if (!Array.isArray(channels) || ![1, 2].includes(channels.length) || channels.some(channel => !(channel instanceof Float32Array) || channel.length !== length)) throw new Error('Invalid WAV channels.');
  if (bits === 32 && dither) throw new Error('Float export does not use integer dither.');
  const parts = [wavHeader(length, channels.length, rate, bits)], bytes = bits / 8;
  let state = seed >>> 0, clipped = 0;
  const random = () => {state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296;};
  for (let start = 0; start < length; start += 16384) {
    abortCheck(signal);
    const end = Math.min(length, start + 16384), block = new Uint8Array((end - start) * channels.length * bytes), view = new DataView(block.buffer);
    let at = 0;
    for (let i = start; i < end; i++) for (const channel of channels) {
      const x = channel[i];
      if (!Number.isFinite(x)) throw new Error('Invalid audio sample. No file was finalized.');
      if (bits === 32) view.setFloat32(at, x, true);
      else {
        if (Math.abs(x) > 1) clipped++;
        const scale = 2 ** (bits - 1);
        const value = Math.max(-scale, Math.min(scale - 1, Math.round(x * scale + (dither ? random() - random() : 0))));
        if (bits === 16) view.setInt16(at, value, true);
        else {view.setUint8(at, value & 255); view.setUint8(at + 1, (value >> 8) & 255); view.setUint8(at + 2, (value >> 16) & 255);}
      }
      at += bytes;
    }
    parts.push(block); progress(end / length); await nextTask();
  }
  abortCheck(signal);
  return {blob: new Blob(parts, {type: 'audio/wav'}), clippedSamples: clipped,
    frames: length, rate, bits, channels: channels.length, floatingPoint: bits === 32, dither};
}

export async function renderDelivery(studio, project, options = {}, {signal, trackId = null, raw = false, progress = () => {}} = {}) {
  const settings = validateExportOptions(options);
  const snapshot = copy(project);
  validateProject(snapshot, studio.assets);
  if (!snapshot.clips.length) throw new Error('Import or record audio before exporting.');
  abortCheck(signal);
  if (settings.range === 'loop') {
    snapshot.clips = snapshot.clips.filter(clip => clip.start < snapshot.loopEnd && clip.start + clip.duration > snapshot.loopStart).map(clip => {
      const value = {...clip}, start = Math.max(clip.start, snapshot.loopStart), end = Math.min(clip.start + clip.duration, snapshot.loopEnd);
      value.offset += start - clip.start; value.start = start; value.duration = end - start;
      value.fadeIn = Math.min(value.fadeIn, value.duration / 2); value.fadeOut = Math.min(value.fadeOut, value.duration / 2);
      return value;
    });
  }
  const prepared = await studio.prepare(snapshot, trackId, raw);
  abortCheck(signal);
  const start = settings.range === 'loop' ? snapshot.loopStart : 0;
  const contentEnd = settings.range === 'loop' ? snapshot.loopEnd : endTime(snapshot);
  let end = contentEnd;
  if (settings.tails) end = prepared.reduce((value, item) => item.c.start < contentEnd && item.c.start + item.c.duration > start
    ? Math.max(value, item.c.start + item.a.channels[0].length / item.a.rate) : value, end);
  if(settings.tails) end += studio.mixTailSeconds?.(snapshot,raw)||0;
  const duration = end - start;
  if (!Number.isFinite(duration) || duration <= 0 || duration * settings.rate * 8 > memoryLimit() / 2) throw new Error('Export range exceeds this device render budget. Shorten A-B or use a larger device.');
  // Rate conversion is performed by the browser's OfflineAudioContext. No claim
  // of a proprietary or independently certified resampling engine is made.
  const context = new OfflineAudioContext(2, Math.ceil(duration * settings.rate), settings.rate);
  let rendered;
  try {
    await studio.prepareMixRender?.(context,snapshot,{raw,trackId,start,duration});
    for (const item of prepared) studio.schedule(context, item, 0, start, duration, context.destination);
    progress('Rendering audio…');
    rendered=await context.startRendering();
  } finally { studio.finishMixRender?.(context); }
  abortCheck(signal);
  let channels = [rendered.getChannelData(0).slice(), rendered.getChannelData(1).slice()];
  let producerMaster = null;
  if (settings.master && hasProducer(snapshot) && snapshot.producer.mastering.enabled) {
    progress('Applying Core 5 loudness / true-peak master…');
    producerMaster = masterProducer(channels, settings.rate, snapshot.producer.mastering);
    channels = producerMaster.channels; abortCheck(signal);
  } else if (settings.master) {
    progress('Applying the selected existing master engine…');
    const result = await studio.process('master', {channels, rate: settings.rate, project: snapshot}, channels.map(channel => channel.buffer));
    channels = result.channels; abortCheck(signal);
  }
  if (settings.channels === 'left') channels = [channels[0]];
  if (settings.channels === 'right') channels = [channels[1]];
  if (settings.channels === 'mono') {
    const original = measure(channels).peak;
    const mono = Float32Array.from(channels[0], (sample, index) => (sample + channels[1][index]) * 0.5);
    if (original > 0.001 && measure([mono]).peak < original * 0.01) throw new Error('Mono sum nearly cancels this stereo audio. Choose stereo or a specific channel.');
    channels = [mono];
  }
  const metrics = measure(channels);
  if (settings.bits !== 32 && metrics.peak > 1) throw new Error('The integer export would clip. Lower the mix gain, use a master ceiling, or choose an unmastered float file.');
  return {channels, rate: settings.rate, metrics, producerMetrics: hasProducer(snapshot) ? masteringMetrics(channels, settings.rate) : null, producerMaster, start, end, settings};
}

export async function exportDelivery(studio, project, options, control = {}) {
  const result = await renderDelivery(studio, project, options, control);
  control.progress?.('Encoding WAV…');
  return {...await encodeDeliveryWav(result.channels, result.rate, result.settings.bits,
    {dither: result.settings.dither, signal: control.signal, progress: value => control.progress?.('Encoding ' + Math.round(value * 100) + '%')}),
    start: result.start, end: result.end, metrics: result.metrics};
}

export async function exportDeliveryStems(studio, project, options, control = {}) {
  const settings = validateExportOptions({...options, master: false, range: 'full', channels: 'stereo'});
  const files = [], manifest = {format: 'InfectedVoicesStemDelivery', version: 1, title: project.title,
    bpm: project.bpm, root: project.root, scale: project.scale, coreRevision: project.coreRevision,
    rate: settings.rate, bits: settings.bits, start: 0, masterApplied: false, mixer:project.mixer?copy(project.mixer):null, stems: [],
    notice: 'Place each file at song time zero. Track DSP/gain/pan and its isolated bus/send contribution are printed; nonlinear master processing is excluded. Compressed bus stems need not sum to the stereo bus mix. Per-track tails can have different lengths. Stem isolation ignores track and bus mute/solo audition states.'};
  let total = 0;
  for (const track of project.tracks) {
    abortCheck(control.signal);
    if (!project.clips.some(clip => clip.trackId === track.id && !clip.muted)) continue;
    const snapshot = copy(project);
    snapshot.tracks.forEach(item => { item.mute = item.id !== track.id; item.solo = false; });
    if(snapshot.mixer)for(const bus of snapshot.mixer.buses){bus.mute=false;bus.solo=false;}
    const output = await exportDelivery(studio, snapshot, settings, {...control, trackId: track.id});
    total += output.blob.size;
    if (total > memoryLimit() / 2) throw new Error('This stem package exceeds the memory budget. Export smaller groups.');
    const name = String(files.length + 1).padStart(2, '0') + '-' + track.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) + '.wav';
    files.push({name, blob: output.blob}); manifest.stems.push({trackId: track.id, name, frames: output.frames, start: 0});
  }
  if (!files.length) throw new Error('No active clips to export as stems.');
  files.push({name: 'session.json', blob: new Blob([JSON.stringify(manifest, null, 2)], {type: 'application/json'})});
  abortCheck(control.signal); const blob = await zip(files); abortCheck(control.signal);
  return {blob, manifest};
}

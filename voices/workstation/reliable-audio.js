import {Studio as OriginalStudio} from './audio.js';
import {audibleTracks, copy, endTime, uid, newClip, newTrack, newProject, validateProject} from './model.js';
import {asset, memoryLimit} from './files.js';
import {dbGain, measure, legacySound} from './core.js';
import {CORE_REVISION, correctedCore, requiredTailFrames} from './reliability-schema.js';
import {RecordingStore, RecordingWriter, holdRecordingLock, withRecordingLock} from './recording-journal.js';
import {precisionFingerprint,hasPrecision} from './precision-schema.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const cacheBytes = cache => [...cache.values()].reduce((sum, item) =>
  sum + item.channels.reduce((bytes, channel) => bytes + channel.byteLength, 0), 0);

// Only these edits can use the live path. Structural/DSP edits remain stopped.
export function isMixerOnlyChange(before, after) {
  const normalize = project => {
    const value = copy(project);
    delete value.modified;
    value.tracks = value.tracks.map(track => {
      delete track.gainDb; delete track.pan; delete track.mute; delete track.solo;
      return track;
    });
    return JSON.stringify(value);
  };
  return normalize(before) === normalize(after);
}

function ramp(parameter, value, time) {
  if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(time);
  else { parameter.cancelScheduledValues(time); parameter.setValueAtTime(parameter.value, time); }
  parameter.setTargetAtTime(value, time, 0.008);
}

export class ReliableStudio extends OriginalStudio {
  constructor(status = () => {}) {
    super(status);
    this.mixBuses = new Map();
    this.accountId = null;
    this.writer = null;
    this.journalStatus = null;
    this.protectedStart = false;
    this.finalizingRecording = null;
  }

  configureAccount(owner) {
    if (this.accountId === owner) return;
    if (this.recording || this.protectedStart || this.finalizingRecording) {
      throw new Error('Finish recording before changing its account.');
    }
    this.accountId = owner || null;
    this.journalStatus = null;
  }

  memoryUsage() {
    return {source: this.bytes(), processed: cacheBytes(this.cache),
      capture: this.recording ? this.recordedSamples * 4 : 0,
      pendingWrites: this.writer?.pendingBytes || 0};
  }

  async rendered(clip, track, project, raw = false) {
    if (!correctedCore(project) && (!track.channelMode || track.channelMode === 'mono')) return super.rendered(clip, track, project, raw);
    const engines={...project.engines,...track.engines},songKey=track.songKey||{root:project.root,scale:project.scale},sections=track.keySections||project.sections;
    const key = JSON.stringify([CORE_REVISION, clip.assetId, clip.offset, clip.duration,
      clip.fadeIn, clip.fadeOut, clip.start, track.kind, track.settings, track.effects,
      songKey, sections, engines.sound, engines.tune, track.channelMode, precisionFingerprint(clip), raw]);
    if (this.cache.has(key)) return this.cache.get(key);
    let {rate, channels} = this.region(clip);
    for (const channel of channels) {
      for (let index = 0; index < channel.length; index++) {
        const time = index / rate;
        channel[index] *= Math.min(1, clip.fadeIn ? time / clip.fadeIn : 1,
          clip.fadeOut ? Math.max(0, clip.duration - time) / clip.fadeOut : 1);
      }
    }
    if (track.kind === 'vocal' && !raw && track.channelMode !== 'stereo-dry') {
      const settings = {...track.settings, ...songKey,
        __ivCoreRevision: project.coreRevision || 'legacy-2026-09'};
      if (track.channelMode === 'left') channels = [channels[0]];
      if (track.channelMode === 'right') {
        if (channels.length !== 2) throw new Error('This recording has no right input channel. Choose left or mono.');
        channels = [channels[1]];
      }
      const mono = new Float32Array(channels[0].length);
      for (const channel of channels) for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
      if (channels.length === 2) {
        const originalPeak = Math.max(measure(channels).peak, 1e-12);
        if (measure([mono]).peak < originalPeak * 0.01 && originalPeak > 0.001) {
          throw new Error('This stereo vocal nearly cancels when summed to mono. Import a chosen mono channel or use a Beat/Effect track to preserve stereo; original audio is intact.');
        }
      }
      const result = await this.process('vocal', {samples: mono, rate, settings,
        engine: engines.tune, sound: engines.sound, precision: hasPrecision(clip)?clip.precision:null,
        sections, start: clip.start}, [mono.buffer]);
      channels = [result.samples];
      if (engines.sound === 'legacy') {
        // Allow filter/compressor settling in addition to all declared finite taps.
        const length = result.samples.length + requiredTailFrames(settings, rate) + Math.ceil(rate * 0.1);
        const offline = new OfflineAudioContext(1, length, rate);
        const source = offline.createBufferSource();
        source.buffer = this.buffer(offline, channels, rate);
        const output = legacySound(offline, source, settings);
        output.connect(offline.destination); source.start();
        try { channels = [(await offline.startRendering()).getChannelData(0).slice()]; }
        finally { source.disconnect(); output.disconnect(); }
      }
    }
    const result = {channels, rate};
    if (cacheBytes(this.cache) + channels.reduce((sum, channel) => sum + channel.byteLength, 0) > memoryLimit() / 3) this.cache.clear();
    this.cache.set(key, result);
    return result;
  }

  async analyzePrecision(clip, track, project) {
    if (!clip || track?.kind !== 'vocal') throw new Error('Select a vocal clip first.');
    const {rate, channels: source} = this.region(clip);
    let channels = source;
    if (track.channelMode === 'left') channels = [channels[0]];
    else if (track.channelMode === 'right') { if (channels.length !== 2) throw new Error('This recording has no right input channel.'); channels = [channels[1]]; }
    else if (track.channelMode === 'stereo-dry') throw new Error('Precision Tune requires a mono vocal channel. Choose mono, left, or right first.');
    const mono = new Float32Array(channels[0].length);
    for (const channel of channels) for (let i=0;i<mono.length;i++) mono[i] += channel[i] / channels.length;
    const songKey=track.songKey||{root:project.root,scale:project.scale},sections=track.keySections||project.sections;
    const response = await this.process('precisionAnalyze',{samples:mono,rate,context:{...songKey,sections,start:clip.start}},[mono.buffer]);
    return {...response,clipId:clip.id,rate,duration:clip.duration};
  }

  async prepareLive(project) {
    const tracks = new Map(project.tracks.map(track => [track.id, track]));
    const result = [];
    // Muted tracks are prepared too, allowing live unmute/solo without a restart.
    for (const clip of project.clips) {
      const track = tracks.get(clip.trackId);
      if (!track || clip.muted) continue;
      this.status('Preparing ' + clip.name + '…');
      result.push({c: clip, t: track, a: await this.rendered(clip, track, project)});
      await tick();
    }
    return result;
  }

  liveBus(track, destination) {
    let bus = this.mixBuses.get(track.id);
    if (!bus) {
      const gain = this.ctx.createGain(), pan = this.ctx.createStereoPanner();
      const audible = new Set(audibleTracks(this.playbackProject).map(item => item.id));
      gain.gain.value = audible.has(track.id) ? dbGain(track.gainDb) : 0;
      pan.pan.value = track.pan;
      gain.connect(pan).connect(destination);
      bus = {gain, pan}; this.mixBuses.set(track.id, bus);
    }
    return bus.gain;
  }

  schedule(ctx, {c, t, a}, origin, position, duration, destination) {
    const offset = Math.max(0, position - c.start), delay = Math.max(0, c.start - position);
    const fullLength = a.channels[0].length / a.rate;
    if (offset >= fullLength || delay >= duration) return;
    const source = ctx.createBufferSource(), gain = ctx.createGain();
    source.buffer = this.buffer(ctx, a.channels, a.rate);
    const live = ctx === this.ctx;
    let pan;
    if (live) {
      gain.gain.value = dbGain(c.gainDb);
      source.connect(gain).connect(this.liveBus(t, destination));
      this.nodes.push(source);
    } else {
      pan = ctx.createStereoPanner(); pan.pan.value = t.pan;
      gain.gain.value = dbGain(c.gainDb + t.gainDb);
      source.connect(gain).connect(pan).connect(destination);
    }
    source.onended = () => {
      source.disconnect(); gain.disconnect(); pan?.disconnect();
      if (live) this.nodes = this.nodes.filter(node => node !== source);
    };
    source.start(origin + delay, offset, Math.min(fullLength - offset, duration - delay));
  }

  updateMixer(project) {
    if (!this.playing) return;
    if (!isMixerOnlyChange(this.playbackProject, project)) throw new Error('This edit needs playback to stop.');
    const audible = new Set(audibleTracks(project).map(track => track.id));
    for (const track of project.tracks) {
      const bus = this.mixBuses.get(track.id);
      if (bus) {
        ramp(bus.gain.gain, audible.has(track.id) ? dbGain(track.gainDb) : 0, this.ctx.currentTime);
        ramp(bus.pan.pan, track.pan, this.ctx.currentTime);
      }
    }
    this.playbackProject = copy(project);
  }

  async render(project, {master = false, trackId = null, raw = false} = {}) {
    if (!project.clips.length) throw new Error('Import or record audio first.');
    validateProject(project, this.assets);
    const prepared = await this.prepare(project, trackId, raw), rate = 44100;
    const compatibilityEnd = endTime(project) + 1.5;
    const duration = correctedCore(project)
      ? prepared.reduce((end, item) => Math.max(end, item.c.start + item.a.channels[0].length / item.a.rate), compatibilityEnd)
      : compatibilityEnd;
    if (duration * rate * 8 > memoryLimit() / 2) throw new Error('This render exceeds the safe device memory budget.');
    const offline = new OfflineAudioContext(2, Math.ceil(duration * rate), rate);
    for (const item of prepared) this.schedule(offline, item, 0, 0, duration, offline.destination);
    const buffer = await offline.startRendering();
    let channels = [buffer.getChannelData(0).slice(), buffer.getChannelData(1).slice()];
    if (master) {
      const result = await this.process('master', {channels, rate, project}, channels.map(channel => channel.buffer));
      channels = result.channels;
    }
    this.status('Render ready.');
    return {channels, rate, metrics: measure(channels)};
  }

  async play(project, {recording = false} = {}) {
    this.stopPlayback();
    const generation = ++this.transportGeneration;
    const ctx = await this.init(), snapshot = copy(project);
    validateProject(snapshot, this.assets);
    const prepared = await this.prepareLive(snapshot);
    if (generation !== this.transportGeneration) throw new Error('Playback preparation cancelled.');
    const position = snapshot.loop ? snapshot.loopStart : snapshot.cursor;
    const preparedEnd = correctedCore(snapshot)
      ? prepared.reduce((end, item) => Math.max(end, item.c.start + item.a.channels[0].length / item.a.rate), endTime(snapshot) + 1.5)
      : endTime(snapshot) + 1.5;
    const length = snapshot.loop ? snapshot.loopEnd - snapshot.loopStart : Math.max(0.1, preparedEnd - position);
    const loopBuffers = [];
    if (snapshot.loop) {
      const ids = [...new Set(prepared.map(item => item.t.id))];
      if (length * ctx.sampleRate * 8 * ids.length > memoryLimit() / 3) {
        throw new Error('Per-track loop buffers exceed this device budget. Shorten the loop or reduce active track count.');
      }
      for (const id of ids) {
        const offline = new OfflineAudioContext(2, Math.ceil(length * ctx.sampleRate), ctx.sampleRate);
        for (const item of prepared.filter(value => value.t.id === id)) {
          this.schedule(offline, {...item, t: {...item.t, gainDb: 0, pan: 0}}, 0, position, length, offline.destination);
        }
        loopBuffers.push({track: snapshot.tracks.find(track => track.id === id), buffer: await offline.startRendering()});
        if (generation !== this.transportGeneration) throw new Error('Loop preparation cancelled.');
      }
    }
    this.position = position; this.length = length; this.loop = snapshot.loop;
    this.playbackProject = snapshot;
    this.origin = ctx.currentTime + 0.12 + (recording && snapshot.punch ? Math.max(0, -snapshot.compensationMs / 1000) : 0) + (recording ? snapshot.countIn * 4 * 60 / snapshot.bpm : 0);
    this.playing = true;
    try {
      if (snapshot.loop) {
        for (const item of loopBuffers) {
          const source = ctx.createBufferSource(); source.buffer = item.buffer; source.loop = true;
          source.connect(this.liveBus(item.track, ctx.destination));
          this.nodes.push(source); source.start(this.origin);
        }
      } else {
        for (const item of prepared) this.schedule(ctx, item, this.origin, position, recording ? 21600 : length, ctx.destination);
      }
      if (snapshot.metronome || (recording && snapshot.countIn)) this.startClicks(snapshot, recording);
      this.status(recording ? 'Count-in, then recording…' : 'Playing. Track mixer controls stay live.');
      return this.origin;
    } catch (error) { this.stopPlayback(); throw error; }
  }

  stopPlayback() {
    super.stopPlayback();
    for (const bus of this.mixBuses?.values() || []) { bus.gain.disconnect(); bus.pan.disconnect(); }
    this.mixBuses?.clear();
  }

  async mic(onLevel = () => {}) {
    await super.mic(onLevel);
    if (this.journalCapture === this.capture) return;
    this.journalCapture = this.capture;
    const original = this.capture.port.onmessage;
    this.capture.port.onmessage = event => {
      const data = event.data;
      if (data.type === 'range-ended' && this.recording && !this.stopping && !this.finalizingRecording) {
        queueMicrotask(() => {if (this.recording) this.onAutoStop?.();});
      }
      if (data.type !== 'pcm' || !this.recording) { original(event); return; }
      if (!(data.samples instanceof Float32Array) || data.samples.length > 4096 || !Number.isSafeInteger(data.frame)) return;
      const before = this.chunks.length;
      const gap = Math.max(0, data.frame - this.nextCaptureFrame);
      original(event);
      for (let index = before; index < this.chunks.length; index++) {
        const chunk = this.chunks[index];
        this.writer?.append(chunk, index === before && gap ? chunk.length : 0);
      }
    };
  }

  async record(project, track, onAutoStop) {
    if (this.protectedStart || this.recording || this.finalizingRecording) throw new Error('A recording is already starting or finishing.');
    if (!this.accountId) throw new Error('Sign in before creating a protected recording.');
    validateProject(project, this.assets);
    if (!track || track.kind !== 'vocal' || !project.tracks.some(item => item.id === track.id)) throw new Error('Select a vocal track before recording.');
    if (this.captureFault) throw new Error('A previous capture did not finish safely. Save recovery audio and reload before another take.');
    const requestEpoch = (this.captureRequestEpoch || 0) + 1;
    this.captureRequestEpoch = requestEpoch;
    this.protectedStart = true;
    this.pendingStop = onAutoStop;
    let store;
    try {
      const snapshotId = this.beforeRecord ? await this.beforeRecord(project, track) : null;
      if (requestEpoch !== this.captureRequestEpoch) throw new Error('Recording preparation cancelled.');
      this.releaseRecordingLock = await holdRecordingLock(this.accountId);
      const ctx = await this.init();
      store = new RecordingStore(this.accountId);
      const take = await store.begin({id: uid(), assetId: uid(), rate: ctx.sampleRate, project, track, snapshotId});
      this.writer = new RecordingWriter(store, take, state => {
        this.journalStatus = state; this.onJournalStatus?.(state);
        if (state.failure && this.recording && !this.stopping && !this.finalizingRecording) {
          queueMicrotask(() => { if (this.recording) onAutoStop?.(); });
        }
      });
      if (requestEpoch !== this.captureRequestEpoch) throw new Error('Recording preparation cancelled.');
      await super.record(project, track, onAutoStop);
      this.journalStatus = this.writer.status();
    } catch (error) {
      try { if (this.writer) await this.writer.finish(true); } catch { /* Preserve original startup failure. */ }
      store?.close(); this.writer = null;
      this.releaseRecordingLock?.(); this.releaseRecordingLock = null;
      this.releaseMic(); this.stopPlayback();
      throw error;
    } finally { this.protectedStart = false; this.pendingStop = null; }
  }

  cancelPending() {
    this.captureRequestEpoch = (this.captureRequestEpoch || 0) + 1;
    super.cancelPending();
    // The base generation guard cancels a pending count-in or microphone request.
  }

  async stopRecording() {
    if (this.finalizingRecording) return this.finalizingRecording;
    if (!this.recording) return [];
    const writer = this.writer;
    this.finalizingRecording = (async () => {
      let clips;
      let error;
      try {
        clips = await super.stopRecording();
        if (writer && clips.length) {
          const oldId = clips[0].assetId, audio = this.assets.get(oldId);
          this.assets.delete(oldId); audio.id = writer.take.assetId; this.assets.set(audio.id, audio);
          clips.forEach((clip, index) => {
            clip.id = writer.take.id + '-take-' + index;
            clip.assetId = audio.id; clip.originalAssetId = audio.id;
          });
        }
      } catch (problem) {
        error = problem; this.captureFault = true; this.recording = false; this.releaseMic();
      }
      try {
        if (writer) this.journalStatus = await writer.finish(!!error);
      } catch (problem) {
        this.journalStatus = {...writer?.status(), failure: problem.message};
      } finally {
        writer?.store.close(); this.writer = null;
        this.releaseRecordingLock?.(); this.releaseRecordingLock = null;
      }
      if (error) throw error;
      this.status(this.journalStatus?.failure
        ? 'Take kept in memory, but recovery storage needs attention. Save a project backup now.'
        : 'Take kept. Local recovery chunks retained until you explicitly remove them.');
      return clips || [];
    })();
    try { return await this.finalizingRecording; } finally { this.finalizingRecording = null; }
  }

  async recoveries() {
    if (!this.accountId) throw new Error('Sign in to the recording account first.');
    const store = new RecordingStore(this.accountId);
    try { return await store.list(); } finally { store.close(); }
  }

  async readRecovery(id) {
    const owner = this.accountId;
    if (!owner) throw new Error('Sign in to the recording account first.');
    return withRecordingLock(owner, async () => {
      if (this.accountId !== owner) throw new Error('The recording account changed.');
      const store = new RecordingStore(owner);
      try { return await store.read(id, memoryLimit() / 2); } finally { store.close(); }
    });
  }

  async removeRecovery(id) {
    const owner = this.accountId;
    if (!owner) throw new Error('Sign in to the recording account first.');
    return withRecordingLock(owner, async () => {
      if (this.accountId !== owner) throw new Error('The recording account changed.');
      const store = new RecordingStore(owner);
      try { return await store.remove(id); } finally { store.close(); }
    });
  }

  async close() {
    this.cancelPending();
    if (this.recording) await this.stopRecording();
    for (const request of this.requests.values()) {
      clearTimeout(request.timer); request.reject(new Error('The studio was closed. Original audio and committed recovery chunks remain intact.'));
    }
    this.requests.clear();
    await super.close();
  }
}

export function recoveryProject({take, samples}) {
  const project = newProject();
  project.id = 'recovery-' + take.id;
  project.title = (take.projectTitle + ' · recovered take').slice(0, 120);
  for (const key of ['bpm', 'root', 'scale', 'loopStart', 'loopEnd', 'compensationMs']) project[key] = take[key];
  project.coreRevision = take.coreRevision || 'legacy-2026-09';
  project.cursor = take.cursor; project.loop = take.loop;
  project.notes = 'Dry capture recovered from ' + take.projectId + '. This is a separate recovery project, not a restore of unsaved backing tracks. Missing captured frames: ' + take.missingFrames + '.';
  const track = {...newTrack(take.track.name, 'vocal'), settings: {...take.track.settings}};
  project.tracks.push(track);
  const audio = asset(take.assetId, 'Recovered dry recording', take.rate, [samples]);
  const assets = new Map([[audio.id, audio]]);
  const loopFrames = Math.round((take.loopEnd - take.loopStart) * take.rate);
  if (!Number.isSafeInteger(loopFrames) || loopFrames < 1) throw new Error('Invalid recovered loop boundaries.');
  const stride = take.loop ? loopFrames : samples.length;
  for (let offset = 0, index = 0; offset < samples.length; offset += stride, index++) {
    const length = Math.min(stride, samples.length - offset);
    if (length / take.rate < 0.001) continue;
    const clip = newClip(track.id, audio.id, length / take.rate, 'Recovered take ' + (index + 1),
      take.punch ? take.loopStart : Math.max(0, (take.loop ? take.loopStart : take.cursor) - take.compensationMs / 1000));
    clip.id = take.id + '-take-' + index; clip.offset = offset / take.rate;
    clip.takeGroup = take.id; clip.muted = index > 0;
    project.clips.push(clip);
  }
  validateProject(project, assets);
  return {project, assets};
}

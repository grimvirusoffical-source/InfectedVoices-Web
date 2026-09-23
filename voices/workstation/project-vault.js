import {copy, uid, validateProject} from './model.js';
import {asset, memoryLimit, usedIds} from './files.js';
import {withRecordingLock} from './recording-journal.js';
import {recoveryProject} from './reliable-audio.js';
import {insertPunchTake} from './take-editing.js';

const MAX_SNAPSHOTS = 120;
const AUTO_KEEP = 8;
const encoder = new TextEncoder();
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 180 && !/[\u0000-\u001f]/.test(value);
const hash = async bytes => {
  if (!globalThis.crypto?.subtle) throw new Error('Secure local integrity checks are unavailable. Use HTTPS in a supported browser.');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
};

export async function describeAudio(audio) {
  asset(audio.id, audio.name, audio.rate, audio.channels);
  const hashes = [];
  for (const channel of audio.channels) hashes.push(await hash(channel));
  const metadata = {id: audio.id, name: audio.name, rate: audio.rate, length: audio.length,
    channels: audio.channels.length, hashes};
  return {key: await hash(encoder.encode(JSON.stringify(metadata))), ...metadata};
}

export class ProjectVault {
  constructor(owner) {
    if (!validId(owner)) throw new Error('Sign in to the project account before accessing local snapshots.');
    this.owner = owner; this.db = null; this.durability = 'unmeasured';
  }

  async open() {
    if (this.db) return;
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('infected-voices-project-vault-v1:' + this.owner, 1);
      let settled = false;
      const finish = (error, db) => {
        if (settled) { db?.close(); return; }
        settled = true; clearTimeout(timer); error ? reject(error) : resolve(db);
      };
      const timer = setTimeout(() => finish(new Error('Local snapshot storage did not open. Existing recordings are unchanged.')), 10000);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('audio', {keyPath: 'key'});
        request.result.createObjectStore('snapshots', {keyPath: 'id'});
      };
      request.onsuccess = () => finish(null, request.result);
      request.onerror = () => finish(request.error);
      request.onblocked = () => finish(new Error('Another app window is blocking snapshot storage. Close that window first.'));
    });
    this.db.onversionchange = () => this.close();
  }

  transaction(mode, operation) {
    return new Promise((resolve, reject) => {
      let tx, result, failure;
      try { tx = this.db.transaction(['audio', 'snapshots'], mode, mode === 'readwrite' ? {durability: 'strict'} : undefined); }
      catch (error) {
        if (!(error instanceof TypeError)) { reject(error); return; }
        tx = this.db.transaction(['audio', 'snapshots'], mode);
      }
      if (mode === 'readwrite') this.durability = tx.durability || 'default';
      const timer = setTimeout(() => {
        failure = new Error('Snapshot transaction timed out. The prior snapshot remains available.');
        try { tx.abort(); } catch { reject(failure); }
      }, 20000);
      tx.oncomplete = () => { clearTimeout(timer); resolve(result); };
      tx.onabort = () => { clearTimeout(timer); reject(failure || tx.error || new Error('Snapshot was not committed.')); };
      tx.onerror = () => {};
      const abort = error => { failure = error; try { tx.abort(); } catch { clearTimeout(timer); reject(error); } };
      try { operation(tx.objectStore('audio'), tx.objectStore('snapshots'), value => { result = value; }, abort, tx); }
      catch (error) { abort(error); }
    });
  }

  async save(project, assets, {reason = 'manual', ownerStillCurrent = () => true} = {}) {
    if (!['manual', 'autosave', 'before-record', 'before-update', 'recorded'].includes(reason)) throw new Error('Invalid snapshot reason.');
    const snapshot = copy(project);
    validateProject(snapshot, assets);
    const entries = [...usedIds(snapshot)].map(id => assets.get(id));
    if (entries.reduce((bytes, entry) => bytes + entry.bytes, 0) > memoryLimit()) throw new Error('Snapshot exceeds this device budget. Download a backup on a larger device.');
    const descriptors = [];
    for (const audio of entries) descriptors.push(await describeAudio(audio));
    const text = JSON.stringify(snapshot);
    if (text.length > 4 * 1024 * 1024) throw new Error('Snapshot metadata is too large.');
    const row = {id: uid(), projectId: snapshot.id, title: snapshot.title, created: Date.now(), reason,
      pinned: reason === 'before-record' || reason === 'before-update', project: snapshot,
      projectHash: await hash(encoder.encode(text)), audio: descriptors};
    // Uses the same account lock as recording. Never prune or mutate recovery
    // storage while another tab is writing a take; never steal its lock.
    return withRecordingLock(this.owner, async () => {
      if (!ownerStillCurrent()) throw new Error('The account changed before snapshot commit.');
      await this.open();
      await this.transaction('readwrite', (audioStore, snapshots, result, abort) => {
        const request = snapshots.getAll();
        request.onsuccess = () => {
          try {
            if (!ownerStillCurrent()) throw new Error('The account changed before snapshot commit.');
            const old = request.result;
            const autos = old.filter(item => item.projectId === row.projectId && !item.pinned && item.reason === 'autosave')
              .sort((a, b) => b.created - a.created);
            const remove = reason === 'autosave' ? new Set(autos.slice(AUTO_KEEP - 1).map(item => item.id)) : new Set();
            if (old.length - remove.size >= MAX_SNAPSHOTS) throw new Error('120 project snapshots are retained. Download and explicitly remove older snapshots; pinned pre-record snapshots are never silently pruned.');
            const keep = [...old.filter(item => !remove.has(item.id)), row];
            const used = new Set(keep.flatMap(item => item.audio.map(value => value.key)));
            for (const id of remove) snapshots.delete(id);
            descriptors.forEach((descriptor, index) => {
              const check = audioStore.get(descriptor.key);
              check.onsuccess = () => {
                if (!check.result) audioStore.add({key: descriptor.key, descriptor, channels: entries[index].channels});
              };
            });
            snapshots.add(row);
            const cursor = audioStore.openCursor();
            cursor.onsuccess = () => {
              const item = cursor.result;
              if (item) { if (!used.has(item.key)) item.delete(); item.continue(); }
            };
            result(row);
          } catch (error) { abort(error); }
        };
      });
      return {...row, durability: this.durability};
    });
  }

  async list() {
    await this.open();
    return this.transaction('readonly', (_audio, snapshots, result) => {
      const request = snapshots.getAll();
      request.onsuccess = () => result(request.result.sort((a, b) => b.created - a.created).map(row => ({
        id: row.id, projectId: row.projectId, title: row.title, created: row.created,
        reason: row.reason, pinned: row.pinned, assets: row.audio.length,
        tracks: row.project.tracks.length, clips: row.project.clips.length
      })));
    });
  }

  async read(id) {
    if (!validId(id)) throw new Error('Invalid snapshot identifier.');
    await this.open();
    const data = await this.transaction('readonly', (audio, snapshots, result, abort) => {
      const request = snapshots.get(id);
      request.onsuccess = () => {
        const row = request.result;
        if (!row) { abort(new Error('This project snapshot is not available in this account.')); return; }
        if (!Array.isArray(row.audio) || row.audio.length > 40000 || row.audio.some(d => !Number.isSafeInteger(d.length) || d.length < 1 || ![1, 2].includes(d.channels)) || row.audio.reduce((n, d) => n + d.length * d.channels * 4, 0) > memoryLimit()) {
          abort(new Error('Snapshot exceeds valid audio bounds.')); return;
        }
        let remaining = row.audio.length;
        const records = new Array(remaining);
        if (!remaining) result({row, records});
        row.audio.forEach((descriptor, index) => {
          const item = audio.get(descriptor.key);
          item.onsuccess = () => {
            if (!item.result) { abort(new Error('Snapshot audio is missing. Other snapshots were not replaced.')); return; }
            records[index] = item.result;
            if (!--remaining) result({row, records});
          };
        });
      };
    });
    if (await hash(encoder.encode(JSON.stringify(data.row.project))) !== data.row.projectHash) throw new Error('Project snapshot failed integrity verification.');
    const assets = new Map(); let bytes = 0;
    for (let index = 0; index < data.records.length; index++) {
      const record = data.records[index], descriptor = data.row.audio[index];
      const audio = asset(descriptor.id, descriptor.name, descriptor.rate, record.channels);
      bytes += audio.bytes;
      if (bytes > memoryLimit()) throw new Error('Snapshot exceeds this device memory budget.');
      if ((await describeAudio(audio)).key !== descriptor.key) throw new Error('Snapshot audio failed integrity verification. Stored data is unchanged.');
      assets.set(audio.id, audio);
    }
    const project = validateProject(data.row.project, assets);
    return {project, assets, snapshot: {id: data.row.id, reason: data.row.reason, created: data.row.created}};
  }

  async remove(id) {
    if (!validId(id)) throw new Error('Invalid snapshot identifier.');
    return withRecordingLock(this.owner, async () => {
      await this.open();
      return this.transaction('readwrite', (audio, snapshots, result) => {
        snapshots.delete(id);
        const remaining = snapshots.getAll();
        remaining.onsuccess = () => {
          const used = new Set(remaining.result.flatMap(item => item.audio.map(value => value.key)));
          const request = audio.openCursor();
          request.onsuccess = () => { const item = request.result; if (item) { if (!used.has(item.key)) item.delete(); item.continue(); } };
          result(true);
        };
      });
    });
  }

  close() { this.db?.close(); this.db = null; }
}

export function combineTakeWithSnapshot(saved, recovered) {
  const result = {project: copy(saved.project), assets: new Map(saved.assets)};
  const take = recovered.take;
  if (take.projectId !== result.project.id) throw new Error('The take belongs to a different project snapshot.');
  const originalTrack = result.project.tracks.find(track => track.id === take.track.id);
  if (!originalTrack || originalTrack.kind !== 'vocal') throw new Error('The original vocal track is missing from this snapshot.');
  const vocal = recoveryProject(recovered);
  for (const [id, audio] of vocal.assets) {
    if (result.assets.has(id)) throw new Error('Recovery would replace an existing audio asset. Open the vocal-only recovery instead.');
    result.assets.set(id, audio);
  }
  const existing = new Set(result.project.clips.map(clip => clip.id));
  for (const clip of vocal.project.clips) {
    if (existing.has(clip.id)) throw new Error('This take is already included.');
    const incoming = {...clip, trackId: originalTrack.id};
    if (take.punch) insertPunchTake(result.project, [incoming], take.loopStart, take.loopEnd);
    else result.project.clips.push(incoming);
  }
  result.project.id = uid(); // Never overwrite the saved project during recovery.
  result.project.title = (result.project.title + ' · recovered session').slice(0, 120);
  result.project.modified = Date.now();
  validateProject(result.project, result.assets);
  return result;
}

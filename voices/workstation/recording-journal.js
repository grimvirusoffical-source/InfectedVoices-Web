// Account-scoped, append-only local PCM journal. No network or credential storage.
// Completed IndexedDB transactions are acknowledged; storage eviction and device
// failure still require external backups. This is not a zero-loss guarantee.
const MAX_PENDING_BYTES = 1024 * 1024;
const MAX_TAKES = 100;
const crcTable = Uint32Array.from({length: 256}, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

export function pcmChecksum(samples) {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function identity(value) {
  if (typeof value !== 'string' || !value || value.length > 160 || /[\u0000-\u001f]/.test(value)) {
    throw new Error('A valid signed-in recording account is required.');
  }
  return value;
}

function validPCM(samples) {
  if (!(samples instanceof Float32Array) || !samples.length || samples.byteLength > MAX_PENDING_BYTES) {
    throw new Error('The recording chunk is missing or exceeds the bounded writer queue.');
  }
  for (const sample of samples) if (!Number.isFinite(sample)) throw new Error('Invalid recording sample.');
}

export async function holdRecordingLock(owner) {
  identity(owner);
  if (!globalThis.navigator?.locks?.request) {
    throw new Error('Protected recording needs browser Web Locks. Use a current supported browser; existing files are unchanged.');
  }
  let release;
  let ready;
  let failed;
  const acquired = new Promise((resolve, reject) => { ready = resolve; failed = reject; });
  const held = new Promise(resolve => { release = resolve; });
  const request = navigator.locks.request('iv-recording-v1:' + owner, {mode: 'exclusive', ifAvailable: true}, async lock => {
    if (!lock) {
      failed(new Error('Another window is recording or recovering for this account. Stop it before continuing here. If a tab crashed, close or reload that tab first.'));
      return;
    }
    ready(() => release());
    await held;
  });
  request.catch(failed);
  return acquired;
}

export async function withRecordingLock(owner, operation) {
  const release = await holdRecordingLock(owner);
  try { return await operation(); } finally { release(); }
}

export class RecordingStore {
  constructor(owner) {
    this.owner = identity(owner);
    this.db = null;
    this.durability = 'unmeasured';
  }

  async open() {
    if (this.db) return this;
    if (!globalThis.indexedDB) throw new Error('Local recovery storage is unavailable. Recording has not started.');
    this.db = await new Promise((resolve, reject) => {
      let done = false;
      const request = indexedDB.open('infected-voices-recordings-v1:' + this.owner, 1);
      const timer = setTimeout(() => { done = true; reject(new Error('Opening recording recovery storage timed out.')); }, 10000);
      const finish = (error, database) => {
        if (done) { database?.close(); return; }
        done = true;
        clearTimeout(timer);
        error ? reject(error) : resolve(database);
      };
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('takes', {keyPath: 'id'});
        const chunks = db.createObjectStore('chunks', {keyPath: ['takeId', 'sequence']});
        chunks.createIndex('takeId', 'takeId', {unique: false});
      };
      request.onsuccess = () => finish(null, request.result);
      request.onerror = () => finish(request.error || new Error('Local recording storage failed.'));
      request.onblocked = () => finish(new Error('A different app window blocks recovery storage. Close that window first.'));
    });
    this.db.onversionchange = () => this.close();
    return this;
  }

  transaction(mode, operation) {
    if (!this.db) return Promise.reject(new Error('Recording storage is closed.'));
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = this.db.transaction(['takes', 'chunks'], mode,
          mode === 'readwrite' ? {durability: 'strict'} : undefined);
      } catch (error) {
        if (!(error instanceof TypeError)) { reject(error); return; }
        tx = this.db.transaction(['takes', 'chunks'], mode);
      }
      if (mode === 'readwrite') this.durability = tx.durability || 'default';
      let result;
      let problem;
      const timer = setTimeout(() => {
        problem = new Error('Local recording write timed out. Keep the window open and recover completed chunks.');
        try { tx.abort(); } catch { reject(problem); }
      }, 15000);
      tx.oncomplete = () => { clearTimeout(timer); resolve(result); };
      tx.onabort = () => { clearTimeout(timer); reject(problem || tx.error || new Error('Local recording transaction was interrupted.')); };
      tx.onerror = () => { /* Abort is the authoritative failed-commit event. */ };
      try {
        operation(tx.objectStore('takes'), tx.objectStore('chunks'),
          value => { result = value; }, error => { problem = error; tx.abort(); });
      } catch (error) { problem = error; try { tx.abort(); } catch { clearTimeout(timer); reject(error); } }
    });
  }

  async begin(metadata) {
    await this.open();
    identity(metadata.id);
    if (!Number.isInteger(metadata.rate) || metadata.rate < 8000 || metadata.rate > 192000 || !metadata.project || !metadata.track) {
      throw new Error('Invalid recording recovery metadata.');
    }
    // No PCM, credentials, provider keys or access tokens are stored in metadata.
    const item = structuredClone({id: metadata.id, assetId: metadata.assetId,
      rate: metadata.rate, projectId: metadata.project.id, snapshotId: metadata.snapshotId || null, punch: !!metadata.project.punch,
      projectTitle: String(metadata.project.title).slice(0, 120),
      track: metadata.track, bpm: metadata.project.bpm, root: metadata.project.root,
      scale: metadata.project.scale, coreRevision: metadata.project.coreRevision,
      loop: metadata.project.loop, loopStart: metadata.project.loopStart,
      loopEnd: metadata.project.loopEnd, cursor: metadata.project.cursor,
      compensationMs: metadata.project.compensationMs, created: Date.now(),
      modified: Date.now(), frames: 0, chunks: 0, missingFrames: 0, status: 'recording'});
    return this.transaction('readwrite', (takes, _chunks, result, abort) => {
      const count = takes.count();
      count.onsuccess = () => {
        if (count.result >= MAX_TAKES) { abort(new Error('Recovery storage has 100 retained takes. Back up and remove old takes before recording.')); return; }
        const request = takes.add(item);
        request.onsuccess = () => result(item);
      };
    });
  }

  async append(takeId, sequence, offset, samples, missingFrames = 0) {
    identity(takeId); validPCM(samples);
    if (!Number.isSafeInteger(sequence) || sequence < 0 || !Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(missingFrames) || missingFrames < 0 || missingFrames > samples.length) {
      throw new Error('Invalid recording chunk position.');
    }
    const checksum = pcmChecksum(samples);
    return this.transaction('readwrite', (takes, chunks, result, abort) => {
      const existing = chunks.get([takeId, sequence]);
      existing.onsuccess = () => {
        if (existing.result) {
          const value = existing.result;
          if (value.offset !== offset || value.samples.length !== samples.length || value.checksum !== checksum || value.missingFrames !== missingFrames ||
              !value.samples.every((sample, index) => Object.is(sample, samples[index]))) {
            abort(new Error('A conflicting recording chunk was refused. Existing audio remains intact.'));
          } else result({frames: offset + samples.length, repeated: true});
          return;
        }
        const request = takes.get(takeId);
        request.onsuccess = () => {
          const take = request.result;
          if (!take || take.status !== 'recording' || take.frames !== offset || take.chunks !== sequence) {
            abort(new Error('The recording journal rejected a missing, out-of-order or finalized chunk.'));
            return;
          }
          chunks.add({takeId, sequence, offset, checksum, samples, missingFrames});
          take.frames += samples.length;
          take.chunks++;
          take.missingFrames += missingFrames;
          take.modified = Date.now();
          takes.put(take);
          result({frames: take.frames, chunks: take.chunks, repeated: false});
        };
      };
    });
  }

  async finish(takeId, status = 'complete') {
    if (!['complete', 'interrupted'].includes(status)) throw new Error('Invalid recording completion state.');
    return this.transaction('readwrite', (takes, _chunks, result, abort) => {
      const request = takes.get(takeId);
      request.onsuccess = () => {
        const take = request.result;
        if (!take) { abort(new Error('The recording journal no longer exists.')); return; }
        take.status = status; take.modified = Date.now(); takes.put(take); result(take);
      };
    });
  }

  async list() {
    await this.open();
    return this.transaction('readonly', (takes, _chunks, result) => {
      const request = takes.getAll(null, MAX_TAKES);
      request.onsuccess = () => result(request.result.sort((a, b) => b.created - a.created));
    });
  }

  async read(takeId, maxBytes) {
    identity(takeId);
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 4 || maxBytes > 768 * 1024 * 1024) {
      throw new Error('A bounded recovery memory budget is required.');
    }
    await this.open();
    return this.transaction('readonly', (takes, chunks, result, abort) => {
      const request = takes.get(takeId);
      request.onsuccess = () => {
        const take = request.result;
        if (!take || !Number.isSafeInteger(take.frames) || take.frames < 1 || take.frames * 4 > maxBytes) {
          abort(new Error('This take is empty or exceeds the recovery memory budget on this device.'));
          return;
        }
        const samples = new Float32Array(take.frames);
        const cursor = chunks.index('takeId').openCursor(IDBKeyRange.only(takeId));
        let offset = 0, sequence = 0, missing = 0;
        cursor.onsuccess = () => {
          const position = cursor.result;
          if (!position) {
            if (offset !== take.frames || sequence !== take.chunks || missing !== take.missingFrames) {
              abort(new Error('The recorded take failed its length or gap-integrity check. Stored data was not replaced.'));
            } else result({take, samples});
            return;
          }
          const chunk = position.value;
          if (!(chunk.samples instanceof Float32Array) || chunk.sequence !== sequence || chunk.offset !== offset ||
              chunk.checksum !== pcmChecksum(chunk.samples) || offset + chunk.samples.length > samples.length ||
              !Number.isSafeInteger(chunk.missingFrames) || chunk.missingFrames < 0 || chunk.missingFrames > chunk.samples.length) {
            abort(new Error('A recorded chunk failed integrity verification. Stored data was not changed.'));
            return;
          }
          samples.set(chunk.samples, offset); offset += chunk.samples.length; sequence++;
          missing += chunk.missingFrames; position.continue();
        };
      };
    });
  }

  async remove(takeId) {
    identity(takeId); await this.open();
    return this.transaction('readwrite', (takes, chunks, result) => {
      takes.delete(takeId);
      const request = chunks.index('takeId').openCursor(IDBKeyRange.only(takeId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) { cursor.delete(); cursor.continue(); } else result(true);
      };
    });
  }

  close() { this.db?.close(); this.db = null; }
}

export class RecordingWriter {
  constructor(store, take, onChange = () => {}) {
    this.store = store; this.take = take; this.onChange = onChange;
    this.sequence = 0; this.receivedFrames = 0; this.committedFrames = 0;
    this.pendingBytes = 0; this.failure = null; this.closed = false;
    this.chain = Promise.resolve();
  }

  status() {
    return {id: this.take.id, rate: this.take.rate, receivedFrames: this.receivedFrames,
      committedFrames: this.committedFrames, pendingBytes: this.pendingBytes,
      failure: this.failure?.message || null, durability: this.store.durability,
      retained: true, closed: this.closed};
  }

  append(samples, missingFrames = 0) {
    if (this.closed || this.failure) return false;
    try {
      validPCM(samples);
      if (this.pendingBytes + samples.byteLength > MAX_PENDING_BYTES) {
        throw new Error('Recovery writes fell behind. Recording is stopping; completed local chunks remain recoverable.');
      }
      const copy = samples.slice(), sequence = this.sequence++, offset = this.receivedFrames;
      this.receivedFrames += copy.length; this.pendingBytes += copy.byteLength;
      this.chain = this.chain.then(async () => {
        try {
          if (this.failure) return;
          await this.store.append(this.take.id, sequence, offset, copy, missingFrames);
          this.committedFrames = offset + copy.length;
        } catch (error) { this.failure = error; }
        finally { this.pendingBytes -= copy.byteLength; this.onChange(this.status()); }
      });
      this.onChange(this.status()); return true;
    } catch (error) { this.failure = error; this.onChange(this.status()); return false; }
  }

  async finish(interrupted = false) {
    this.closed = true;
    await this.chain;
    await this.store.finish(this.take.id, interrupted || this.failure ? 'interrupted' : 'complete');
    this.onChange(this.status());
    return this.status();
  }
}

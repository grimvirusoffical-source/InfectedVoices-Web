import {STUDIO_RELEASE} from './release-info.js';

export function validateRelease(value) {
  if (!value || value.product !== STUDIO_RELEASE.product || value.protocol !== 1 ||
      !Number.isSafeInteger(value.sequence) || value.sequence < 1 ||
      typeof value.version !== 'string' || !/^[a-zA-Z0-9.+-]{1,64}$/.test(value.version) ||
      value.projectFormat !== 1 || !Array.isArray(value.notes) || value.notes.length > 20 ||
      value.notes.some(note => typeof note !== 'string' || note.length > 500)) {
    throw new Error('The update feed is invalid or incompatible. No reload or installation occurred.');
  }
  // A feed describes a same-origin website release, never a script/executable URL.
  return {product: value.product, protocol: value.protocol, sequence: value.sequence,
    version: value.version, projectFormat: value.projectFormat, notes: [...value.notes]};
}

export function updateBlocker(state, ownOperation = false) {
  if (state.recording || state.starting || state.finalizing || state.pendingWrites) return 'Finish the current take and its pending writes before updating.';
  if (state.playing) return 'Stop playback before applying the update.';
  if (state.busy && !ownOperation) return 'Finish saving, rendering or exporting before updating.';
  if (state.native) return 'The native application must use its native updater. A website reload cannot install an EXE or mobile binary.';
  return '';
}

export class StudioUpdater {
  constructor({getState, checkpoint, remember, markSaved, navigate, fetcher = (...args) => fetch(...args),
      baseURL = location.href, current = STUDIO_RELEASE}) {
    Object.assign(this, {getState, checkpoint, remember, markSaved, navigate, fetcher, baseURL, current});
    this.available = null; this.checking = false; this.applying = false;
  }

  async check() {
    if (this.checking) throw new Error('An update check is already running.');
    this.checking = true;
    this.available = null;
    try {
      const url = new URL('./releases/studio.json', this.baseURL);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Website update checking is unavailable in this native origin. Use the native updater or protected Downloads page.');
      url.searchParams.set('check', String(Date.now()));
      const response = await this.fetcher(url.href, {cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error('Update check failed (HTTP ' + response.status + '). Your current session is unchanged.');
      const text = await response.text();
      if (text.length > 16384) throw new Error('Update feed is unexpectedly large.');
      const release = validateRelease(JSON.parse(text));
      if (release.sequence < this.current.sequence) throw new Error('The server is advertising an older release. No downgrade was applied.');
      if (release.sequence === this.current.sequence && release.version !== this.current.version) throw new Error('Conflicting release identity. No update was applied.');
      if (release.sequence > this.current.sequence) this.available = release;
      return {release, updateAvailable: !!this.available, current: this.current.version};
    } finally { this.checking = false; }
  }

  async apply(ownOperation = false) {
    if (this.applying) throw new Error('An update is already being prepared.');
    const initial = {...this.getState()};
    const blocked = updateBlocker(initial, ownOperation);
    if (blocked) throw new Error(blocked);
    if (!this.available) throw new Error('Check for a newer release first.');
    const target = this.available;
    this.applying = true;
    try {
      // Recheck the feed. Do not navigate to a stale, removed or changed target.
      const verified = await this.check();
      if (!verified.updateAvailable || verified.release.sequence !== target.sequence || verified.release.version !== target.version) {
        throw new Error('The advertised update changed. Review a fresh update check before proceeding.');
      }
      let saved = null;
      if (initial.owner && initial.hasProject) saved = await this.checkpoint('before-update');
      else if (initial.dirty) throw new Error('Unsaved work has no verified project account. Download recovery before updating.');
      const now = this.getState();
      if (now.owner !== initial.owner || now.projectId !== initial.projectId || now.revision !== initial.revision) {
        throw new Error('The account or project changed while preparing the update. No reload occurred.');
      }
      const laterBlocked = updateBlocker(now, ownOperation);
      if (laterBlocked) throw new Error(laterBlocked);
      if (saved) this.remember(initial.owner, {snapshotId: saved.id, target: target.sequence});
      this.markSaved(saved);
      const destination = new URL(this.baseURL);
      destination.searchParams.set('iv-release', String(target.sequence));
      this.navigate(destination.href);
      return {reloadRequested: true, snapshotId: saved?.id || null, target: target.version};
    } finally { this.applying = false; }
  }
}

const element = (tag, text) => {const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node;};

export function installUpdatesUI({getState, checkpoint, remember, markSaved, run, dialog, openExternal, navigate = url => location.assign(url)}) {
  const updater = new StudioUpdater({getState, checkpoint, remember, markSaved, navigate});
  const button = element('button', 'Updates'); button.id = 'studioUpdates';
  button.setAttribute('aria-label', 'Studio updates');
  document.querySelector('.account-actions').prepend(button);
  function show() {
    if (getState().busy) {const status = document.getElementById('status'); if (status) status.textContent = 'Finish or cancel the current operation before opening Updates.'; return;}
    const content = element('div');
    content.append(element('h3', 'Installed website: ' + STUDIO_RELEASE.version),
      element('p', 'Check this website for a newer release. Applying saves a complete local snapshot, then reloads this window. Recording, playback, saving and export must be stopped. Browser data is never erased.'));
    const status = element('p', 'No update check has run yet.'); status.id = 'updateStatus'; status.setAttribute('role', 'status');
    const check = element('button', 'Check for updates'); check.id = 'checkStudioUpdates';
    const apply = element('button', 'Save session & reload to update'); apply.id = 'applyStudioUpdate'; apply.disabled = true;
    check.onclick = () => run(async () => {
      status.textContent = 'Checking the current release…'; apply.disabled = true;
      try {
        const result = await updater.check();
        status.replaceChildren(element('p', result.updateAvailable ? 'Update available: ' + result.release.version : 'This website is up to date: ' + result.current));
        for (const note of result.release.notes) status.append(element('p', note));
        apply.disabled = !result.updateAvailable || !!getState().native;
      } catch (error) { status.textContent = error.message; }
    });
    apply.onclick = () => {
      const blocked = updateBlocker(getState());
      if (blocked) { status.textContent = blocked; return; }
      if (!confirm('Save a full local recovery snapshot and reload this studio to the checked website release? Other app windows will not be forcibly reloaded.')) return;
      run(async () => {
        apply.disabled = true;
        try { await updater.apply(true); }
        catch (error) { status.textContent = error.message; apply.disabled = !updater.available; }
      });
    };
    content.append(status, check, apply);
    if (getState().native) {
      const native = element('button', 'Check native application updates'); native.id = 'checkNativeUpdates';
      native.onclick = () => run(async () => {
        if (getState().recording || getState().starting || getState().finalizing || getState().playing) throw new Error('Stop the session before checking the native updater.');
        if (typeof window.ivDesktop?.checkForUpdates !== 'function') {
          status.textContent = 'This installed client has no supported native updater bridge. Use protected Downloads; a website update does not replace the installed application.';
          return;
        }
        const result = await window.ivDesktop.checkForUpdates();
        status.textContent = String(result?.message || 'Native updater returned no confirmed installation status.');
      });
      content.append(native);
    }
    const downloads = element('button', 'Open protected Downloads');
    downloads.onclick = () => openExternal(new URL('./#windows', getState().native ? 'https://infectedvoices.space/' : location.href).href);
    content.append(downloads, element('p', 'The feed is served alongside the site, including when hosted on your VPS. It never accepts arbitrary executable URLs. Native signing, store updates and installer channels remain separate.'));
    dialog('Updates · protect your session', content);
  }
  button.onclick = show;
  return {updater, show};
}

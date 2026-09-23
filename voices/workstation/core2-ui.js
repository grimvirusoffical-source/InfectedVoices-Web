import {copy} from './model.js';
import {encodeProject} from './files.js';
import {ProjectVault, combineTakeWithSnapshot} from './project-vault.js';
import {installUpdatesUI} from './updates.js';
import {STUDIO_RELEASE} from './release-info.js';
import {compTakeRange} from './take-editing.js';
import {exportDelivery, exportDeliveryStems} from './export-suite.js';

const element = (tag, text, className = '') => {const node = document.createElement(tag); if (text !== undefined) node.textContent = text; node.className = className; return node;};
const key = owner => 'iv-studio-update-restore:' + owner;

export function installCore2UI({studio, getState, getSelection, selectClip, edit, run, requireStopped,
    replaceProject, saveFile, dialog, closeDialog, markSaved, openExternal}) {
  let checkpointing = null, checkpointRevision = '', restoredOwner = '', restoring = false;
  const section = element('section', undefined, 'engine-bar'); section.id = 'sessionSafety'; section.style.flexWrap = 'wrap';
  section.setAttribute('aria-label', 'Session recovery and delivery tools');
  const save = element('button', 'Save recovery snapshot'); save.id = 'saveSnapshot';
  const history = element('button', 'Project recovery'); history.id = 'projectRecovery';
  const exportButton = element('button', 'Export WAV / stems'); exportButton.id = 'deliveryExport';
  const comp = element('button', 'Comp takes'); comp.id = 'compTakes';
  const status = element('span', 'Full-session snapshots are local to this account, browser and address.', 'fine'); status.id = 'snapshotStatus'; status.style.flexBasis = '100%';
  section.append(save, history, exportButton, comp, status);
  document.getElementById('recordingSafety').after(section);

  function owner() {
    const state = getState();
    if (!state.owner || state.owner !== studio.accountId) throw new Error('Sign in to the same project account to access recovery.');
    return state.owner;
  }
  function stopped() {
    requireStopped();
    if (studio.playing) throw new Error('Stop playback before opening this tool.');
  }
  async function usingVault(account, operation) {
    const vault = new ProjectVault(account);
    try { return await operation(vault); } finally { vault.close(); }
  }

  async function checkpoint(reason = 'manual') {
    const state = getState(), account = owner();
    if (studio.recording || studio.finalizingRecording) throw new Error('Finish the current take before saving a whole-project snapshot. The take journal remains active.');
    if (checkpointing) {
      await checkpointing;
      if (getState().owner !== account) throw new Error('The project account changed.');
    }
    const project = copy(state.project), assets = new Map(studio.assets);
    const signature = account + ':' + project.id + ':' + state.revision;
    status.textContent = 'Saving arrangement and source audio…';
    checkpointing = usingVault(account, vault => vault.save(project, assets, {reason,
      ownerStillCurrent: () => getState().owner === account}));
    try {
      const result = await checkpointing;
      if (getState().owner === account) {
        checkpointRevision = signature;
        status.textContent = 'Snapshot stored locally · ' + new Date(result.created).toLocaleTimeString() + ' · ' + result.audio.length + ' audio assets · ' + reason + '. External backups still required.';
      }
      return result;
    } catch (error) { status.textContent = 'Snapshot not saved: ' + error.message; throw error; }
    finally { checkpointing = null; }
  }
  studio.beforeRecord = () => checkpoint('before-record').then(row => row.id);
  save.onclick = () => run(async () => {stopped(); await checkpoint();});

  async function showHistory() {
    stopped(); const account = owner();
    const rows = await usingVault(account, vault => vault.list());
    const takes = await studio.recoveries();
    if (owner() !== account) throw new Error('The project account changed.');
    const content = element('div');
    content.append(element('p', 'Snapshots retain the arrangement and its referenced source audio. Before each new take, the backing session is saved and linked to the recording journal. Opening recovery creates a separate project. Old Core 1 takes without a linked snapshot remain vocal-only recoveries.', 'dialog-note'));
    const snapshotIds = new Set(rows.map(row => row.id));
    for (const take of takes.filter(item => item.frames && item.snapshotId && snapshotIds.has(item.snapshotId))) {
      const card = element('article', undefined, 'dialog-card');
      card.append(element('h3', take.projectTitle + ' · session + recorded take'), element('p', (take.frames / take.rate).toFixed(2) + ' seconds acknowledged · ' + take.status));
      const recover = element('button', 'Recover full session + take'); recover.dataset.take = take.id;
      recover.onclick = () => run(async () => {
        stopped(); if (owner() !== account) throw new Error('Account changed.');
        if (getState().dirty && !confirm('Replace the view with a separate recovered session? Save or download the current unsaved session first.')) return;
        const saved = await usingVault(account, vault => vault.read(take.snapshotId));
        const recovered = await studio.readRecovery(take.id);
        if (owner() !== account) throw new Error('Account changed.');
        replaceProject(combineTakeWithSnapshot(saved, recovered)); closeDialog();
      });
      card.append(recover); content.append(card);
    }
    if (!rows.length) content.append(element('p', 'No full-project snapshots for this account yet.'));
    for (const row of rows) {
      const card = element('article', undefined, 'dialog-card'); card.dataset.snapshot = row.id;
      card.append(element('h3', row.title), element('p', new Date(row.created).toLocaleString() + ' · ' + row.reason + ' · ' + row.tracks + ' tracks / ' + row.clips + ' clips' + (row.pinned ? ' · pinned until explicit deletion' : '')));
      const load = element('button', 'Open snapshot copy');
      load.onclick = () => run(async () => {
        stopped(); if (owner() !== account) throw new Error('Account changed.');
        if (getState().dirty && !confirm('Open this snapshot as a separate copy? Save or download current unsaved edits first.')) return;
        const result = await usingVault(account, vault => vault.read(row.id));
        if (owner() !== account) throw new Error('Account changed.');
        result.project.id = crypto.randomUUID(); result.project.title = (result.project.title + ' · snapshot copy').slice(0, 120);
        replaceProject(result); closeDialog();
      });
      const download = element('button', 'Download snapshot project');
      download.onclick = () => run(async () => {
        if (owner() !== account) throw new Error('Account changed.');
        const result = await usingVault(account, vault => vault.read(row.id));
        if (owner() !== account) throw new Error('Account changed.');
        await saveFile(encodeProject(result.project, result.assets), 'Infected-Voices-snapshot-' + row.id + '.ivproject');
      });
      const remove = element('button', 'Delete snapshot');
      remove.onclick = () => run(async () => {
        stopped(); if (owner() !== account) throw new Error('Account changed.');
        if (!confirm('Permanently delete this local project snapshot? Linked take recovery may lose its backing session. Separate saved projects and vocal journals are not deleted. Download a backup first.')) return;
        await usingVault(account, vault => vault.remove(row.id)); card.remove();
      });
      card.append(load, download, remove); content.append(card);
    }
    dialog('Full-session recovery · this device', content);
  }
  history.onclick = () => run(showHistory);

  function choice(label, options, value, onChange) {
    const wrapper = element('label', label, 'field'), input = element('select'); input.setAttribute('aria-label', label);
    for (const [v, text] of options) {const option = element('option', text); option.value = v; input.append(option);}
    input.value = String(value); input.onchange = () => onChange(input.value); wrapper.append(input); return wrapper;
  }
  function toggle(label, value, onChange) {
    const wrapper = element('label', undefined, 'field'), input = element('input'); input.type = 'checkbox'; input.checked = value; input.setAttribute('aria-label', label);
    input.onchange = () => onChange(input.checked); wrapper.append(input, document.createTextNode(' ' + label)); return wrapper;
  }

  function showExport() {
    stopped(); const state = getState(), captured = copy(state.project), account = owner();
    const content = element('div');
    const options = {rate: 48000, bits: 24, master: false, channels: 'stereo', range: 'full', tails: true, dither: false};
    let controller = null;
    content.append(element('p', 'Exports do not overwrite recordings. 32-bit float is an unmastered handoff. Rate conversion uses the browser renderer; existing master engines remain sample-peak/RMS-based, not newly certified loudness mastering.', 'dialog-note'));
    content.append(choice('Sample rate', [['44100', '44.1 kHz'], ['48000', '48 kHz'], ['96000', '96 kHz']], options.rate, value => {options.rate = Number(value);}));
    content.append(choice('WAV format', [['16', '16-bit PCM'], ['24', '24-bit PCM'], ['32', '32-bit float · unmastered']], options.bits, value => {options.bits = Number(value);}));
    content.append(choice('Output channels', [['stereo', 'Stereo'], ['left', 'Left only'], ['right', 'Right only'], ['mono', 'Mono sum']], options.channels, value => {options.channels = value;}));
    content.append(choice('Export range', [['full', 'Full arrangement'], ['loop', 'A-B selection']], options.range, value => {options.range = value;}));
    content.append(toggle('Include effects tails', true, value => {options.tails = value;}));
    content.append(toggle('Apply selected master engine', false, value => {options.master = value;}));
    content.append(toggle('TPDF dither for integer PCM', false, value => {options.dither = value;}));
    const progress = element('p', 'Choose a delivery format.'); progress.id = 'deliveryStatus'; progress.setAttribute('role', 'status');
    const render = element('button', 'Export selected WAV'); render.id = 'exportSelectedWav';
    const stems = element('button', 'Export aligned unmastered stems'); stems.id = 'exportDeliveryStems';
    const cancel = element('button', 'Cancel export'); cancel.id = 'cancelDelivery'; cancel.disabled = true;
    const start = async kind => {
      stopped();
      if (owner() !== account || getState().revision !== state.revision) throw new Error('The project changed. Reopen the export panel.');
      const selectedOptions = {...options};
      controller = new AbortController(); cancel.disabled = false; render.disabled = stems.disabled = true;
      try {
        const control = {signal: controller.signal, progress: text => {progress.textContent = text;}};
        const output = kind === 'stems' ? await exportDeliveryStems(studio, captured, selectedOptions, control) : await exportDelivery(studio, captured, selectedOptions, control);
        if (owner() !== account) throw new Error('Account changed before export.');
        const name = captured.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'Infected-Voices';
        await saveFile(output.blob, name + (kind === 'stems' ? '-stems.zip' : '-' + selectedOptions.rate + 'Hz-' + selectedOptions.bits + 'bit.wav'));
        progress.textContent = kind === 'stems' ? 'Aligned stems and session metadata exported.' : 'WAV exported · ' + output.frames + ' frames · ' + output.rate + ' Hz · ' + (output.floatingPoint ? '32-bit float' : output.bits + '-bit PCM');
      } catch (error) { progress.textContent = error.message; }
      finally { controller = null; cancel.disabled = true; render.disabled = stems.disabled = false; }
    };
    render.onclick = () => run(() => start('mix'));
    stems.onclick = () => run(() => start('stems'));
    cancel.onclick = () => {controller?.abort(); progress.textContent = 'Cancellation requested. No file will be finalized; an active browser render may need to finish first.';};
    content.append(progress, render, stems, cancel);
    dialog('Delivery export', content);
  }
  exportButton.onclick = () => run(showExport);

  function showComp() {
    stopped(); const project = getState().project;
    const selected = project.clips.find(clip => clip.id === getSelection().clip);
    const choices = selected?.takeGroup ? project.clips.filter(clip => clip.trackId === selected.trackId && clip.takeGroup === selected.takeGroup) : [];
    if (choices.length < 2) throw new Error('Select a clip from a loop-recorded group with alternate takes, then open Comp takes.');
    let chosen = selected.id, start = Math.max(project.loopStart, selected.start), end = Math.min(project.loopEnd, selected.start + selected.duration);
    if (end <= start) {start = selected.start; end = selected.start + selected.duration;}
    const content = element('div');
    content.append(element('p', 'Choose which take supplies this phrase. Only this take group and track change; other tracks and original audio are preserved. Undo restores the selection.'));
    content.append(choice('Take for selected phrase', choices.map(clip => [clip.id, clip.name + ' · source ' + clip.offset.toFixed(2) + ' s']), chosen, value => {chosen = value;}));
    for (const label of ['Phrase start / seconds', 'Phrase end / seconds']) {
      const field = element('label', label, 'field'), input = element('input'); input.type = 'number'; input.min = '0'; input.step = '0.001'; input.value = String(label.startsWith('Phrase start') ? start : end); input.setAttribute('aria-label', label);
      input.onchange = () => {if (label.startsWith('Phrase start')) start = Number(input.value); else end = Number(input.value);}; field.append(input); content.append(field);
    }
    const use = element('button', 'Use this take for the phrase'); use.id = 'applyTakeComp';
    use.onclick = () => run(() => {edit(next => {const id = compTakeRange(next, chosen, start, end); if (id) selectClip(id);}); closeDialog();});
    content.append(use); dialog('Comp alternate takes', content);
  }
  comp.onclick = () => run(showComp);

  const updates = installUpdatesUI({getState, checkpoint,
    remember: (account, value) => sessionStorage.setItem(key(account), JSON.stringify(value)),
    markSaved: row => {if (row) markSaved();}, run, dialog, openExternal});

  async function restoreAfterUpdate() {
    const account = getState().owner;
    if (!account || restoredOwner === account || restoring) return;
    restoring = true;
    try {
      const text = sessionStorage.getItem(key(account));
      if (!text) {restoredOwner = account; return;}
      const pending = JSON.parse(text);
      if (getState().dirty || getState().project.clips.length) return;
      const saved = await usingVault(account, vault => vault.read(pending.snapshotId));
      if (getState().owner !== account) return;
      if (getState().dirty || getState().project.clips.length) return;
      replaceProject(saved); sessionStorage.removeItem(key(account)); restoredOwner = account;
      status.textContent = pending.target === STUDIO_RELEASE.sequence
        ? 'Updated website loaded; your complete session snapshot was restored.'
        : 'Your session was restored, but the requested website version was not verified. Check Updates again; no native installation is claimed.';
    } catch (error) { status.textContent = 'Update recovery needs attention: ' + error.message; }
    finally { restoring = false; }
  }

  function refresh() {
    const state = getState();
    section.hidden = !state.owner;
    save.disabled = history.disabled = comp.disabled = exportButton.disabled = !!state.recording || !!state.starting || !!state.finalizing;
  }
  const timer = setInterval(() => {
    const state = getState(), signature = state.owner + ':' + state.projectId + ':' + state.revision;
    if (!state.owner || !state.dirty || !state.hasProject || state.recording || state.starting || state.finalizing || state.busy || checkpointing || signature === checkpointRevision) return;
    checkpoint('autosave').catch(() => {});
  }, 15000);
  refresh();
  return {refresh, checkpoint, restoreAfterUpdate, showHistory, showExport, updates, dispose: () => clearInterval(timer)};
}

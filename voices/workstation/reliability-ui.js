import {CORE_REVISION, COMPAT_REVISION} from './reliability-schema.js';
import {recoveryProject} from './reliable-audio.js';
import {wav} from './files.js';

function element(tag, text, className = '') {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  node.className = className;
  return node;
}

export function installReliabilityUI({studio, getProject, getUser, isDirty,
    edit, run, requireAccess, replaceProject, saveFile, dialog, closeDialog}) {
  const section = element('section', undefined, 'engine-bar');
  section.id = 'recordingSafety';
  section.setAttribute('aria-label', 'Core reliability and local recording recovery');
  section.style.flexWrap = 'wrap';
  const label = element('label', 'Core revision');
  const revision = element('select'); revision.setAttribute('aria-label', 'Core revision');
  for (const [value, text] of [[CORE_REVISION, 'Core Reliability 1'], [COMPAT_REVISION, 'Original compatibility']]) {
    const option = element('option', text); option.value = value; revision.append(option);
  }
  label.append(revision); section.append(label);
  const info = element('button', 'About these changes');
  info.onclick = () => dialog('Core Reliability 1', [
    element('p', 'New sessions use corrected zero-wet delay, complete configured echo taps and accurate minimum-gap timing. Existing sessions keep their original sound until you change Core revision.'),
    element('p', 'Track gain, pan, mute and solo can change without stopping playback. Effects and structural edits still require rebuilding audio. Classic Studio, accounts and memberships are unchanged.'),
    element('p', 'Arrangement recordings are journaled locally to this signed-in account. Only completed storage transactions count as written. Pending chunks, a final microphone buffer, browser-data deletion, storage eviction and hardware failure can still lose audio. Download external backups.'),
    element('p', 'This is the first reliability increment, not a new pitch editor, certified mastering engine, native audio driver, automatic hosting migration or completed producer-grade release.')
  ]);
  section.append(info);
  const open = element('button', 'Recovered takes'); open.id = 'recoveredTakes';
  open.onclick = () => run(showRecovery); section.append(open);
  const status = element('span', 'Local recording recovery is ready after sign-in.', 'fine');
  status.id = 'journalStatus'; status.style.flexBasis = '100%'; section.append(status);
  document.getElementById('engines').after(section);
  const wall = element('button', 'Recover this account’s recorded takes');
  wall.id = 'recoverAccountTakes'; wall.hidden = true; wall.onclick = () => run(showRecovery);
  document.getElementById('recovery').after(wall);

  revision.onchange = () => run(() => {
    const chosen = revision.value;
    if (chosen === (getProject().coreRevision || COMPAT_REVISION)) return;
    if (!confirm('Change this project’s processing revision? The sound and timing results may differ. Source recordings are preserved and Undo restores the previous choice.')) {
      refresh(); return;
    }
    edit(project => { project.coreRevision = chosen; });
  });

  function account() {
    const user = getUser();
    if (!user || studio.accountId !== user.userId) throw new Error('Sign in to the same recording account before opening local recoveries.');
    return user.userId;
  }

  function updateStatus() {
    const state = studio.journalStatus;
    if (state?.failure) {
      status.textContent = 'Recovery write failed: ' + state.failure + ' Keep this window open and save a backup.';
      status.setAttribute('role', 'alert'); return;
    }
    status.removeAttribute('role');
    if (!state) {
      status.textContent = 'Protected dry capture · local account-scoped chunks · external backups still required.';
      return;
    }
    const seconds = (state.committedFrames / state.rate).toFixed(2);
    const pending = ((state.pendingBytes || 0) / 1024).toFixed(0);
    status.textContent = seconds + ' seconds written locally · ' + pending + ' KB pending · ' +
      (state.durability === 'strict' ? 'strict durability requested' : 'browser-default durability') +
      (state.closed ? ' · recovery retained' : ' · recording');
  }

  function refresh() {
    revision.value = getProject().coreRevision || COMPAT_REVISION;
    revision.disabled = !!studio.recording || !!studio.protectedStart || !!studio.finalizingRecording;
    const user = getUser();
    wall.hidden = !user || studio.accountId !== user.userId;
    open.disabled = !user || !!studio.recording || !!studio.protectedStart || !!studio.finalizingRecording;
    updateStatus();
  }

  async function showRecovery() {
    const owner = account();
    if (studio.recording || studio.protectedStart || studio.finalizingRecording) throw new Error('Finish the current recording before recovering another take.');
    const rows = await studio.recoveries();
    if (account() !== owner) throw new Error('The recording account changed.');
    const content = element('div', undefined, 'file-list');
    content.append(element('p', 'These are recorded chunks on this device for this account—not cloud backups. Recovery opens a separate project containing the captured vocal; it cannot recreate unsaved backing tracks.', 'dialog-note'));
    if (!rows.length) content.append(element('p', 'No retained recording recoveries for this account on this device.'));
    for (const row of rows) {
      const entry = element('article', undefined, 'dialog-card');
      entry.append(element('strong', row.projectTitle + ' · ' + row.track.name),
        element('p', new Date(row.created).toLocaleString() + ' · ' + (row.frames / row.rate).toFixed(2) +
          ' seconds stored · ' + row.status + (row.missingFrames ? ' · ' + row.missingFrames + ' missing frames marked as silence' : '')));
      const actions = element('div', undefined, 'dialog-actions');
      const load = element('button', 'Open recovery project'); load.disabled = !row.frames;
      load.onclick = () => run(async () => {
        if (account() !== owner) throw new Error('The recording account changed.');
        requireAccess();
        if (isDirty() && !confirm('Open this recovery as a separate project? Save or download your current unsaved project first.')) return;
        const data = await studio.readRecovery(row.id);
        if (account() !== owner) throw new Error('The recording account changed.');
        replaceProject(recoveryProject(data)); closeDialog();
      });
      const download = element('button', 'Download recovered WAV'); download.disabled = !row.frames;
      download.onclick = () => run(async () => {
        if (account() !== owner) throw new Error('The recording account changed.');
        const data = await studio.readRecovery(row.id);
        if (account() !== owner) throw new Error('The recording account changed.');
        await saveFile(wav([data.samples], data.take.rate, 24), 'Infected-Voices-recovered-' + row.id + '.wav');
      });
      const remove = element('button', 'Delete local recovery');
      remove.onclick = () => run(async () => {
        if (account() !== owner) throw new Error('The recording account changed.');
        if (!confirm('Permanently delete this local recovery take? This cannot be undone. Save an external WAV or project backup first. Separate saved projects are not deleted.')) return;
        await studio.removeRecovery(row.id); entry.remove();
      });
      actions.append(load, download, remove); entry.append(actions); content.append(entry);
    }
    dialog('Recorded takes · local recovery', content);
  }
  studio.onJournalStatus = updateStatus;
  refresh();
  return {refresh, updateStatus};
}

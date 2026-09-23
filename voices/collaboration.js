import {request, session, node, action, op, report, StudioEvents, auth, acceptNativeSession} from './api.js';
import {copy, uid} from './workstation/model.js';
import {wav, download, memoryLimit} from './workstation/files.js';
import {ownContribution, fingerprint, normalizeOwnEdit, mergeRemote, scopedHistory, encodePCM, decodePCM, digest, sharedKeys} from './collab-model.js';
import {VoiceChat} from './voice.js';
const $ = id => document.getElementById(id);
const LABELS = {'in-studio': 'In studio', away: 'Away from studio', 'online-elsewhere': 'Online · not in this studio', offline: 'Offline'};

function input(label, type = 'text', value = '') {
  const box = node('label', label, 'collab-field'), field = node('input');
  field.type = type; field.value = value; field.autocomplete = 'off';
  box.append(field); return {box, field};
}
function section(title, ...children) {const s = node('section', undefined, 'collab-card'); s.append(node('h3', title), ...children); return s;}
function privateLinkText() {return 'Only share this link with the invited artist. It grants a guest seat without proving ownership of the destination email.';}

export async function invitationGate() {
  const parts = new URLSearchParams(location.hash.slice(1));
  const secret = parts.get('invite') || sessionStorage.getItem('iv-pending-invitation');
  if (!secret) return false;
  sessionStorage.setItem('iv-pending-invitation', secret);
  history.replaceState(null, '', location.pathname);
  let preview;
  try {preview = await request('/api/invitation', {action: 'preview', token: secret});}
  catch (e) {sessionStorage.removeItem('iv-pending-invitation'); report(e); return false;}
  const dialog = node('dialog', undefined, 'collab-invite-dialog');
  document.body.append(dialog);
  const s = await session();
  dialog.append(node('p', 'YOU HAVE BEEN INVITED', 'eyebrow'), node('h1', preview.title || 'Infected Voices collaboration'), node('p', 'Join ' + preview.creator + ' in a two-artist studio. You can only edit your own tracks. Shared audio is uploaded to this private collaboration server.'), node('p', privateLinkText(), 'fine'));
  const temporary = input('Temporary room username', 'text', ''); temporary.field.maxLength = 30;
  const consent = node('label', undefined, 'collab-check'), check = node('input'); check.type = 'checkbox';
  consent.append(check, document.createTextNode('I agree to share my uploaded audio with this collaborator and have permission to use it.'));
  dialog.append(temporary.box, consent);
  const accept = async useAccount => {
    if (!check.checked) throw Error('Confirm audio-sharing consent first.');
    const result = await request('/api/invitation', {action: 'respond', token: secret, accept: true, useAccount, temporaryUsername: temporary.field.value.trim()});
    acceptNativeSession(result);
    sessionStorage.removeItem('iv-pending-invitation');
    sessionStorage.setItem('iv-room', result.roomId);
    await session(); dialog.close(); dialog.remove(); location.hash = 'room=' + result.roomId; return result;
  };
  const error = node('p', '', 'error'); error.setAttribute('role', 'alert');
  let resolveGate;
  const wait = new Promise(r => {resolveGate = r;});
  const doAccept = async existing => {try {await accept(existing); resolveGate(true);} catch (e) {error.textContent = e.message;}};
  dialog.append(action('Accept with temporary username', () => doAccept(false), 'primary'));
  if (s.user?.kind === 'account') dialog.append(action('Accept as ' + s.user.username, () => doAccept(true)));
  else dialog.append(action('Use my Google account instead', () => auth.signIn()));
  dialog.append(action('Decline invitation', async () => {
    await request('/api/invitation', {action: 'respond', token: secret, accept: false});
    sessionStorage.removeItem('iv-pending-invitation'); dialog.replaceChildren(node('h2', 'Invitation declined'), node('p', 'The creator has been notified.'), action('Continue', () => {dialog.close(); dialog.remove(); resolveGate(false);}));
  }), error);
  dialog.addEventListener('cancel', e => e.preventDefault()); dialog.showModal();
  return wait;
}

export class CollaborationUI {
  constructor(bridge, user) {
    this.bridge = bridge; this.user = user; this.clientId = crypto.randomUUID();
    this.state = null; this.version = 0; this.connected = false; this.pending = false;
    this.synced = ''; this.syncing = null; this.refreshing = null; this.fetchAgain = false;
    this.inflight = null; this.conflict = false; this.uploaded = new Set(); this.remoteRevision = -1;
    this.panel = node('aside', undefined, 'collab-panel'); this.panel.hidden = true; this.panel.setAttribute('aria-label', 'People and collaboration'); document.body.append(this.panel);
    this.events = new StudioEvents('/api/stream?client=' + this.clientId);
    this.events.addEventListener('ready', () => {this.connected = true; this.badge(); this.sendPresence().catch(report); if (this.state) this.refresh().catch(report);});
    this.events.addEventListener('error', () => {this.connected = false; this.badge();});
    this.events.addEventListener('room.changed', e => {const v = JSON.parse(e.data); if (v.roomId === this.state?.roomId) this.refresh().catch(report);});
    this.events.addEventListener('presence', e => {const v = JSON.parse(e.data); if (v.roomId === this.state?.roomId) this.presence(v.presence);});
    this.events.addEventListener('notices', e => {this.notices = JSON.parse(e.data).items; this.drawNotices();});
    this.events.addEventListener('signal', e => {const signal = JSON.parse(e.data); if (signal.roomId === this.state?.roomId) this.receiveSignal(signal).catch(report);});
    this.presenceTimer = setInterval(() => this.sendPresence().catch(() => {}), 12000);
    this.cursorTimer = setInterval(() => {if (this.state && this.bridge.transport().playing) this.sendPresence().catch(() => {});}, 1500);
    $('peopleButton').onclick = () => {this.panel.hidden = !this.panel.hidden; if (!this.panel.hidden) this.show().catch(report);};
    $('voiceButton').onclick = () => this.toggleVoice().catch(report);
    $('collabSave').onclick = () => this.save().catch(report);
    $('collabExit').onclick = () => this.exitDialog();
    $('collabTour').onclick = () => this.tour();
    window.addEventListener('iv-native-background', () => {this.voice?.disable();this.sendPresence().catch(() => {});});
    document.addEventListener('visibilitychange', () => {if(document.hidden)this.voice?.disable();this.sendPresence().catch(() => {});});
    window.addEventListener('pagehide', () => {this.voice?.disable(); this.events.close(); clearInterval(this.presenceTimer); clearInterval(this.cursorTimer);});
  }
  badge(message) {
    const status = !this.state ? 'Solo project · local audio' : this.state.closed ? 'Collab complete · Universe delivery pending' : this.conflict ? 'Version conflict · keep local backup' : this.pending ? 'Sharing draft… not explicitly saved' : this.connected ? 'Live connection · draft synchronized' : 'Disconnected · edits stay on this device';
    $('liveState').textContent = message || status;
    $('liveState').dataset.live = String(this.connected);
    $('collabSave').disabled = !this.state || this.state.closed;
    $('collabExit').disabled = !this.state;
    $('voiceButton').disabled = !this.state || this.state.closed;
    $('voiceButton').textContent = this.voice?.enabled ? 'Voice chat on · turn off' : 'Voice chat off';
  }
  hooks() {
    return {
      userId: this.user.id,
      canEdit: track => !!track && track.ownerId === this.user.id && !this.state.closed,
      beforeEdit: (before, next, selected) => {
        if (this.state.closed) throw Error('The completed collaboration is read-only. Download a project backup.');
        if (this.conflict) throw Error('Resolve the version conflict before editing. Your current draft remains available for backup.');
        normalizeOwnEdit(before, next, this.user.id, this.state.creatorId, selected);
      },
      mergeHistory: (current, next) => scopedHistory(current, next, this.user.id, this.state.creatorId),
      changed: () => {this.pending = fingerprint(this.bridge.project(), this.user.id, this.state.creatorId) !== this.synced; this.badge(); clearTimeout(this.debounce); this.debounce = setTimeout(() => this.sync().catch(report), 220);},
      decorate: () => this.decorate(),
      beforeRecord: () => this.voice?.setRecording(true),
      transport: value => {this.voice?.setRecording(value.recording); if (this.lastRecording !== value.recording) {this.lastRecording = value.recording; this.sendPresence().catch(() => {}); if (!value.recording && this.fetchAgain) this.refresh().catch(report);}},
      selection: () => this.sendPresence().catch(() => {}),
      logout: async () => {await this.voice?.disable(); this.events.close(); this.bridge.setCollaboration(null);}
    };
  }
  decorate() {
    if (!this.state) return;
    const t = this.bridge.project().tracks.find(t => t.id === this.bridge.selection().trackId);
    const foreign = !!t && t.ownerId !== this.user.id;
    // Keep help, audition and exports available. Mutating partner controls are locked.
    for (const row of document.querySelectorAll('[data-track-id]')) {
      const track = this.bridge.project().tracks.find(t => t.id === row.dataset.trackId);
      row.querySelectorAll('button').forEach(b => {b.disabled = track?.ownerId !== this.user.id;});
    }
    for (const id of ['root', 'scale', 'soundEngine', 'tuneEngine', 'record']) $(id).disabled = foreign || this.state.closed;
    for (const id of ['bpm', 'title']) $(id).disabled = this.user.id !== this.state.creatorId || this.state.closed;
    $('newProject').disabled = true; $('openProject').disabled = true; $('openSaved').disabled = true; $('importClassic').disabled = true;
    const inspector = $('inspectorBody');
    if (foreign) {
      const warning = node('p', 'Partner track · settings are read-only. Select your track to edit.', 'ownership-note'); inspector.prepend(warning);
      inspector.querySelectorAll('input,select').forEach(n => {n.disabled = true;});
    }
  }
  async init() {
    const id = new URLSearchParams(location.hash.slice(1)).get('room') || sessionStorage.getItem('iv-room');
    if (id) {try {await this.join(id);} catch (e) {sessionStorage.removeItem('iv-room'); report(e);}}
  }
  async show() {
    this.panel.hidden = false; this.panel.replaceChildren();
    const top = node('div', undefined, 'collab-top'); top.append(node('h2', 'People'), action('Close', () => {this.panel.hidden = true;})); this.panel.append(top);
    this.noticeBox = node('section'); this.panel.append(this.noticeBox); this.drawNotices();
    if (!this.state) {
      this.panel.append(section('Create a collaboration', node('p', 'Two artists. Your current arrangement becomes your contribution. Shared audio uploads only after your consent.'), action('Create from this project', () => this.createDialog(), 'primary')));
      const rooms = await request('/api/rooms');
      const list = section('Your collaborations');
      for (const room of rooms.items) list.append(action(room.title + (room.closed ? ' · completed' : ' · open'), () => this.join(room.id)));
      if (!rooms.items.length) list.append(node('p', 'No collaborations yet.'));
      this.panel.append(list); return;
    }
    this.panel.append(node('p', this.state.project.title, 'collab-title'));
    this.memberBox = node('section', undefined, 'collab-card'); this.memberBox.append(node('h3', 'Artists')); this.panel.append(this.memberBox);
    this.syncBox = section('Connection and drafts', node('p', 'Live edits are provisional. Save explicitly to commit your contribution.'), action('Retry synchronization', async () => {await this.sync(); await this.refresh();}), action('Download recovery project', () => this.bridge.saveBackup()));
    if (this.conflict) this.syncBox.append(action('Reload server version after backing up', async () => {if (!confirm('Your local unsynced edits will be replaced. Download a recovery project first. Continue?')) return; this.inflight = null; this.pending = false; this.conflict = false; this.synced = ''; await this.refresh(true);}));
    this.panel.append(this.syncBox);
    if (this.user.id === this.state.creatorId && this.state.members.length < 2 && !this.state.closed) this.panel.append(this.inviteForm());
    this.panel.append(this.voicePanel());
    const chat = section('Quick chat'); this.chatList = node('div', undefined, 'chat-log'); this.chatList.setAttribute('role', 'log'); this.chatList.setAttribute('aria-label', 'Collaboration messages');
    const compose = node('form', undefined, 'chat-compose'), message = node('textarea'); message.placeholder = 'Message your collaborator…'; message.maxLength = 2000; message.setAttribute('aria-label', 'Chat message');
    const comment = node('label'), stamp = node('input'); stamp.type = 'checkbox'; comment.append(stamp, document.createTextNode('Attach playhead timestamp'));
    const send = node('button', 'Send', 'primary'); send.type = 'submit'; compose.append(message, comment, send);
    compose.onsubmit = async e => {e.preventDefault(); send.disabled = true; try {await this.post('chat', {text: message.value, atSeconds: stamp.checked ? this.bridge.transport().playhead : null}); message.value = ''; await this.refresh();} catch (error) {report(error);} finally {send.disabled = false;}};
    chat.append(this.chatList, compose); this.panel.append(chat);
    this.reviewBox = section('Publication review'); this.panel.append(this.reviewBox);
    this.renderRoom();
  }
  drawNotices() {
    if (!this.noticeBox) return;
    this.noticeBox.replaceChildren(node('h3', 'Notifications'));
    for (const notice of (this.notices || []).slice(0, 5)) this.noticeBox.append(node('p', notice.kind.replaceAll('_', ' ') + (notice.username ? ' · ' + notice.username : ''), 'collab-notice'));
  }
  renderRoom() {
    if (this.panel.hidden || !this.state) return;
    if (this.memberBox) {
      this.memberBox.replaceChildren(node('h3', 'Artists'));
      for (const m of this.state.members) {
        const p = this.state.presence?.find(v => v.userId === m.userId), row = node('div', undefined, 'member-row');
        row.append(node('strong', m.username + (m.userId === this.user.id ? ' (you)' : '')), node('span', m.role + ' · ' + (LABELS[p?.state] || 'Offline') + (p?.recording ? ' · recording' : '') + (m.hasUnsaved ? ' · unsaved draft' : ' · saved'))); this.memberBox.append(row);
      }
      for (const i of this.state.invitations) {
        const row = node('div', 'Invitation: ' + i.status, 'member-row');
        if (i.status === 'pending' && this.user.id === this.state.creatorId) row.append(action('Revoke invitation', async () => {await this.post('invite/revoke', {inviteId: i.id}); await this.refresh();}));
        this.memberBox.append(row);
      }
    }
    if (this.chatList) {
      const stick = this.chatList.scrollTop + this.chatList.clientHeight >= this.chatList.scrollHeight - 40;
      this.chatList.replaceChildren();
      for (const message of this.state.chat) {
        const row = node('article', undefined, 'chat-message'); row.append(node('strong', message.username), node('p', message.text));
        if (Number.isFinite(message.atSeconds)) row.append(action('At ' + message.atSeconds.toFixed(2) + 's', () => this.bridge.playAt(message.atSeconds)));
        this.chatList.append(row);
      }
      if (stick) this.chatList.scrollTop = this.chatList.scrollHeight;
    }
    this.renderReview(); this.badge();
  }
  presence(values) {if (!this.state) return; this.state.presence = values; this.voice?.updatePresence(values).catch(report); this.renderRoom();}
  async post(action, body = {}) {return request('/api/rooms/' + this.state.roomId + '/' + action, {opId: op(), ...body});}
  async createDialog() {
    this.bridge.requireReady();
    const d = node('dialog', undefined, 'collab-invite-dialog'), name = input('Collaboration title', 'text', this.bridge.project().title);
    d.append(node('h2', 'Start a two-artist collaboration'), name.box, node('p', 'The audio referenced by your current arrangement will be uploaded to this room. You must have rights to share it. Existing solo projects and original files are not deleted.'), action('Cancel', () => {d.close(); d.remove();}), action('I have the rights · upload and create', async () => {
      const current = this.bridge.project();
      const room = await request('/api/rooms', {opId: op(), title: name.field.value.trim(), globals: current});
      // A new room gets new immutable asset IDs; source sample values remain unchanged.
      const assets = new Map(), remap = new Map();
      for (const c of current.clips) for (const key of ['assetId', 'originalAssetId']) {
        if (!remap.has(c[key])) {const a = this.bridge.assets().get(c[key]); const id = uid(); remap.set(c[key], id); assets.set(id, {...a, id});}
        c[key] = remap.get(c[key]);
      }
      current.id = room.id;
      for (const t of current.tracks) {t.ownerId = this.user.id; t.songKey ||= {root: current.root, scale: current.scale}; t.engines ||= {sound: current.engines.sound, tune: current.engines.tune}; t.keySections ||= copy(current.sections);}
      for (const c of current.clips) c.ownerId = this.user.id;
      this.state = await request('/api/rooms/' + room.id); this.version = this.state.myVersion;
      this.bridge.remote(current, assets); this.bridge.setCollaboration(this.hooks()); this.pending = true; this.synced = ''; this.remoteRevision = -1;
      this.persistRoom(); d.close(); d.remove(); await this.sync(); await this.show();
    }, 'primary')); document.body.append(d); d.showModal();
  }
  persistRoom() {sessionStorage.setItem('iv-room', this.state.roomId); history.replaceState(null, '', '#room=' + this.state.roomId); this.badge(); this.sendPresence().catch(() => {});}
  async join(id) {
    if (this.state && id !== this.state.roomId) throw Error('Exit the current collaboration before opening another.');
    this.bridge.requireReady();
    if (!this.state && this.bridge.project().clips.length && !confirm('Open this collaboration? Save a portable backup of your current local project first.')) return;
    const state = await request('/api/rooms/' + id), assets = await this.downloadAssets(state);
    const project = state.project;
    this.state = state; this.version = state.myVersion; this.remoteRevision = state.rev;
    this.pending = false; this.conflict = false; this.inflight = null;
    this.bridge.remote(project, assets); this.bridge.setCollaboration(this.hooks());
    this.synced = fingerprint(project, this.user.id, state.creatorId);
    this.persistRoom(); await this.show();
  }
  async downloadAssets(state) {
    const assets = new Map(this.bridge.assets());
    const used = new Set(state.project.clips.flatMap(c => [c.assetId, c.originalAssetId]));
    const expected = state.media.filter(a => a.kind === 'audio' && used.has(a.id));
    if (expected.reduce((n, a) => n + a.bytes, 0) > memoryLimit()) throw Error('This room exceeds this device’s audio memory budget. Use a larger-memory device or shorter stems.');
    for (const a of expected) {
      if (assets.has(a.id)) {this.uploaded.add(a.id); continue;}
      const bytes = await request('/api/media/' + a.id, undefined, {bytes: true, signal: AbortSignal.timeout(120000)});
      if (await digest(bytes) !== a.sha) throw Error('An audio download failed its integrity check. Retry; your original remains unchanged.');
      assets.set(a.id, decodePCM(bytes, a)); this.uploaded.add(a.id);
    }
    return assets;
  }
  async uploadOwn(project) {
    const own = ownContribution(project, this.user.id);
    for (const id of new Set(own.clips.flatMap(c => [c.assetId, c.originalAssetId]))) {
      if (this.uploaded.has(id)) continue;
      const a = this.bridge.assets().get(id); if (!a) throw Error('Missing original audio. Download recovery before trying to continue.');
      const buffer = encodePCM(a);
      await request('/api/rooms/' + this.state.roomId + '/media?' + new URLSearchParams({id, name: a.name.slice(0, 160), kind: 'audio'}), buffer, {binary: true, headers: {'Content-Type': 'application/octet-stream', 'X-Audio-Consent': 'yes'}});
      this.uploaded.add(id);
    }
  }
  async sync() {
    if (!this.state || this.state.closed) return;
    if (this.syncing) return this.syncing;
    if (this.conflict) throw Error('Resolve the contribution version conflict first.');
    this.syncing = (async () => {
      while (this.pending || this.inflight) {
        if (this.bridge.transport().recording) return;
        if (!this.inflight) {
          const project = this.bridge.project(); await this.uploadOwn(project);
          const payload = {opId: op(), version: this.version, ...ownContribution(project, this.user.id)};
          if (this.user.id === this.state.creatorId) {payload.shared = Object.fromEntries(sharedKeys.map(k => [k, project[k]])); payload.globalVersion = this.state.globalVersion;}
          this.inflight = {payload, fingerprint: fingerprint(project, this.user.id, this.state.creatorId)};
        }
        const sent = this.inflight;
        const result = await request('/api/rooms/' + this.state.roomId + '/draft', sent.payload);
        this.version = result.version; this.state.globalVersion = result.globalVersion;
        this.synced = sent.fingerprint; this.inflight = null;
        this.pending = fingerprint(this.bridge.project(), this.user.id, this.state.creatorId) !== this.synced;
        this.badge();
      }
    })();
    try {await this.syncing;} catch (e) {if (e.code === 'revision_conflict') this.conflict = true; this.badge('Not saved to server · ' + e.message); throw e;}
    finally {this.syncing = null; if (!this.pending && !this.conflict && this.state) this.refresh().catch(report);}
  }
  async refresh(force = false) {
    if (!this.state) return;
    if (this.syncing || this.refreshing) {this.fetchAgain = true; return;}
    this.refreshing = (async () => {
      const state = await request('/api/rooms/' + this.state.roomId);
      if (state.rev < this.remoteRevision) return;
      if (this.pending && state.myVersion !== this.version && !force) this.conflict = true;
      const assets = await this.downloadAssets(state);
      if (this.syncing || state.myVersion < this.version) {this.fetchAgain = true; return;}
      // Recheck pending after downloading: local edits may have happened meanwhile.
      const project = mergeRemote(state.project, this.bridge.project(), this.user.id, this.pending && !force, state.creatorId);
      if (!this.pending || force) {this.version = state.myVersion; this.synced = fingerprint(project, this.user.id, state.creatorId);}
      this.state = state; this.remoteRevision = state.rev;
      this.bridge.remote(project, assets); this.presence(state.presence); this.renderRoom();
      if (state.closed) {await this.voice?.disable(); this.badge();}
    })();
    try {await this.refreshing;} finally {this.refreshing = null; if (this.fetchAgain) {this.fetchAgain = false; queueMicrotask(() => this.refresh().catch(report));}}
  }
  async sendPresence(voice) {
    if (!this.connected) return;
    const transport = this.bridge.transport();
    await request('/api/presence', {clientId: this.clientId, roomId: this.state?.roomId || null, state: this.state ? document.hidden ? 'away' : 'in-studio' : 'online-elsewhere', ...transport, voice: voice === undefined ? !!this.voice?.enabled : voice});
    this.badge();
  }
  inviteForm() {
    const email = input('Invite by email', 'email');
    const box = section('Invite your collaborator', email.box, node('p', 'Invite links last 48 hours and reserve one guest seat. Existing accounts can accept using a matching verified email.', 'fine'));
    box.append(action('Create invitation link', async () => {
      const invitation = await this.post('invite', {recipient: email.field.value.trim()});
      const link = input('Private invitation link', 'text', invitation.url); link.field.readOnly = true;
      const result = section('Invitation ready · not sent yet', link.box, node('p', privateLinkText(), 'fine'),
        action('Copy link', () => navigator.clipboard.writeText(invitation.url)),
        action(window.ivNative ? 'Share invitation' : 'Open email draft', async () => {if(window.ivNative?.shareInvite){const result=await window.ivNative.shareInvite(invitation.url);if(result?.copied)report('Private invitation copied. Paste it only to the intended collaborator.');return;}location.href = 'mailto:' + encodeURIComponent(email.field.value.trim()) + '?subject=' + encodeURIComponent('Join my Infected Voices collaboration') + '&body=' + encodeURIComponent('Join me in our private studio:\n' + invitation.url);}),
        action('Send email through configured provider', async () => {await this.post('invite/email', {inviteId: invitation.id, token: invitation.token}); report('The email provider accepted the send. Delivery is not yet confirmed.');}));
      box.append(result); await this.refresh();
    }, 'primary')); return box;
  }
  voicePanel() {
    const box = section('Voice and listening', node('p', 'Voice is separate from recorded tracks. Use headphones. Both artists must opt in. A TURN relay is needed for dependable connectivity across restrictive networks.', 'fine'));
    this.voiceStatus = node('p', 'Voice chat off'); box.append(this.voiceStatus, action('Resume voice audio', () => this.voice?.audio.play()));
    const follow = node('label'), check = node('input'); check.type = 'checkbox'; check.checked = !!this.follow;
    check.onchange = () => {this.follow = check.checked;}; follow.append(check, document.createTextNode('Follow partner’s requested playhead (not sample-synchronous jamming)'));
    box.append(follow, action('Ask partner to listen from here', async () => {await this.signal('transport', {position: this.bridge.transport().playhead});}));
    return box;
  }
  async signal(type, payload) {
    const to = this.state?.members.find(m => m.userId !== this.user.id)?.userId;
    if (!to) return;
    return this.post('signal', {to, type, payload});
  }
  async toggleVoice() {
    if (!this.state || this.state.closed) return;
    if (!this.voice) this.voice = new VoiceChat({room: () => this.state, user: this.user, signal: (type, payload) => this.signal(type, payload), presence: v => this.sendPresence(v), onStatus: text => {if (this.voiceStatus) this.voiceStatus.textContent = text; this.badge();}});
    try {await this.voice.enable(); this.voice.setRecording(this.bridge.transport().recording); if (this.voice.enabled) await this.voice.updatePresence(this.state.presence || []);}
    catch (e) {await this.voice.disable(); throw e;}
    this.badge();
  }
  async receiveSignal(s) {
    if (s.type === 'transport') {if (this.follow && !this.bridge.busy() && Number.isFinite(s.payload.position)) await this.bridge.playAt(s.payload.position); return;}
    await this.voice?.receive(s.type, s.payload);
  }
  async save() {
    this.bridge.requireReady(); await this.sync();
    if (this.pending || this.conflict) throw Error('Your draft has not synchronized. Keep a local recovery copy and reconnect.');
    await this.post('save', {version: this.version}); this.bridge.markSaved(); await this.refresh(); this.bridge.status('Your contribution was saved on the room server. Your partner’s save is separate.');
  }
  async leave(mode) {
    this.bridge.requireReady(); await this.sync();
    if (this.pending || this.conflict) throw Error('Resolve synchronization before exiting. Download your recovery project first.');
    await this.post('leave', {mode, version: this.version});
    await this.voice?.disable();
    const state = await request('/api/rooms/' + this.state.roomId), assets = await this.downloadAssets(state);
    this.bridge.setCollaboration(null); this.state = null; this.bridge.replace({project: state.project, assets}); this.bridge.markSaved();
    sessionStorage.removeItem('iv-room'); history.replaceState(null, '', location.pathname);
    this.panel.hidden = true; this.memberBox = null; this.chatList = null; this.reviewBox = null;
    for (const id of ['root', 'scale', 'soundEngine', 'tuneEngine', 'record', 'bpm', 'title', 'newProject', 'openProject', 'openSaved', 'importClassic']) $(id).disabled = false;
    // A local copy can be reviewed; a guest session remains scoped to the room and expires.
    this.badge(); await this.sendPresence();
  }
  exitDialog() {
    if (!this.state) return;
    const d = node('dialog', undefined, 'collab-invite-dialog');
    d.append(node('h2', 'Exit collaboration'), node('p', 'Only your contribution is affected. Your collaborator’s work is preserved.'),
      action('Exit without saving', async () => {await this.leave('discard'); d.close(); d.remove();}),
      action('Save then exit', async () => {await this.leave('save'); d.close(); d.remove();}, 'primary'),
      action('Publish then exit', async () => {d.close(); d.remove(); await this.show(); this.reviewBox.scrollIntoView({behavior: 'smooth'});}),
      action('Stay in studio', () => {d.close(); d.remove();}));
    document.body.append(d); d.showModal();
  }
  renderReview() {
    if (!this.reviewBox || !this.state) return;
    const signature = JSON.stringify([this.state.closed, this.state.proposals, this.state.roomId]);
    if (this.reviewBox.dataset.signature === signature) return;
    this.reviewBox.dataset.signature = signature;
    for (const audio of this.reviewBox.querySelectorAll('audio')) { audio.pause(); if (audio.dataset.objectUrl) URL.revokeObjectURL(audio.dataset.objectUrl); }
    this.reviewBox.replaceChildren(node('h3', 'Publication review'), node('p', 'Both artists must save and approve the exact WAV. Publishing here creates a creator-owned release and queues its future Universe event; it does not upload to a live social profile.', 'fine'));
    if (this.state.closed) {this.reviewBox.append(node('p', 'Release saved. Universe delivery: pending integration.', 'success')); return;}
    if (this.user.id === this.state.creatorId) this.reviewBox.append(action('Render a mix for both artists to approve', async () => {
      await this.save(); await this.refresh();
      if (this.state.members.length !== 2 || this.state.members.some(m => m.hasUnsaved)) throw Error('Both artists must join and save before rendering for publication.');
      if (!confirm('Confirm you own or have permission for your audio and want to share this final WAV for review.')) return;
      const expectedContentHash = this.state.savedHash;
      const renderOptions = {mastering: this.bridge.project().mastering, engine: this.bridge.project().engines.master};
      const render = await this.bridge.renderMaster(), id = uid();
      await request('/api/rooms/' + this.state.roomId + '/media?' + new URLSearchParams({id, name: 'collaboration-master.wav', kind: 'render'}), await wav(render.channels, render.rate, 24).arrayBuffer(), {binary: true, headers: {'Content-Type': 'application/octet-stream', 'X-Audio-Consent': 'yes'}});
      await this.post('publication/propose', {audioId: id, title: this.state.project.title, rightsConfirmed: true, expectedContentHash, renderOptions}); await this.refresh();
    }, 'primary'));
    for (const proposal of this.state.proposals.slice(0, 3)) {
      const box = section(proposal.title, node('p', proposal.status + ' · approvals ' + proposal.approvals.length + '/2'));
      const audio = node('audio'); audio.controls = true; audio.preload = 'none'; if(window.ivNative){box.append(action('Load review audio',async()=>{const bytes=await request('/api/media/'+proposal.audioId,undefined,{bytes:true});if(audio.dataset.objectUrl)URL.revokeObjectURL(audio.dataset.objectUrl);const url=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));audio.src=url;audio.dataset.objectUrl=url;await audio.play();}));}else audio.src='/api/media/'+proposal.audioId;box.append(audio);
      box.append(action('Approve this mix and my contribution rights', async () => {await this.post('publication/approve', {proposalId: proposal.id, contentHash: proposal.contentHash, approve: true, rightsConfirmed: true}); await this.refresh();}),
        action('Request changes', async () => {await this.post('publication/approve', {proposalId: proposal.id, contentHash: proposal.contentHash, approve: false, rightsConfirmed: false}); await this.refresh();}));
      if (this.user.id === this.state.creatorId) box.append(action('Publish approved mix then exit', async () => {
        if (!confirm('Create this creator-owned release after both approvals? The future Universe delivery will be queued, not sent.')) return;
        await this.post('publication/publish', {proposalId: proposal.id}); await this.refresh(); await this.leave('save'); report('Release saved to the creator’s local song list. Universe delivery remains queued.');
      }, 'primary'));
      this.reviewBox.append(box);
    }
  }
  tour() {
    const steps = [
      ['peopleButton', 'People and chat', 'Open your room, invitation controls, accepted artists, notifications and timestamped messages.'],
      ['trackList', 'Your tracks, your decisions', 'Only the owner can edit or tune a track. Partner tracks are visible and audible, not editable.'],
      ['voiceButton', 'Voice is opt-in', 'Both artists turn it on. It mutes during capture and needs a TURN relay for reliable network coverage.'],
      ['collabSave', 'Live draft is not a saved take', 'Changes stream to your collaborator. Save explicitly to commit your contribution.'],
      ['collabExit', 'Leave without harming their work', 'Discard reverts only your draft. Save waits for acknowledgement. Publication needs both approvals.']
    ];
    const card = node('aside', undefined, 'floating-guide'); let step = 0;
    const clear = () => document.querySelectorAll('.collab-highlight').forEach(n => n.classList.remove('collab-highlight'));
    const draw = () => {clear(); const [id, title, text] = steps[step]; $(id).classList.add('collab-highlight'); $(id).scrollIntoView({block: 'nearest'}); card.replaceChildren(node('small', 'COLLAB HELPER · ' + (step + 1) + '/' + steps.length), node('h3', title), node('p', text)); const buttons = node('div'); if (step) buttons.append(action('Back', () => {step--; draw();})); buttons.append(action(step === steps.length - 1 ? 'Finish' : 'Next', () => {if (++step === steps.length) {clear(); card.remove();} else draw();}, 'primary'), action('Skip', () => {clear(); card.remove();})); card.append(buttons);};
    document.querySelector('.floating-guide')?.remove(); document.body.append(card); draw();
  }
}

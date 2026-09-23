import {request} from './api.js';
export class VoiceChat {
  constructor({room, user, signal, presence, onStatus}) {
    Object.assign(this, {room, user, signal, presence, onStatus});
    this.enabled = false; this.candidates = []; this.generation = 0;
    this.audio = new Audio(); this.audio.autoplay = true;
    this.audio.setAttribute('playsinline', '');
  }
  async enable() {
    if (this.enabled) return this.disable();
    const generation = ++this.generation;
    const stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true}, video: false});
    if (generation !== this.generation) {stream.getTracks().forEach(t => t.stop()); return;}
    this.stream = stream; this.enabled = true;
    stream.getTracks().forEach(t => t.addEventListener('ended', () => this.disable()));
    try { await this.presence(true); } catch (error) { await this.disable(); throw error; }
    this.setRecording(!!this.recording);
    this.onStatus('Voice on · waiting for partner. Use headphones.');
  }
  async ensurePeer() {
    if (this.pc) return this.pc;
    const ice=await request('/api/rooms/' + this.room().roomId + '/ice');
    if (!this.enabled) throw Error('Voice was cancelled.');
    const pc = new RTCPeerConnection({iceServers: ice.iceServers}); this.pc = pc;
    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
    pc.onicecandidate = event => {if (event.candidate) this.signal('candidate', event.candidate.toJSON()).catch(() => this.onStatus('Voice signaling disconnected. Toggle off then on after reconnecting.'));};
    pc.ontrack = event => {this.audio.srcObject = event.streams[0]; this.audio.play().catch(() => this.onStatus('Tap Resume voice audio in People to hear the call.'));};
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') this.onStatus('Voice connected' + (this.recording ? ' · muted during take' : ''));
      if (['failed', 'disconnected'].includes(pc.connectionState)) this.onStatus(ice.turnConfigured ? 'Voice disconnected. Toggle off/on to retry.' : 'Voice could not connect. Configure a TURN relay for restrictive networks.');
    };
    return pc;
  }
  async updatePresence(members) {
    if (!this.enabled || !this.room()) return;
    const peer = members.find(m => m.userId !== this.user.id);
    if (!peer?.voice || peer.state !== 'in-studio') {this.closePeer(); return;}
    // Exactly one elected caller avoids simultaneous-offer glare.
    if (this.user.id === this.room().creatorId && !this.pc && !this.offering) {
      this.offering = true;
      try {const pc = await this.ensurePeer(); await pc.setLocalDescription(await pc.createOffer()); await this.signal('offer', pc.localDescription.toJSON());}
      finally {this.offering = false;}
    }
  }
  async receive(type, payload) {
    if (['hangup', 'voice-off'].includes(type)) {this.closePeer(); this.onStatus('Partner left voice chat.'); return;}
    if (!this.enabled) return;
    if (type === 'candidate') {if (this.pc?.remoteDescription) await this.pc.addIceCandidate(payload); else this.candidates.push(payload); return;}
    if (!['offer', 'answer'].includes(type)) return;
    const pc = await this.ensurePeer();
    if (type === 'offer' && pc.signalingState !== 'stable') return;
    await pc.setRemoteDescription(payload);
    for (const c of this.candidates.splice(0)) await pc.addIceCandidate(c);
    if (type === 'offer') {await pc.setLocalDescription(await pc.createAnswer()); await this.signal('answer', pc.localDescription.toJSON());}
  }
  setRecording(active) {
    this.recording = active;
    for (const t of this.stream?.getAudioTracks() || []) t.enabled = !active;
    this.audio.muted = active;
    if (this.enabled && active) this.onStatus('Voice muted during recording · local dry take only');
  }
  closePeer() {if (this.pc) {this.pc.onconnectionstatechange = null; this.pc.close(); this.pc = null;} this.audio.pause(); this.audio.srcObject = null; this.candidates = [];}
  async disable() {
    this.generation++; this.enabled = false;
    if (this.stream) {const stream = this.stream; this.stream = null; for (const t of stream.getTracks()) t.stop();}
    this.closePeer();
    await this.presence(false).catch(() => {});
    await this.signal('voice-off', {}).catch(() => {});
    this.onStatus('Voice chat off');
  }
}

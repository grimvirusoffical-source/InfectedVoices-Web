import {audibleTracks,endTime,uid,newClip,copy} from './model.js';
import {asset,fromBuffer,memoryLimit,wav,zip} from './files.js';
import {dbGain,legacySound,measure,pitchRender,soundRender,legacyShape,alignAudio,masterAudio} from './core.js';
import {precisionPitch,warpAudio,analyzePitch} from './precision-dsp.js';

const tick=()=>new Promise(r=>setTimeout(r,0));
export class Studio {
  constructor(status=()=>{}) {
    this.status=status;this.transportGeneration=0;this.recordGeneration=0;this.assets=new Map();this.nodes=[];this.cache=new Map();this.requests=new Map();this.sequence=0;
    this.ready=new Promise(resolve=>{this.resolveReady=resolve;});
    this.readyTimer=setTimeout(()=>{this.workerFailure=true;this.worker?.terminate();this.resolveReady(false);},5000);
    try {
      this.worker=new Worker(new URL('./render-worker.js',import.meta.url),{type:'module'});
      this.worker.onmessage=({data})=>{
        if(data.ready){clearTimeout(this.readyTimer);this.resolveReady(true);return;}
        const job=this.requests.get(data.id);if(!job)return;this.requests.delete(data.id);clearTimeout(job.timer);data.error?job.reject(Error(data.error)):job.resolve(data.result);
      };
      this.worker.onerror=event=>{
        event.preventDefault();this.workerFailure=true;clearTimeout(this.readyTimer);this.resolveReady(false);
        for(const job of this.requests.values()){clearTimeout(job.timer);job.reject(Error('The background audio worker stopped. Your original audio is intact; retry uses local foreground processing.'));}
        this.requests.clear();
      };
    } catch {this.workerFailure=true;clearTimeout(this.readyTimer);this.resolveReady(false);}
  }
  async process(action,data,transfers=[]) {
    const ready=await this.ready;
    if(!ready||this.workerFailure){
      this.status('Using foreground audio processing on this device…');await tick();
      if(action==='vocal'){
        const warped=data.precision?.warpEnabled?warpAudio(data.samples,data.rate,data.precision.warpMarkers):data.samples;
        const pitch=data.precision?.pitchEnabled?precisionPitch(warped,data.rate,data.settings,data.precision,{root:data.settings.root,scale:data.settings.scale,sections:data.sections,start:data.start}):pitchRender(warped,data.rate,data.settings,data.engine,data.sections,data.start);
        return {samples:data.sound==='infected'?soundRender(pitch,data.rate,data.settings):legacyShape(pitch,data.rate,data.settings)};
      }
      if(action==='precisionAnalyze')return analyzePitch(data.samples,data.rate,data.context);
      if(action==='align')return alignAudio(data.samples,data.rate,data.start,data.project);
      if(action==='master')return {channels:masterAudio(data.channels,data.rate,data.project)};
      throw Error('Unknown audio processing operation.');
    }
    return new Promise((resolve,reject)=>{const id=++this.sequence,timer=setTimeout(()=>{this.requests.delete(id);reject(Error('Processing took too long. Use a shorter clip or a desktop device.'));},180000);this.requests.set(id,{resolve,reject,timer});this.worker.postMessage({id,action,...data},transfers);});
  }
  async init() {
    if(!this.ctx)this.ctx=new AudioContext({latencyHint:'interactive'});
    if(this.ctx.state!=='running')await this.ctx.resume();return this.ctx;
  }
  bytes(){return [...this.assets.values()].reduce((n,a)=>n+a.bytes,0);}
  addAsset(a) {
    if(this.bytes()+a.bytes>memoryLimit())throw Error('The audio memory budget on this device is full. Save your project and continue on a larger-memory device.');
    this.assets.set(a.id,a);return a;
  }
  async import(file) {
    if(file.size>memoryLimit()/2)throw Error('This audio file is too large for the current device memory budget.');
    const ctx=await this.init();let decoded;
    try{decoded=await ctx.decodeAudioData(await file.arrayBuffer());}catch{throw Error('Could not decode '+file.name+'. Try a WAV or MP3 file.');}
    if(decoded.numberOfChannels>2)throw Error('Import mono or stereo audio. Surround files need a stereo export first.');
    return this.addAsset(fromBuffer(decoded,file.name));
  }
  clearCache(){this.cache.clear();}
  region(c) {
    const a=this.assets.get(c.assetId);if(!a)throw Error('Missing clip audio.');
    const start=Math.round(c.offset*a.rate),length=Math.min(a.length-start,Math.round(c.duration*a.rate));
    return {rate:a.rate,channels:a.channels.map(channel=>channel.slice(start,start+length))};
  }
  buffer(ctx,channels,rate) {
    const b=ctx.createBuffer(channels.length,channels[0].length,rate);channels.forEach((c,i)=>b.copyToChannel(c,i));return b;
  }
  async rendered(c,t,p,raw=false) {
    // Every collaborator controls only their own track's pitch/sound pipeline.
    const keySettings=t.songKey||{root:p.root,scale:p.scale};
    const engines={...p.engines,...t.engines};
    const sections=t.keySections||p.sections;
    const key=JSON.stringify([c.assetId,c.offset,c.duration,c.fadeIn,c.fadeOut,c.start,t.kind,t.settings,t.effects,keySettings,sections,engines.sound,engines.tune,raw]);
    if(this.cache.has(key))return this.cache.get(key);
    let {rate,channels}=this.region(c);
    for(const channel of channels)for(let i=0;i<channel.length;i++){const time=i/rate;channel[i]*=Math.min(1,c.fadeIn?time/c.fadeIn:1,c.fadeOut?Math.max(0,c.duration-time)/c.fadeOut:1);}
    if(t.kind==='vocal'&&!raw) {
      const settings={...t.settings,...keySettings};
      const mono=new Float32Array(channels[0].length);for(const channel of channels)for(let i=0;i<mono.length;i++)mono[i]+=channel[i]/channels.length;
      const result=await this.process('vocal',{samples:mono,rate,settings,engine:engines.tune,sound:engines.sound,sections,start:c.start},[mono.buffer]);
      channels=[result.samples];
      if(engines.sound==='legacy') {
        const off=new OfflineAudioContext(1,result.samples.length+Math.round(rate*1.5),rate),source=off.createBufferSource();
        source.buffer=this.buffer(off,channels,rate);legacySound(off,source,settings).connect(off.destination);source.start();
        channels=[(await off.startRendering()).getChannelData(0).slice()];
      }
    }
    const result={channels,rate};
    // Bound derived audio independently of the user's immutable source budget.
    if([...this.cache.values()].reduce((n,a)=>n+a.channels.reduce((s,c)=>s+c.byteLength,0),0)>memoryLimit()/3)this.cache.clear();
    this.cache.set(key,result);return result;
  }
  async prepare(p,trackId,raw=false) {
    const tracks=new Map(audibleTracks(p).filter(t=>!trackId||t.id===trackId).map(t=>[t.id,t])),out=[];
    for(const c of p.clips){
      const t=tracks.get(c.trackId);if(!t||c.muted)continue;
      this.status('Preparing '+c.name+'…');
      out.push({c,t,a:await this.rendered(c,t,p,raw)});await tick();
    }
    return out;
  }
  schedule(ctx,{c,t,a},origin,position,duration,destination) {
    const offset=Math.max(0,position-c.start),delay=Math.max(0,c.start-position),fullLength=a.channels[0].length/a.rate;
    if(offset>=fullLength||delay>=duration)return;
    const source=ctx.createBufferSource();source.buffer=this.buffer(ctx,a.channels,a.rate);
    const gain=ctx.createGain(),pan=ctx.createStereoPanner();pan.pan.value=t.pan;
    const base=dbGain(c.gainDb+t.gainDb),begin=origin+delay,sourceEnd=Math.min(fullLength,offset+duration-delay);
    gain.gain.setValueAtTime(base,begin);
    source.connect(gain).connect(pan).connect(destination);source.start(begin,offset,sourceEnd-offset);
    this.nodes.push(source);
  }
  async render(p,{master=false,trackId=null,raw=false}={}) {
    if(!p.clips.length)throw Error('Import or record audio first.');
    const duration=endTime(p)+1.5,rate=44100;
    if(duration*rate*8>memoryLimit()/2)throw Error('This render exceeds the safe device memory budget. Export a shorter arrangement or use a desktop with more memory.');
    const prepared=await this.prepare(p,trackId,raw),off=new OfflineAudioContext(2,Math.ceil(duration*rate),rate);
    for(const clip of prepared)this.schedule(off,clip,0,0,duration,off.destination);
    const buffer=await off.startRendering();let channels=[buffer.getChannelData(0).slice(),buffer.getChannelData(1).slice()];
    if(master){this.status('Rendering '+p.engines.master+' master…');const response=await this.process('master',{channels,rate,project:p},channels.map(c=>c.buffer));channels=response.channels;}
    this.status('Render ready.');return {channels,rate,metrics:measure(channels)};
  }
  async play(p,{recording=false}={}) {
    if(this.playing)this.stopPlayback();
    const generation=++this.transportGeneration;
    const ctx=await this.init(),snapshot=copy(p),prepared=await this.prepare(snapshot),position=p.loop?p.loopStart:p.cursor;
    if(generation!==this.transportGeneration)throw Error('Playback preparation cancelled.');
    this.position=position;this.length=p.loop?p.loopEnd-p.loopStart:Math.max(endTime(p)-position+1.5,0.1);
    this.origin=ctx.currentTime+0.12+(recording?p.countIn*4*60/p.bpm:0);this.playing=true;this.loop=p.loop;
    if(p.loop) {
      if(this.length*ctx.sampleRate*8>memoryLimit()/3)throw Error('Loop is too long for this device.');
      const off=new OfflineAudioContext(2,Math.ceil(this.length*ctx.sampleRate),ctx.sampleRate);
      for(const c of prepared)this.schedule(off,c,0,position,this.length,off.destination);
      const rendered=await off.startRendering();if(generation!==this.transportGeneration)throw Error('Loop preparation cancelled.');const src=ctx.createBufferSource();src.buffer=rendered;src.loop=true;
      this.origin=Math.max(this.origin,ctx.currentTime+0.12+(recording?p.countIn*4*60/p.bpm:0));src.connect(ctx.destination);src.start(this.origin);this.nodes.push(src);
    }else for(const c of prepared)this.schedule(ctx,c,this.origin,position,recording?21600:this.length,ctx.destination);
    if(p.metronome||(recording&&p.countIn))this.startClicks(snapshot,recording);
    this.status(recording?'Count-in, then recording…':'Playing.');return this.origin;
  }
  startClicks(p,recording) {
    const beat=60/p.bpm,count=recording?p.countIn*4:0;let index=-count,next=this.origin-count*beat;
    this.clickTimer=setInterval(()=>{
      while(next<this.ctx.currentTime+0.1){
        if(next>=this.ctx.currentTime&&(index<0||p.metronome)){
          const osc=this.ctx.createOscillator(),g=this.ctx.createGain();osc.frequency.value=index%4===0?1400:950;
          g.gain.setValueAtTime(0.08,next);g.gain.exponentialRampToValueAtTime(0.001,next+0.035);osc.connect(g).connect(this.ctx.destination);osc.start(next);osc.stop(next+0.04);
        }
        next+=beat;index++;
        if(!this.playing){clearInterval(this.clickTimer);break;}
      }
    },25);
  }
  cursor(){if(!this.playing)return this.position||0;const elapsed=Math.max(0,this.ctx.currentTime-this.origin);return this.position+(this.loop?elapsed%this.length:elapsed);}
  cancelPending(){this.recordGeneration++;this.transportGeneration++;if(!this.recording)this.releaseMic();}
  stopPlayback(){this.transportGeneration++;for(const node of this.nodes)try{node.stop();node.disconnect();}catch{}this.nodes=[];clearInterval(this.clickTimer);this.playing=false;}
  async mic(onLevel=()=>{}) {
    const generation=this.micGeneration||0,ctx=await this.init();
    if(this.stream)return;
    const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false,...(this.inputId&&this.inputId!=='default'?{deviceId:{exact:this.inputId}}:{})}});
    if(generation!==(this.micGeneration||0)){stream.getTracks().forEach(t=>t.stop());throw Error('Microphone connection cancelled.');}
    try {
      if(!this.moduleLoaded){await ctx.audioWorklet.addModule(new URL('./capture.js',import.meta.url));this.moduleLoaded=true;}
      this.stream=stream;for(const track of stream.getTracks())track.addEventListener('ended',()=>{this.status('Microphone disconnected. Finishing the captured take.');if(this.recording&&!this.stopping)this.onAutoStop?.();});this.source=ctx.createMediaStreamSource(stream);this.capture=new AudioWorkletNode(ctx,'iv-capture-v5');
      this.source.connect(this.capture);this.capture.connect(ctx.destination);
      this.capture.port.onmessage=({data})=>{
        if(data.type==='pcm'&&this.recording){
          if(!Number.isInteger(data.frame)||!(data.samples instanceof Float32Array))return;
          const gap=data.frame-this.nextCaptureFrame;
          if(gap>0){
            if((this.recordedSamples+gap)*4+this.bytes()>memoryLimit()*0.8){this.status('Capture gap exceeded the safe memory budget. Saving completed chunks.');this.onAutoStop?.();return;}
            this.chunks.push(new Float32Array(gap));this.recordedSamples+=gap;
          }
          const skip=Math.max(0,-gap),samples=data.samples.subarray(Math.min(skip,data.samples.length));
          if(samples.length){this.chunks.push(samples);this.recordedSamples+=samples.length;}
          this.nextCaptureFrame=Math.max(this.nextCaptureFrame,data.frame+data.samples.length);
          if(this.bytes()+this.recordedSamples*4>memoryLimit()*0.8&&!this.stopping){this.status('Memory limit reached; finishing and keeping the take.');this.onAutoStop?.();}
        }
        if(data.type==='stopped')this.finishCapture?.();
      };
      this.analyser=ctx.createAnalyser();this.analyser.fftSize=256;this.source.connect(this.analyser);
      const values=new Float32Array(256);this.meterTimer=setInterval(()=>{this.analyser.getFloatTimeDomainData(values);let peak=0;for(const v of values)peak=Math.max(peak,Math.abs(v));onLevel(peak);},60);
    }catch(error){stream.getTracks().forEach(t=>t.stop());this.releaseMic();throw error;}
  }
  async record(p,track,onAutoStop) {
    if(this.recording)throw Error('Already recording.');
    if(!track||track.kind!=='vocal')throw Error('Select a vocal track to record onto.');
    if(memoryLimit()-this.bytes()<1048576)throw Error('Not enough recording memory remains. Save this project and use a fresh session or a larger-memory device.');
    const generation=++this.recordGeneration;await this.mic(this.onLevel||(()=>{}));if(generation!==this.recordGeneration)throw Error('Recording preparation cancelled.');this.chunks=[];this.recordedSamples=0;this.onAutoStop=onAutoStop;
    const origin=await this.play(p,{recording:true});if(generation!==this.recordGeneration)throw Error('Recording preparation cancelled.');this.recordProject=copy(p);this.recordTrack=track.id;
    this.nextCaptureFrame=Math.round(origin*this.ctx.sampleRate)+(p.punch?Math.round(p.compensationMs*this.ctx.sampleRate/1000):0);
    if(p.punch&&this.nextCaptureFrame<Math.ceil(this.ctx.currentTime*this.ctx.sampleRate))throw Error('The compensated punch start has already passed. Increase the count-in and retry; no incomplete punch is claimed.');
    this.recording=true;this.capture.port.postMessage({type:'start',frame:this.nextCaptureFrame,
      endFrame:p.punch ? this.nextCaptureFrame + Math.round((p.loopEnd-p.loopStart)*this.ctx.sampleRate) : null});
  }
  async stopRecording() {
    if(!this.recording)return [];
    if(this.stopping)return this.stopping;
    this.stopping=(async()=>{
      this.stopPlayback();
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('The microphone did not finish safely. Keep this window open and download recovery audio.')),5000);this.finishCapture=()=>{clearTimeout(timer);resolve();};this.capture.port.postMessage({type:'stop'});});
      const audio=new Float32Array(this.recordedSamples);let at=0;for(const c of this.chunks){audio.set(c,at);at+=c.length;}
      this.recording=false;const p=this.recordProject,rate=this.ctx.sampleRate,loopSamples=Math.round((p.loopEnd-p.loopStart)*rate),out=[];
      if(!audio.length){this.status('Stopped before any audio was captured.');return out;}
      const a=this.addAsset(asset(uid(),'Recording '+new Date().toLocaleTimeString(),rate,[audio])),group=uid();
      if(p.loop){for(let start=0;start<audio.length;start+=loopSamples){const length=Math.min(loopSamples,audio.length-start);if(length<rate*0.01)continue;const c=newClip(this.recordTrack,a.id,length/rate,'Take '+(out.length+1),Math.max(0,p.loopStart-p.compensationMs/1000));c.offset=start/rate;c.takeGroup=group;c.muted=out.length>0;out.push(c);}}
      else out.push(newClip(this.recordTrack,a.id,a.duration,a.name,p.punch?p.loopStart:Math.max(0,p.cursor-p.compensationMs/1000)));
      this.chunks=[];this.status('Recording kept as '+out.length+' timeline clip(s).');return out;
    })();
    try{return await this.stopping;}finally{this.stopping=null;}
  }
  captureRecovery(){
    if(!this.recordedSamples||!this.ctx)throw Error('There are no completed recording chunks to recover.');
    const samples=new Float32Array(this.recordedSamples);let offset=0;
    for(const chunk of this.chunks){samples.set(chunk,offset);offset+=chunk.length;}
    return {samples,rate:this.ctx.sampleRate};
  }
  releaseMic(){this.micGeneration=(this.micGeneration||0)+1;clearInterval(this.meterTimer);this.stream?.getTracks().forEach(t=>t.stop());this.capture?.disconnect();this.source?.disconnect();this.monitor?.disconnect();this.stream=null;this.capture=null;this.source=null;this.monitor=null;}
  setMonitor(enabled){if(this.monitor){this.monitor.disconnect();this.monitor=null;}if(enabled&&this.source){this.monitor=this.ctx.createGain();this.monitor.gain.value=0.6;this.source.connect(this.monitor);this.monitor.connect(this.ctx.destination);}}
  async align(c,p) {
    const region=this.region(c),mono=new Float32Array(region.channels[0].length);
    for(const channel of region.channels)for(let i=0;i<mono.length;i++)mono[i]+=channel[i]/region.channels.length;
    const response=await this.process('align',{samples:mono,rate:region.rate,start:c.start,project:p},[mono.buffer]);
    return {...response,rate:region.rate};
  }
  async stems(p,raw=false) {
    const files=[];
    for(const t of p.tracks){if(!p.clips.some(c=>c.trackId===t.id))continue;const project=copy(p);project.tracks.forEach(v=>{v.mute=v.id!==t.id;v.solo=false;});const r=await this.render(project,{trackId:t.id,raw});files.push({name:String(files.length+1).padStart(2,'0')+'-'+t.name.replace(/[^a-zA-Z0-9_-]/g,'_')+'.wav',blob:wav(r.channels,r.rate)});}
    files.push({name:'session.json',blob:new Blob([JSON.stringify({title:p.title,bpm:p.bpm,root:p.root,scale:p.scale,alignment:'Import every WAV at song time zero.',sampleRate:44100,bits:24,raw},null,2)],{type:'application/json'})});
    return zip(files);
  }
  async close(){this.stopPlayback();this.releaseMic();clearTimeout(this.readyTimer);this.worker?.terminate();await this.ctx?.close();}
}

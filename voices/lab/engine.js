import {VoiceDSP,mono,metrics,clamp,defaults,scales,pocketProfiles,masterDefaults,masterProfiles} from './dsp.js';
export const tick=()=>new Promise(r=>setTimeout(r,0));
export function download(blob,name) {
  const a=document.createElement('a'), url=URL.createObjectURL(blob);
  a.href=url;a.download=name;a.textContent='Download '+name;
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
export function wav(buffer,bits=24) {
  const channels=buffer.numberOfChannels, bytes=bits/8, size=buffer.length*channels*bytes;
  const data=new ArrayBuffer(44+size),v=new DataView(data);
  const put=(pos,s)=>{for(let i=0;i<s.length;i++)v.setUint8(pos+i,s.charCodeAt(i));};
  put(0,'RIFF');v.setUint32(4,36+size,true);put(8,'WAVE');put(12,'fmt ');
  v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels,true);
  v.setUint32(24,buffer.sampleRate,true);v.setUint32(28,buffer.sampleRate*channels*bytes,true);
  v.setUint16(32,channels*bytes,true);v.setUint16(34,bits,true);put(36,'data');v.setUint32(40,size,true);
  let p=44;
  for(let i=0;i<buffer.length;i++)for(let c=0;c<channels;c++) {
    const sample=clamp(buffer.getChannelData(c)[i],-1,1);
    if(bits===16) {v.setInt16(p,Math.round(sample*(sample<0?32768:32767)),true);p+=2;}
    else {
      const n=Math.round(sample*(sample<0?8388608:8388607));
      v.setUint8(p++,n&255);v.setUint8(p++,(n>>8)&255);v.setUint8(p++,(n>>16)&255);
    }
  }
  return new Blob([data],{type:'audio/wav'});
}
export async function mp3(buffer,bitrate) {
  const codecURL=new URL('./mp3-codec.js',import.meta.url);
  const {Mp3Encoder}=await import(/* @vite-ignore */codecURL.href);
  const encoder=new Mp3Encoder(buffer.numberOfChannels,buffer.sampleRate,bitrate);
  const chunks=[],channels=[];
  for(let c=0;c<buffer.numberOfChannels;c++) {
    const src=buffer.getChannelData(c),dest=new Int16Array(src.length);
    for(let i=0;i<src.length;i++)dest[i]=Math.round(clamp(src[i],-1,1)*32767);
    channels.push(dest);
  }
  for(let i=0;i<buffer.length;i+=1152) {
    const out=encoder.encodeBuffer(channels[0].subarray(i,i+1152),channels[1]?.subarray(i,i+1152));
    if(out.length)chunks.push(new Uint8Array(out));
    if(i%(1152*100)===0)await tick();
  }
  chunks.push(new Uint8Array(encoder.flush()));
  return new Blob(chunks,{type:'audio/mpeg'});
}
export function effects(ctx,s) {
  const input=ctx.createGain();
  const hp=ctx.createBiquadFilter();hp.type='highpass';hp.frequency.value=s.highpass;
  const body=ctx.createBiquadFilter();body.type='lowshelf';body.frequency.value=220;body.gain.value=s.body;
  const presence=ctx.createBiquadFilter();presence.type='peaking';presence.frequency.value=3200;presence.Q.value=0.7;presence.gain.value=s.presence;
  const comp=ctx.createDynamicsCompressor();comp.threshold.value=s.compression;comp.ratio.value=s.ratio;comp.attack.value=0.008;comp.release.value=0.14;
  const output=ctx.createGain();output.gain.value=Math.pow(10,s.gain/20);
  input.connect(hp).connect(body).connect(presence).connect(comp).connect(output);
  const delay=ctx.createDelay(2);delay.delayTime.value=s.delay;
  const wet=ctx.createGain();wet.gain.value=s.echo;
  const feedback=ctx.createGain();feedback.gain.value=0.24;
  comp.connect(delay).connect(wet).connect(output);
  // Keep the echo feedback bounded to one repeat. A live feedback cycle makes
  // long offline renders unnecessarily expensive on mobile browsers and can
  // become unstable when a project contains near-full-scale audio.
  delay.connect(feedback).connect(output);
  // Deterministic multi-tap diffusion avoids a downloaded impulse response.
  const taps=[];
  for(const [time,level] of [[0.029,0.35],[0.043,0.28],[0.079,0.22],[0.113,0.16],[0.173,0.1],[0.251,0.06]]) {
    const d=ctx.createDelay();d.delayTime.value=time;
    const g=ctx.createGain();g.gain.value=s.reverb*level;
    comp.connect(d).connect(g).connect(output);taps.push(d,g);
  }
  return {input,output,disconnect(){for(const node of [input,hp,body,presence,comp,output,delay,wet,feedback,...taps])node.disconnect();}};
}
export function sectionSettings(s,sections,time) {
  const section=sections.find(v=>time>=v.start&&time<v.end);
  return section?{...s,root:section.root,scale:section.scale}:s;
}
export async function processed(buffer,settings,sections,start=0) {
  const sr=buffer.sampleRate, x=mono(buffer), dsp=new VoiceDSP(sr,sectionSettings(settings,sections,start));
  const latency=Math.round(sr*0.045/2)+64;
  const result=new Float32Array(x.length);
  for(let i=0;i<x.length+latency;i++) {
    if(i%1024===0)dsp.configure(sectionSettings(settings,sections,start+i/sr));
    const value=dsp.sample(x[i]||0);
    if(i>=latency)result[i-latency]=value;
    if(i%65536===0)await tick();
  }
  const ctx=new OfflineAudioContext(1,x.length+Math.round(sr*1.5),sr);
  const b=ctx.createBuffer(1,x.length,sr);b.copyToChannel(result,0);
  const source=ctx.createBufferSource();source.buffer=b;
  const chain=effects(ctx,settings);source.connect(chain.input);chain.output.connect(ctx.destination);source.start();
  return ctx.startRendering();
}
export async function mix(project,ctx,onProgress=()=>{}) {
  const active=project.clips.filter(c=>!c.mute);
  const mastering={...masterDefaults,...(project.mastering||{})};
  const profile=masterProfiles[mastering.profile]?{...masterProfiles[mastering.profile],...mastering}:mastering;
  const duration=Math.max(project.acapella?0:project.beat?.duration||0,...active.map(c=>c.start+c.audio.duration+1.5),0.1);
  if(duration>1200)throw new Error('Export limit is 20 minutes per project.');
  const offline=new OfflineAudioContext(2,Math.ceil(duration*44100),44100);
  const masterIn=offline.createGain();
  const masterCut=offline.createBiquadFilter();masterCut.type='highpass';masterCut.frequency.value=clamp(Number(profile.lowCut)||28,20,180);
  const air=offline.createBiquadFilter();air.type='highshelf';air.frequency.value=10500;air.gain.value=clamp(Number(profile.air)||0,-3,3);
  const glue=offline.createDynamicsCompressor();
  const amount=clamp(Number(profile.compression)||0,0,1);glue.threshold.value=-8-24*amount;glue.ratio.value=1+amount*5;glue.attack.value=.012;glue.release.value=.16;
  const master=offline.createGain();master.gain.value=project.master??1;
  masterIn.connect(masterCut).connect(air).connect(glue).connect(master).connect(offline.destination);
  const vocalRms=active.length?active.reduce((sum,c)=>sum+metrics(mono(c.audio)).rms,0)/active.length:0;
  const beatDuck=1-clamp((Number(profile.ducking)||0)*clamp(vocalRms/.12,0,1),0,.65);
  const vocalGain=Math.pow(10,(Number(profile.vocalLevel)||0)/20);
  const beatGain=Math.pow(10,(Number(profile.beatLevel)||0)/20)*beatDuck;
  if(project.beat&&!project.acapella) {
    const src=offline.createBufferSource();src.buffer=project.beat;
    const gain=offline.createGain();gain.gain.value=project.beatGain*beatGain;
    src.connect(gain).connect(masterIn);src.start();
  }
  for(let i=0;i<active.length;i++) {
    onProgress('Rendering vocal '+(i+1)+' of '+active.length+'…');await tick();
    const c=active[i],render=await processed(c.audio,project.settings,project.sections,c.start);
    const src=offline.createBufferSource();src.buffer=render;
    const gain=offline.createGain();gain.gain.value=c.gain*vocalGain;
    src.connect(gain).connect(masterIn);src.start(c.start);
  }
  onProgress('Finishing mix…');
  const result=await offline.startRendering();
  // Normalize an RMS proxy, then apply a sample peak ceiling. This is useful
  // repeatable headroom control, not a claim of standards-compliant LUFS.
  let sum=0,count=0,peak=0;
  for(let c=0;c<2;c++)for(const v of result.getChannelData(c)){sum+=v*v;count++;peak=Math.max(peak,Math.abs(v));}
  const target=Math.pow(10,clamp(Number(profile.targetDb)||-12,-24,-8)/20);
  const rms=Math.sqrt(sum/Math.max(1,count));
  const ceiling=Math.pow(10,clamp(Number(profile.ceiling)||-.1,-6,-.1)/20);
  const gain=Math.min(rms>.000001?target/rms:1,peak>.000001?ceiling/peak:1);
  const drive=clamp(Number(profile.drive)||0,0,.35);
  const width=clamp(Number(profile.width)||1,0,1.5);
  const leftChannel=result.getChannelData(0),rightChannel=result.getChannelData(1);
  for(let i=0;i<result.length;i++) {
    let left=leftChannel[i]*gain,right=rightChannel[i]*gain;
    if(drive){left=Math.tanh(left*(1+drive*4))/(1+drive*.8);right=Math.tanh(right*(1+drive*4))/(1+drive*.8);}
    const mid=(left+right)*.5,side=(left-right)*.5*width;
    leftChannel[i]=clamp(mid+side,-ceiling,ceiling);rightChannel[i]=clamp(mid-side,-ceiling,ceiling);
  }
  return result;
}
const pack=b=>b?{sr:b.sampleRate,channels:Array.from({length:b.numberOfChannels},(_,c)=>b.getChannelData(c).slice())}:null;
const unpack=(b,ctx)=>{
  if(!b)return null;
  if(!Number.isFinite(b.sr)||b.sr<8000||b.sr>192000||!Array.isArray(b.channels)||b.channels.length<1||b.channels.length>2||!b.channels[0]?.length||b.channels[0].length>b.sr*1200||b.channels.some(a=>a.length!==b.channels[0].length||!Array.from(a).every(Number.isFinite)))throw new Error('Invalid audio in project file.');
  const out=ctx.createBuffer(b.channels.length,b.channels[0].length,b.sr);
  b.channels.forEach((a,i)=>out.copyToChannel(new Float32Array(a),i));return out;
};
export function serialize(p) {
  return {...p,format:'InfectedVoicesBrowser',version:1,beat:pack(p.beat),
    clips:p.clips.map(({rendered,...c})=>({...c,audio:pack(c.audio),original:pack(c.original)}))};
}
export function restore(p,ctx) {
  if(!p||typeof p!=='object')throw new Error('Invalid project file.');
  if(p.format!=='InfectedVoicesBrowser'||p.version!==1||!Array.isArray(p.clips))throw new Error('This is not a browser studio project. Desktop projects use a different format.');
  
  if(!Number.isFinite(p.bpm)||p.bpm<30||p.bpm>300||!Number.isFinite(p.loopStart)||!Number.isFinite(p.loopEnd)||p.loopStart<0||p.loopEnd<=p.loopStart||p.loopEnd>1200||!Array.isArray(p.sections)||p.sections.length>200||p.clips.length>64)throw new Error('Project contains invalid tempo, loop, or track data.');
  const ranges={root:[0,11],tune:[0,1],retune:[1,250],shift:[-12,12],sub:[0,.7],drive:[0,.8],gate:[-70,-20],highpass:[40,250],body:[-9,9],presence:[-6,6],compression:[-40,0],ratio:[1,12],echo:[0,.7],delay:[.05,1],reverb:[0,.8],gain:[-18,12],glitch:[0,.8]};
  const valid=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
  const settings={...defaults,...p.settings};
  if(!p.settings||!Object.hasOwn(scales,settings.scale)||!Number.isInteger(settings.root)||Object.entries(ranges).some(([key,[min,max]])=>!valid(settings[key],min,max)))throw new Error('Invalid effect settings.');
  if(!valid(p.master,0,2)||!valid(p.beatGain,0,2)||!valid(p.gridOffset,0,1200))throw new Error('Invalid project level or grid offset.');
  const mastering={...masterDefaults,...(p.mastering||{})};
  const masterRanges={targetDb:[-24,-8],ceiling:[-6,-.1],compression:[0,1],vocalLevel:[-12,12],beatLevel:[-12,12],ducking:[0,.65],width:[0,1.5],drive:[0,.35],air:[-3,3],lowCut:[20,180]};
  if(!Object.hasOwn(masterProfiles,mastering.profile)||Object.entries(masterRanges).some(([key,[min,max]])=>!valid(mastering[key],min,max)))throw new Error('Invalid mastering settings.');
  const pocketing={profile:'Rap',mode:'conservative',division:16,strength:.7,maxMove:65,swing:0,sensitivity:.14,preserve:.75,minGapMs:90,...(p.pocketing||{})};
  if(!Object.hasOwn(pocketProfiles,pocketing.profile)||!['conservative','full'].includes(pocketing.mode)||![4,8,12,16].includes(Number(pocketing.division))||!valid(pocketing.strength,0,1)||!valid(pocketing.maxMove,5,250)||!valid(pocketing.swing,-.35,.35)||!valid(pocketing.sensitivity,.03,.8)||!valid(pocketing.preserve,0,1)||!valid(pocketing.minGapMs,25,250))throw new Error('Invalid Pocket settings.');
  if(p.clips.some(c=>!c||!c.audio||!c.original))throw new Error('Vocal audio and its original are required.');
  for(const c of p.clips)if(!Number.isFinite(c.start)||c.start<0||c.start>1200||!Number.isFinite(c.gain)||c.gain<0||c.gain>2)throw new Error('Invalid vocal position or gain.');
  for(const s of p.sections)if(!s||!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<=s.start||s.end>1200||!Number.isInteger(s.root)||s.root<0||s.root>11||!Object.hasOwn(scales,s.scale))throw new Error('Invalid song key section.');

  return {...p,settings,mastering,pocketing,beat:unpack(p.beat,ctx),clips:p.clips.map(c=>({...c,audio:unpack(c.audio,ctx),original:unpack(c.original,ctx)}))};
}
export async function database(action,payload) {
  const db=await new Promise((resolve,reject)=>{
    const r=indexedDB.open('infected-voices-browser:'+(window.ivUserId||'anonymous'),1);
    r.onupgradeneeded=()=>r.result.createObjectStore('projects');
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
  try {
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction('projects',action==='get'?'readonly':'readwrite');
      const store=tx.objectStore('projects');
      const r=action==='get'?store.get('current'):store.put(payload,'current');
      tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error||new Error('Project save was interrupted.'));
    });
  } finally {db.close();}
}
export class StudioAudio {
  async init() {
    if(!this.ctx&&!this.initializing) {
      this.initializing=(async()=>{
        const ctx=new AudioContext({latencyHint:'interactive'});
        try {
          if(!ctx.audioWorklet)throw new Error('This browser cannot run live vocal effects. Open the HTTPS site in a current browser.');
          await ctx.audioWorklet.addModule(new URL('./voice-worklet.js',import.meta.url));
          const sink=ctx.createGain();sink.gain.value=0;sink.connect(ctx.destination);
          this.sink=sink;this.ctx=ctx;
        } catch(e) {await ctx.close().catch(()=>{});throw e;}
      })();
    }
    if(this.initializing)try{await this.initializing;}finally{this.initializing=null;}
    await this.ctx.resume();return this.ctx;
  }
  async microphone(settings,onBlock) {
    await this.init();
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone needs HTTPS or localhost. Open the hosted studio in Safari or Chrome.');
    if(!this.stream) {
      const generation=this.micGeneration||0;
      const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
      if(generation!==(this.micGeneration||0)){stream.getTracks().forEach(t=>t.stop());throw new Error('Microphone connection was cancelled.');}
      this.stream=stream;
      try {
        this.source=this.ctx.createMediaStreamSource(stream);
        this.worklet=new AudioWorkletNode(this.ctx,'iv-voice',{processorOptions:settings});
        this.source.connect(this.worklet);this.worklet.connect(this.sink);
        this.worklet.port.onmessage=({data})=>onBlock(data);
        this.meter=this.ctx.createAnalyser();this.meter.fftSize=256;this.source.connect(this.meter);
      } catch(e) {this.disconnectMic();throw e;}
    }
    this.update(settings);return this.ctx;
  }
  update(settings) {
    this.worklet?.port.postMessage({settings});
    if(this.chain) {this.worklet.disconnect(this.chain.input);this.chain.disconnect();this.chain=null;}
    if(this.monitor&&this.worklet) {
      this.chain=effects(this.ctx,settings);
      this.worklet.connect(this.chain.input);this.chain.output.connect(this.ctx.destination);
    }
  }
  disconnectMic() {
    this.micGeneration=(this.micGeneration||0)+1;
    this.worklet?.disconnect();this.source?.disconnect();this.chain?.disconnect();
    this.stream?.getTracks().forEach(t=>t.stop());
    this.worklet=null;this.source=null;this.chain=null;this.stream=null;this.meter=null;
  }
  stop() {
    for(const node of this.nodes||[])try {node.stop();}catch {}
    this.nodes=[];clearInterval(this.clickTimer);
  }
  async play(project,position,loop,metronome,when,isRecording=false) {
    await this.init();this.stop();this.nodes=[];
    const origin=when||this.ctx.currentTime+0.12;
    const end=loop?project.loopEnd:isRecording?position+600:Math.max(project.beat?.duration||0,...project.clips.map(c=>c.start+c.audio.duration),position+1);
    const segment=end-position;
    if(segment<=0)throw new Error('Loop end must be later than loop start.');
    const schedule=(buffer,start,gainValue)=>{
      const source=this.ctx.createBufferSource();source.buffer=buffer;
      const gain=this.ctx.createGain();gain.gain.value=gainValue;source.connect(gain).connect(this.ctx.destination);
      const offset=Math.max(0,position-start), delay=Math.max(0,start-position);
      if(offset>=buffer.duration||delay>=segment)return;
      source.start(origin+delay,offset,Math.min(buffer.duration-offset,segment-delay));
      this.nodes.push(source);
    };
    const run=()=>{
      if(project.beat&&!project.acapella)schedule(project.beat,0,project.beatGain*(project.master??1));
      for(const c of project.clips)if(!c.mute&&c.rendered)schedule(c.rendered,c.start,c.gain*(project.master??1));
    };
    run();
    // Loop sources independently on a common full-loop buffer, including silence.
    if(loop) {
      this.stop();this.nodes=[];
      const combined=this.ctx.createBuffer(2,Math.ceil(segment*this.ctx.sampleRate),this.ctx.sampleRate);
      const off=new OfflineAudioContext(2,combined.length,this.ctx.sampleRate);
      const add=(buffer,start,g)=>{
        const src=off.createBufferSource();src.buffer=buffer;
        const vol=off.createGain();vol.gain.value=g;src.connect(vol).connect(off.destination);
        const offset=Math.max(0,position-start),delay=Math.max(0,start-position);
        if(offset<buffer.duration&&delay<segment)src.start(delay,offset,Math.min(buffer.duration-offset,segment-delay));
      };
      if(project.beat&&!project.acapella)add(project.beat,0,project.beatGain*(project.master??1));
      for(const c of project.clips)if(!c.mute&&c.rendered)add(c.rendered,c.start,c.gain*(project.master??1));
      const buffer=await off.startRendering();
      const src=this.ctx.createBufferSource();src.buffer=buffer;src.loop=true;src.loopEnd=segment;
      src.connect(this.ctx.destination);
      this.origin=Math.max(origin,this.ctx.currentTime+0.12);
      src.start(this.origin);this.nodes.push(src);
    } else this.origin=origin;
    this.position=position;this.segment=segment;this.loop=loop;
    let next=0;
    if(metronome) {
      const beat=60/project.bpm, phase=project.gridOffset||0;
      const click=()=>{
        const elapsed=this.ctx.currentTime-this.origin;
        while(next<elapsed+0.15) {
          if(next>=0&&(loop||next<segment)) {
            const cycle=loop?Math.floor(next/segment):0;
            const local=position+next-cycle*segment;
            const index=Math.ceil((local-phase-0.00001)/beat);
            let target=cycle*segment+phase+index*beat-position;
            if(loop&&target>=(cycle+1)*segment-0.00001) {next=(cycle+1)*segment+0.0001;continue;}
            target=Math.max(next,target);
            const t=this.origin+target;
            if(t>=this.ctx.currentTime) {
              const osc=this.ctx.createOscillator(),g=this.ctx.createGain();
              osc.frequency.value=index%4===0?1400:950;g.gain.setValueAtTime(0.12,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.035);
              osc.connect(g).connect(this.ctx.destination);osc.start(t);osc.stop(t+0.04);
              this.nodes.push(osc);
            }
            next=target+0.001;
          } else next+=beat;
        }
      };
      this.clickTimer=setInterval(click,25);click();
    }
    return this.origin;
  }
}

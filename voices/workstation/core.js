import {clamp, SOUND_DEFAULTS, validateSettings} from './model.js';
import {nearestNote, VoiceDSP, alignOnsets} from './legacy.js';
import {correctedCore, requiredTailFrames, minimumGapHops} from './reliability-schema.js';
export const dbGain = d => Math.pow(10, d / 20);
export const levelDb = v => 20 * Math.log10(Math.max(1e-12, v));
export function measure(channels) {
  let peak=0, sum=0, n=0, activeSum=0, active=0, clipped=0;
  for (const c of channels) for (const sample of c) {
    if (!Number.isFinite(sample)) throw new Error('Audio contains a non-finite sample.');
    const v=Math.abs(sample);peak=Math.max(peak,v);sum+=sample*sample;n++;
    if(v>0.006){activeSum+=sample*sample;active++;} if(v>=1)clipped++;
  }
  const rms=Math.sqrt(sum/Math.max(1,n));
  return {peak, peakDb:levelDb(peak), rms, rmsDb:levelDb(rms),
    activeRms:Math.sqrt(activeSum/Math.max(1,active)), crestDb:levelDb(peak)-levelDb(rms), clipped};
}
// Fractional-lag YIN estimate. Explicitly confidence-gated; noisy or unvoiced
// frames are not represented as a confidently detected musical note.
export function yin(frame, rate, minimum=65, maximum=900) {
  const maxLag=Math.min(Math.floor(rate/minimum),Math.floor(frame.length/2)-2);
  const minLag=Math.max(2,Math.floor(rate/maximum));
  let energy=0,mean=0;
  for(const x of frame)mean+=x;mean/=frame.length;
  for(const x of frame)energy+=(x-mean)*(x-mean);
  if(energy/frame.length<0.00002 || maxLag<=minLag) return {hz:0,confidence:0};
  const d=new Float64Array(maxLag+1);let running=0;
  d[0]=1;
  for(let lag=1;lag<=maxLag;lag++) {
    let total=0;
    for(let j=0;j<frame.length-maxLag;j++){const delta=frame[j]-frame[j+lag];total+=delta*delta;}
    running+=total;d[lag]=running?total*lag/running:1;
  }
  let selected=0,best=1;
  for(let lag=minLag;lag<maxLag;lag++) {
    if(d[lag]<best){best=d[lag];selected=lag;}
    if(d[lag]<0.12 && d[lag]<=d[lag-1] && d[lag]<d[lag+1]){selected=lag;break;}
  }
  if(!selected || d[selected]>0.2)return {hz:0,confidence:Math.max(0,1-best)};
  const a=d[selected-1],b=d[selected],c=d[selected+1];
  const denominator=a-2*b+c;
  const fraction=Math.abs(denominator)>1e-12?clamp(0.5*(a-c)/denominator,-0.5,0.5):0;
  return {hz:rate/(selected+fraction),confidence:clamp(1-b,0,1)};
}
// Independent four-grain, cubic-interpolated pitch path. It is a local DSP
// engine, not a trained neural voice model and not a formant-quality promise.
export class InfectedPitch {
  constructor(rate, settings={}) {
    this.rate=rate;this.settings={...SOUND_DEFAULTS,...settings};
    this.ring=new Float32Array(32768);this.at=0;this.phase=0;this.subPhase=0;
    this.window=Math.round(rate*0.04);this.latency=Math.round(this.window/2)+96;
    this.ratio=1;this.target=1;this.counter=0;this.confidence=0;
    this.frame=new Float32Array(512);
  }
  configure(settings){Object.assign(this.settings,settings);}
  read(delay) {
    const p=(this.at-delay+65536)%32768,k=Math.floor(p),t=p-k;
    const a=this.ring[(k-1)&32767],b=this.ring[k&32767],c=this.ring[(k+1)&32767],d=this.ring[(k+2)&32767];
    return b+0.5*t*(c-a+t*(2*a-5*b+4*c-d+t*(3*(b-c)+d-a)));
  }
  grain(phase) {
    let sum=0,weight=0;
    for(let i=0;i<4;i++){
      const p=(phase+i*0.25)%1,w=Math.pow(Math.sin(Math.PI*p),2);
      sum+=this.read(96+p*this.window)*w;weight+=w;
    }
    return sum/Math.max(1e-6,weight);
  }
  sample(input) {
    this.ring[this.at]=input;const s=this.settings;
    if(++this.counter%512===0) {
      for(let i=0;i<512;i++)this.frame[i]=this.read((511-i)*4);
      const pitch=yin(this.frame,this.rate/4);this.confidence=pitch.hz?pitch.confidence:0;
      let correction=0;
      if(pitch.hz){const n=69+12*Math.log2(pitch.hz/440);correction=(nearestNote(n,s.root,s.scale)-n)*s.tune;}
      this.target=Math.pow(2,(correction+s.shift)/12);
    }
    const speed=1-Math.exp(-1/(this.rate*Math.max(0.001,s.retune/1000)));
    this.ratio+=(this.target-this.ratio)*speed;
    this.phase=(this.phase+(1-this.ratio)/this.window+1)%1;
    this.subPhase=(this.subPhase+(1-this.ratio*0.5)/this.window+1)%1;
    const bypass=Math.abs(this.ratio-1)<0.0001 && !s.sub;
    let out=bypass?this.read(this.latency):this.grain(this.phase)*(1-s.sub*0.45)+this.grain(this.subPhase)*s.sub;
    this.at=(this.at+1)&32767;
    return Number.isFinite(out)?out:0;
  }
}
export function pitchRender(input,rate,settings,engine,sections=[],start=0) {
  validateSettings({...SOUND_DEFAULTS,...settings});
  if(!settings.tune&&!settings.shift&&!settings.sub)return input.slice();
  const s={...settings,drive:0,gate:-120,glitch:0};
  const dsp=engine==='infected'?new InfectedPitch(rate,s):new VoiceDSP(rate,s);
  const latency=engine==='infected'?dsp.latency:Math.round(rate*0.045/2)+64;
  const out=new Float32Array(input.length);
  for(let i=0;i<input.length+latency;i++){
    if(i%512===0){const section=sections.find(v=>start+i/rate>=v.start&&start+i/rate<v.end);dsp.configure(section?{...s,root:section.root,scale:section.scale}:s);}
    const v=dsp.sample(input[i]||0);if(i>=latency)out[i-latency]=v;
  }
  return out;
}
class Biquad {
  constructor(rate,type,hz,gain=0,q=0.707) {
    const w=2*Math.PI*clamp(hz,10,rate*0.45)/rate,c=Math.cos(w),sn=Math.sin(w),alpha=sn/(2*q),A=Math.pow(10,gain/40);
    let b0,b1,b2,a0,a1,a2;
    if(type==='highpass'){b0=(1+c)/2;b1=-(1+c);b2=b0;a0=1+alpha;a1=-2*c;a2=1-alpha;}
    else if(type==='peaking'){b0=1+alpha*A;b1=-2*c;b2=1-alpha*A;a0=1+alpha/A;a1=-2*c;a2=1-alpha/A;}
    else {
      const root=2*Math.sqrt(A)*alpha;
      b0=A*((A+1)-(A-1)*c+root);b1=2*A*((A-1)-(A+1)*c);b2=A*((A+1)-(A-1)*c-root);
      a0=(A+1)+(A-1)*c+root;a1=-2*((A-1)+(A+1)*c);a2=(A+1)+(A-1)*c-root;
    }
    this.b0=b0/a0;this.b1=b1/a0;this.b2=b2/a0;this.a1=a1/a0;this.a2=a2/a0;this.z1=0;this.z2=0;
  }
  sample(x){const y=x*this.b0+this.z1;this.z1=x*this.b1-this.a1*y+this.z2;this.z2=x*this.b2-this.a2*y;return y;}
}
export function soundRender(input,rate,s) {
  const tail=correctedCore(s)?requiredTailFrames(s,rate):Math.round(rate*Math.min(1.5,Math.max(s.echo?s.delay*2:0,s.reverb?0.5:0)));
  const out=new Float32Array(input.length+tail),dry=new Float32Array(out.length);
  const highpass=new Biquad(rate,'highpass',s.highpass),body=new Biquad(rate,'lowshelf',220,s.body),presence=new Biquad(rate,'peaking',3200,s.presence,0.7);
  const hf=new Biquad(rate,'highpass',5500),attack=Math.exp(-1/(rate*0.008)),release=Math.exp(-1/(rate*0.14));
  let envelope=0,gate=0,sibilance=0,previous=0;
  const threshold=dbGain(s.gate),output=dbGain(s.gain),dc=Math.exp(-1/(rate*0.08));
  for(let i=0;i<input.length;i++){
    let v=presence.sample(body.sample(highpass.sample(input[i])));
    const abs=Math.abs(v),open=abs>threshold?1:0;
    gate+=(open-gate)*(open?0.02:0.001);
    const high=hf.sample(v);sibilance=Math.max(Math.abs(high),sibilance*dc);
    const deess=clamp((levelDb(sibilance)+28)/20,0,1)*(s.deess??0.25);
    v-=high*deess*0.8;
    const a=abs>envelope?attack:release;envelope=a*envelope+(1-a)*abs;
    const over=levelDb(envelope)-s.compression;
    const knee=6;let reduction=0;
    if(over>knee/2)reduction=over*(1-1/s.ratio);
    else if(over>-knee/2)reduction=(1-1/s.ratio)*Math.pow(over+knee/2,2)/(2*knee);
    v*=gate*dbGain(-reduction);
    if(s.drive){const k=1+s.drive*8;const a=Math.tanh((previous+v)*0.5*k),b=Math.tanh(v*k);previous=v;v=v*(1-s.drive)+(a+b)*0.5*s.drive/Math.sqrt(k);}
    if(s.glitch)v*=((i/rate)%0.23)<0.025?1-s.glitch*0.9:1;
    dry[i]=v*output;
  }
  const echo=Math.round(s.delay*rate), taps=[[0.029,0.35],[0.043,0.28],[0.079,0.22],[0.113,0.16],[0.173,0.1],[0.251,0.06]];
  for(let i=0;i<out.length;i++){
    let v=dry[i];if(i>=echo)v+=dry[i-echo]*s.echo;if(i>=echo*2)v+=dry[i-echo*2]*s.echo*0.24;
    for(const [time,level] of taps){const index=i-Math.round(time*rate);if(index>=0)v+=dry[index]*s.reverb*level;}
    out[i]=Number.isFinite(v)?v:0;
  }
  return out;
}
export function legacySound(ctx,input,s) {
  const hp=ctx.createBiquadFilter();hp.type='highpass';hp.frequency.value=s.highpass;
  const body=ctx.createBiquadFilter();body.type='lowshelf';body.frequency.value=220;body.gain.value=s.body;
  const presence=ctx.createBiquadFilter();presence.type='peaking';presence.frequency.value=3200;presence.Q.value=0.7;presence.gain.value=s.presence;
  const comp=ctx.createDynamicsCompressor();comp.threshold.value=s.compression;comp.ratio.value=s.ratio;comp.attack.value=0.008;comp.release.value=0.14;
  const output=ctx.createGain();output.gain.value=dbGain(s.gain);
  input.connect(hp).connect(body).connect(presence).connect(comp).connect(output);
  const delay=ctx.createDelay(2);delay.delayTime.value=s.delay;
  const wet=ctx.createGain();wet.gain.value=s.echo;
  comp.connect(delay).connect(wet).connect(output);
  if(correctedCore(s)){
    const second=ctx.createDelay(2);second.delayTime.value=s.delay*2;
    const secondWet=ctx.createGain();secondWet.gain.value=s.echo*0.24;
    comp.connect(second).connect(secondWet).connect(output);
  }else{
    const feedback=ctx.createGain();feedback.gain.value=0.24;delay.connect(feedback).connect(output);
  }
  for(const [time,level] of [[0.029,0.35],[0.043,0.28],[0.079,0.22],[0.113,0.16],[0.173,0.1],[0.251,0.06]]){
    const d=ctx.createDelay();d.delayTime.value=time;const g=ctx.createGain();g.gain.value=s.reverb*level;comp.connect(d).connect(g).connect(output);
  }
  return output;
}
export function alignPhrases(x,rate,start,bpm,offset,settings,revision='legacy-2026-09') {
  const {strength,maxMove,division,swing,preserve}=settings;
  if(!strength||!maxMove)return {audio:x.slice(),moved:0,skipped:0};
  const hop=Math.max(1,Math.round(rate*0.005)),energy=[];let peak=0;
  for(let i=0;i<x.length;i+=hop){let e=0;for(let j=i;j<Math.min(i+hop,x.length);j++)e+=x[j]*x[j];const r=Math.sqrt(e/hop);energy.push(r);peak=Math.max(peak,r);}
  if(peak<0.001)return {audio:x.slice(),moved:0,skipped:0};
  const threshold=Math.max(0.002,peak*settings.sensitivity*0.18),silence=revision==='reliability-1'?minimumGapHops(settings.minGapMs,rate,hop):Math.max(3,Math.round(settings.minGapMs/15));
  const islands=[];let begin=-1,last=-1;
  for(let i=0;i<energy.length+silence;i++){
    if(i<energy.length&&energy[i]>threshold){if(begin<0)begin=Math.max(0,i-1);last=i;}
    if(begin>=0&&i-last>=silence){islands.push({a:begin*hop,b:Math.min(x.length,(last+2)*hop)});begin=-1;}
  }
  const step=60/bpm*4/division,out=x.slice();let moved=0,skipped=0;
  const planned=islands.map((s,i)=>{
    let onset=s.a;while(onset<s.b&&Math.abs(x[onset])<threshold)onset++;
    const t=start+onset/rate,n=Math.round((t-offset)/step),grid=offset+n*step+(Math.abs(n)%2?swing*step:0);
    const delta=Math.round(clamp((grid-t)*strength*(1-preserve*0.08),-maxMove/1000,maxMove/1000)*rate);
    const low=i?islands[i-1].b:0,high=islands[i+1]?.a??x.length;
    if(s.a+delta<low||s.b+delta>high){skipped++;return {...s,delta:0};}
    return {...s,delta};
  });
  for(let i=1;i<planned.length;i++)if(planned[i-1].b+planned[i-1].delta>planned[i].a+planned[i].delta){planned[i-1].delta=0;planned[i].delta=0;skipped++;}
  for(const s of planned)if(s.delta)out.fill(0,s.a,s.b);
  for(const s of planned)if(s.delta){out.set(x.subarray(s.a,s.b),s.a+s.delta);moved++;}
  return {audio:out,moved,skipped,detectedRegions:islands.length};
}
export function alignAudio(x,rate,start,p) {
  return p.engines.timing==='infected'?alignPhrases(x,rate,start,p.bpm,p.gridOffset,p.timing,p.coreRevision):alignOnsets(x,rate,start,p.bpm,p.gridOffset,p.timing.division,p.timing.strength,p.timing.maxMove/1000,p.timing);
}
// Stereo-linked lookahead limiter with a sliding-window peak maximum.
// The output is sample-peak limited; this is NOT an intersample true-peak claim.
export function limitLookahead(channels,rate,ceilingDb=-1,releaseMs=100) {
  const length=channels[0].length,lookahead=Math.max(1,Math.round(rate*0.005));
  const peaks=new Float32Array(length),forward=new Float32Array(length),deque=new Int32Array(length);
  for(let i=0;i<length;i++)for(const c of channels)peaks[i]=Math.max(peaks[i],Math.abs(c[i]));
  let head=0,tail=0;
  for(let i=length-1;i>=0;i--){
    while(head<tail&&deque[head]>i+lookahead)head++;
    while(head<tail&&peaks[deque[tail-1]]<=peaks[i])tail--;
    deque[tail++]=i;forward[i]=peaks[deque[head]];
  }
  const ceiling=dbGain(ceilingDb),release=Math.exp(-1/(rate*releaseMs/1000));let gain=1;
  const out=channels.map(()=>new Float32Array(length));
  for(let i=0;i<length;i++){
    const desired=Math.min(1,ceiling/Math.max(ceiling,forward[i]));
    gain=desired<gain?desired:release*gain+(1-release)*desired;
    for(let c=0;c<channels.length;c++)out[c][i]=clamp(channels[c][i]*gain,-ceiling,ceiling);
  }
  return out;
}
export function masterAudio(channels,rate,p) {
  const s=p.mastering,work=channels.map(c=>c.slice()),before=measure(work);
  const ceiling=dbGain(s.ceiling),target=dbGain(s.targetDb);
  let gain=before.rms>1e-7?Math.min(8,target/before.rms):1;
  if(p.engines.master==='legacy')gain=Math.min(gain,ceiling/Math.max(ceiling,before.peak));
  let envelope=0;const attack=Math.exp(-1/(rate*0.012)),release=Math.exp(-1/(rate*0.16));
  for(let i=0;i<work[0].length;i++){
    let l=work[0][i]*gain,r=(work[1]?.[i]??work[0][i])*gain;
    const peak=Math.max(Math.abs(l),Math.abs(r)),a=peak>envelope?attack:release;envelope=a*envelope+(1-a)*peak;
    const threshold=-8-24*s.compression,ratio=1+5*s.compression;
    const reduction=Math.max(0,levelDb(envelope)-threshold)*(1-1/ratio);
    const comp=dbGain(-reduction);l*=comp;r*=comp;
    if(s.drive){l=Math.tanh(l*(1+s.drive*4))/(1+s.drive*0.8);r=Math.tanh(r*(1+s.drive*4))/(1+s.drive*0.8);}
    const mid=(l+r)/2,side=(l-r)/2*s.width;
    work[0][i]=mid+side;if(work[1])work[1][i]=mid-side;
  }
  if(p.engines.master==='infected')return limitLookahead(work,rate,s.ceiling);
  for(const c of work)for(let i=0;i<c.length;i++)c[i]=clamp(c[i],-ceiling,ceiling);
  return work;
}

export function legacyShape(input,rate,s) {
  const out=new Float32Array(input.length);let env=0,gate=0;
  for(let i=0;i<input.length;i++){
    let v=input[i];env=Math.max(Math.abs(v),env*0.999);const target=env>dbGain(s.gate)?1:0;gate+=(target-gate)*(target?0.02:0.001);v*=gate;
    if(s.drive>0)v=(1-s.drive)*v+s.drive*Math.tanh(v*(1+8*s.drive))/(1+s.drive*2);
    if(s.glitch>0)v*=((i/rate)%0.23)<0.025?1-s.glitch*0.9:1;
    out[i]=Number.isFinite(v)?v:0;
  }
  return out;
}

// Compatibility algorithms retained from the deployed 0.4.x browser engine.
import {SOUND_DEFAULTS as defaults, clamp} from './model.js';
export const scales = {chromatic:[0,1,2,3,4,5,6,7,8,9,10,11],major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,10],pentatonic:[0,3,5,7,10]};
export function nearestNote(note, root, scale) {
  let best = note, distance = Infinity;
  const allowed = scales[scale] || scales.minor;
  for (let n = Math.floor(note)-12; n <= Math.ceil(note)+12; n++) {
    if (allowed.includes(((n-root)%12+12)%12) && Math.abs(n-note)<distance) {
      best=n; distance=Math.abs(n-note);
    }
  }
  return best;
}
export function detectPitch(x, sr) {
  let energy=0;
  for (const v of x) energy+=v*v;
  if (energy/x.length < 0.000025) return 0;
  const lo=Math.floor(sr/900), hi=Math.min(Math.floor(sr/65),Math.floor(x.length/2)-1);
  let total=0, previous=1, best=1, lag=0;
  for (let tau=1;tau<=hi;tau++) {
    let diff=0;
    for (let j=0;j<x.length-hi;j++) {const d=x[j]-x[j+tau];diff+=d*d;}
    total+=diff;
    const score=total ? diff*tau/total : 1;
    if (tau>=lo && score<best) {best=score;lag=tau;}
    if (tau>lo && previous<0.13 && score>previous) return sr/(tau-1);
    previous=score;
  }
  return best<0.2 ? sr/lag : 0;
}
export class VoiceDSP {
  constructor(sr, settings={}) {
    this.sr=sr;this.s={...defaults,...settings};this.ring=new Float32Array(32768);
    this.at=0;this.phase=0;this.subPhase=0;this.ratio=1;this.target=1;
    this.pitch=0;this.counter=0;this.env=0;this.gateGain=0;
    this.window=Math.round(sr*0.045);
  }
  configure(s) {Object.assign(this.s,s);}
  read(delay) {
    const p=(this.at-delay+this.ring.length*2)%this.ring.length;
    const k=Math.floor(p),f=p-k;
    return this.ring[k]*(1-f)+this.ring[(k+1)%this.ring.length]*f;
  }
  grain(phase) {
    const w=0.5-0.5*Math.cos(phase*2*Math.PI),q=(phase+0.5)%1;
    return this.read(64+phase*this.window)*w+this.read(64+q*this.window)*(1-w);
  }
  sample(input) {
    const s=this.s;this.ring[this.at]=input;
    if (++this.counter%1024===0) {
      const frame=new Float32Array(512);
      for (let i=0;i<512;i++) frame[i]=this.read((511-i)*4);
      this.pitch=detectPitch(frame,this.sr/4);
      let correction=0;
      if (this.pitch) {
        const note=69+12*Math.log2(this.pitch/440);
        correction=(nearestNote(note,Number(s.root),s.scale)-note)*s.tune;
      }
      this.target=Math.pow(2,(correction+s.shift)/12);
    }
    const speed=1-Math.exp(-1/(this.sr*Math.max(0.001,s.retune/1000)));
    this.ratio+=(this.target-this.ratio)*speed;
    this.phase=(this.phase+(1-this.ratio)/this.window+1)%1;
    this.subPhase=(this.subPhase+(1-this.ratio*0.5)/this.window+1)%1;
    let voice=this.grain(this.phase);
    voice=voice*(1-s.sub*0.45)+this.grain(this.subPhase)*s.sub;
    this.env=Math.max(Math.abs(input),this.env*0.999);
    const target=this.env>Math.pow(10,s.gate/20)?1:0;
    this.gateGain+=(target-this.gateGain)*(target?0.02:0.001);
    voice*=this.gateGain;
    if (s.drive>0) voice=(1-s.drive)*voice+s.drive*Math.tanh(voice*(1+8*s.drive))/(1+s.drive*2);
    if (s.glitch>0) voice*=((this.counter/this.sr)%0.23)<0.025?1-s.glitch*0.9:1;
    this.at=(this.at+1)%this.ring.length;
    return Number.isFinite(voice)?voice:0;
  }
}
export function onsets(x,sr,sensitivity=0.14,refractoryMs=90) {
  const hop=Math.round(sr*0.01),energy=[];
  for (let i=0;i<x.length;i+=hop) {
    let sum=0;for(let j=i;j<Math.min(i+hop,x.length);j++)sum+=x[j]*x[j];
    energy.push(Math.sqrt(sum/hop));
  }
  let max=0.001;for(const v of energy)max=Math.max(max,v);
  const out=[];let last=-100;
  const threshold=clamp(Number(sensitivity)||0.14,0.03,0.8);
  const refractory=Math.max(1,Math.round(refractoryMs/10));
  for (let i=1;i<energy.length;i++) {
    const baseline=(energy[i-1]+(energy[i-2]||0))/2;
    if (energy[i]>max*threshold && energy[i]>baseline*1.65+0.004 && i-last>refractory) {
      out.push(i*hop);last=i;
    }
  }
  return out;
}
export function alignOnsets(x,sr,start,bpm,offset,division,strength,maxMove,options={}) {
  if (![sr,start,bpm,offset,division,strength,maxMove].every(Number.isFinite)||sr<=0||bpm<=0||division<=0||strength<0||strength>1||maxMove<0) throw new Error('Invalid timing settings.');
  const out=x.slice();
  if (strength===0||maxMove===0) return {audio:out,moved:0,skipped:0};
  const mode=options.mode==='full'?'full':'conservative';
  const sensitivity=clamp(Number(options.sensitivity??0.14),0.03,0.8);
  const preserve=clamp(Number(options.preserve??0.75),0,1);
  const swing=clamp(Number(options.swing??0),-0.35,0.35);
  const starts=onsets(x,sr,sensitivity,Number(options.minGapMs??90));
  const boundaries=[0,...starts.filter(v=>v>0),x.length],segments=[];
  const step=60/bpm*4/division;
  for (let n=0;n<boundaries.length-1;n++) {
    let a=boundaries[n],b=boundaries[n+1];
    while(a<b&&Math.abs(x[a])<0.002)a++;
    while(b>a&&Math.abs(x[b-1])<0.002)b--;
    if(a===b)continue;
    const time=start+a/sr,gridIndex=Math.round((time-offset)/step);
    const snap=offset+gridIndex*step+(Math.abs(gridIndex)%2===1?swing*step:0);
    const localStrength=(mode==='full'?Math.min(1,strength*1.16+0.08):strength)*(1-preserve*(mode==='full'?0.1:0.18));
    const limit=mode==='full'?Math.min(maxMove*1.75,0.25):maxMove;
    segments.push({a,b,dest:a+Math.round(clamp((snap-time)*localStrength,-limit,limit)*sr)});
  }
  let skipped=0;
  for (let i=0;i<segments.length;i++) {
    const s=segments[i],low=i?segments[i-1].b:0,high=segments[i+1]?.a??x.length;
    if(s.dest<low||s.dest+s.b-s.a>high){s.dest=s.a;skipped++;}
  }
  for (let i=1;i<segments.length;i++) {
    const l=segments[i-1],r=segments[i];
    if(l.dest+l.b-l.a>r.dest) {
      if(l.dest!==l.a){l.dest=l.a;skipped++;}
      if(r.dest!==r.a){r.dest=r.a;skipped++;}
    }
  }
  const moved=segments.filter(s=>s.dest!==s.a);
  for(const s of moved)out.fill(0,s.a,s.b);
  for(const s of moved)out.set(x.subarray(s.a,s.b),s.dest);
  return {audio:out,moved:moved.length,skipped};
}

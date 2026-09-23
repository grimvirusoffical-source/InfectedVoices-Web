export const defaults = {
  root: 7, scale: 'minor', tune: 0.7, retune: 65, shift: 0, sub: 0,
  drive: 0, gate: -52, highpass: 85, body: 0, presence: 2,
  compression: -20, ratio: 3, echo: 0.08, delay: 0.25, reverb: 0.08,
  gain: 0, glitch: 0
};
export const presets = {
  'Clean rap': {...defaults},
  'Grim': {...defaults, shift: -5, sub: 0.3, drive: 0.3, body: 4, presence: 1, echo: 0.14, reverb: 0.14, glitch: 0.06},
  'Grim abyss': {...defaults, shift: -9, sub: 0.48, drive: 0.5, body: 6, presence: 0, echo: 0.2, reverb: 0.23, glitch: 0.13},
  'Singing': {...defaults, tune: 0.8, retune: 90, compression: -22, ratio: 3, echo: 0.2, reverb: 0.3},
  'Hard tune': {...defaults, tune: 1, retune: 5, echo: 0.12, reverb: 0.16},
  'Acapella': {...defaults, echo: 0, reverb: 0, tune: 0.4, retune: 130}
};
// Pocket profiles are starting points for different rhythmic phrasing. They
// tune the grid and detector together so a user can audition a useful setup
// before fine-tuning strength, swing and movement by ear.
export const pocketProfiles = {
  Rap: {division: 16, strength: .82, maxMove: 82, swing: 0, sensitivity: .55, preserve: .72},
  'Hip-hop': {division: 16, strength: .72, maxMove: 72, swing: .06, sensitivity: .5, preserve: .8},
  Trap: {division: 16, strength: .86, maxMove: 88, swing: .1, sensitivity: .5, preserve: .68},
  Rock: {division: 8, strength: .64, maxMove: 115, swing: 0, sensitivity: .44, preserve: .9},
  Metal: {division: 16, strength: .58, maxMove: 125, swing: 0, sensitivity: .42, preserve: .95},
  'Dubstep / EDM': {division: 16, strength: .78, maxMove: 105, swing: .03, sensitivity: .48, preserve: .7},
  'Grim glitchstep': {division: 16, strength: .9, maxMove: 110, swing: .04, sensitivity: .52, preserve: .62},
  'Singing / ballad': {division: 8, strength: .42, maxMove: 62, swing: 0, sensitivity: .35, preserve: .96}
};
// Master profiles change real render parameters. They are deliberately
// conservative starting points: the final file is still measured for peak
// headroom and should be auditioned before release.
export const masterDefaults = {
  profile: 'Rap', targetDb: -12, ceiling: -.1, compression: .45,
  vocalLevel: 0, beatLevel: 0, ducking: .18, width: 1.06,
  drive: .04, air: 0, lowCut: 28
};
export const masterProfiles = {
  Rap: {...masterDefaults, targetDb: -11.5, compression: .5, ducking: .22, width: 1.04, air: .6},
  'Hip-hop': {...masterDefaults, targetDb: -12, compression: .42, ducking: .26, width: 1.08, air: .9},
  Trap: {...masterDefaults, targetDb: -11, compression: .56, ducking: .28, width: 1.12, drive: .08, air: .5},
  Rock: {...masterDefaults, targetDb: -10, compression: .62, ducking: .12, width: 1.02, drive: .06, air: .2},
  Metal: {...masterDefaults, targetDb: -10.5, compression: .68, ducking: .1, width: 1.02, drive: .09, lowCut: 34},
  'Dubstep / EDM': {...masterDefaults, targetDb: -10.5, compression: .58, ducking: .35, width: 1.18, drive: .1, air: .4},
  'Grim glitchstep': {...masterDefaults, targetDb: -11, compression: .64, ducking: .38, width: 1.2, drive: .14, air: .2, lowCut: 35},
  'Acapella / vocal': {...masterDefaults, targetDb: -13, compression: .5, ducking: 0, width: 1.0, drive: .02, air: 1.2, lowCut: 60}
};
export const scales = {chromatic:[0,1,2,3,4,5,6,7,8,9,10,11],major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,10],pentatonic:[0,3,5,7,10]};
export const clamp = (x,a,b) => Math.max(a, Math.min(b,x));
export function nearestNote(note, root, scale) {
  let best = note, distance = Infinity;
  const allowed = scales[scale] || scales.minor;
  for(let n=Math.floor(note)-12;n<=Math.ceil(note)+12;n++) {
    if(allowed.includes(((n-root)%12+12)%12) && Math.abs(n-note)<distance) {
      best=n; distance=Math.abs(n-note);
    }
  }
  return best;
}
export function detectPitch(x, sr) {
  let energy=0;
  for(const v of x) energy+=v*v;
  if(energy/x.length < 0.000025) return 0;
  const lo=Math.floor(sr/900), hi=Math.min(Math.floor(sr/65),Math.floor(x.length/2)-1);
  let total=0, previous=1, best=1, lag=0;
  for(let tau=1;tau<=hi;tau++) {
    let diff=0;
    for(let j=0;j<x.length-hi;j++) {const d=x[j]-x[j+tau];diff+=d*d;}
    total+=diff;
    const score=total ? diff*tau/total : 1;
    if(tau>=lo && score<best) {best=score;lag=tau;}
    if(tau>lo && previous<0.13 && score>previous) return sr/(tau-1);
    previous=score;
  }
  return best<0.2 ? sr/lag : 0;
}
// Two crossfaded delay grains: constant duration pitch shift.
// Speech consonants bypass note correction when the pitch confidence is low.
export class VoiceDSP {
  constructor(sr, settings={}) {
    this.sr=sr;this.s={...defaults,...settings};this.ring=new Float32Array(32768);
    this.at=0;this.phase=0;this.subPhase=0;this.ratio=1;this.target=1;
    this.pitch=0;this.counter=0;this.env=0;this.gateGain=0;
    this.window=Math.round(sr*0.045);
  }
  configure(s) {Object.assign(this.s,s);}
  read(delay) {
    let p=(this.at-delay+this.ring.length*2)%this.ring.length;
    const k=Math.floor(p), f=p-k;
    return this.ring[k]*(1-f)+this.ring[(k+1)%this.ring.length]*f;
  }
  grain(phase) {
    const w=0.5-0.5*Math.cos(phase*2*Math.PI), q=(phase+0.5)%1;
    return this.read(64+phase*this.window)*w+this.read(64+q*this.window)*(1-w);
  }
  sample(input) {
    const s=this.s;
    this.ring[this.at]=input;
    if(++this.counter%1024===0) {
      const frame=new Float32Array(512);
      for(let i=0;i<512;i++) frame[i]=this.read((511-i)*4);
      this.pitch=detectPitch(frame,this.sr/4);
      let correction=0;
      if(this.pitch) {
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
    if(s.drive>0) voice=(1-s.drive)*voice+s.drive*Math.tanh(voice*(1+8*s.drive))/(1+s.drive*2);
    if(s.glitch>0) {
      const t=this.counter/this.sr;
      const pulse=(t%0.23)<0.025;
      voice*=pulse?1-s.glitch*0.9:1;
    }
    this.at=(this.at+1)%this.ring.length;
    return Number.isFinite(voice)?voice:0;
  }
}
export function mono(buffer) {
  const x=new Float32Array(buffer.length);
  for(let c=0;c<buffer.numberOfChannels;c++) {
    const a=buffer.getChannelData(c);
    for(let i=0;i<x.length;i++) x[i]+=a[i]/buffer.numberOfChannels;
  }
  return x;
}
export function metrics(x) {
  let sum=0,peak=0,n=0;
  for(let i=0;i<x.length;i++) {
    peak=Math.max(peak,Math.abs(x[i]));
    if(Math.abs(x[i])>0.006) {sum+=x[i]*x[i];n++;}
  }
  return {rms:Math.sqrt(sum/Math.max(1,n)),peak};
}
export function onsets(x,sr,sensitivity=.14,refractoryMs=90) {
  const hop=Math.round(sr*0.01), energy=[];
  for(let i=0;i<x.length;i+=hop) {
    let sum=0;for(let j=i;j<Math.min(i+hop,x.length);j++)sum+=x[j]*x[j];
    energy.push(Math.sqrt(sum/hop));
  }
  let max=0.001;
  for(const value of energy)max=Math.max(max,value);
  const out=[];
  let last=-100;
  const threshold=clamp(Number(sensitivity)||.14,.03,.8);
  const refractory=Math.max(1,Math.round(refractoryMs/10));
  for(let i=1;i<energy.length;i++) {
    const baseline=(energy[i-1]+(energy[i-2]||0))/2;
    if(energy[i]>max*threshold && energy[i]>baseline*1.65+0.004 && i-last>refractory) {
      out.push(i*hop);last=i;
    }
  }
  return out;
}
// Move phrase/syllable starts into adjacent silence. Preserve sample duration;
// refuse overlaps so the tool cannot silently overwrite words.
export function alignOnsets(x,sr,start,bpm,offset,division,strength,maxMove,options={}) {
  if(![sr,start,bpm,offset,division,strength,maxMove].every(Number.isFinite)||sr<=0||bpm<=0||division<=0||strength<0||strength>1||maxMove<0)throw new Error('Invalid timing correction settings.');
  const out=x.slice();
  if(strength===0||maxMove===0)return {audio:out,moved:0,skipped:0};
  const mode=options.mode==='full'?'full':'conservative';
  const sensitivity=clamp(Number(options.sensitivity??.14),.03,.8);
  const preserve=clamp(Number(options.preserve??.75),0,1);
  const swing=clamp(Number(options.swing??0),-.35,.35);
  const starts=onsets(x,sr,sensitivity,Number(options.minGapMs??90));
  const boundaries=[0,...starts.filter(v=>v>0),x.length];
  const segments=[];
  const step=60/bpm*4/division;
  for(let n=0;n<boundaries.length-1;n++) {
    let a=boundaries[n],b=boundaries[n+1];
    while(a<b&&Math.abs(x[a])<0.002)a++;
    while(b>a&&Math.abs(x[b-1])<0.002)b--;
    if(a===b)continue;
    const time=start+a/sr;
    const gridIndex=Math.round((time-offset)/step);
    const swingOffset=(Math.abs(gridIndex)%2===1?swing*step:0);
    const snap=offset+gridIndex*step+swingOffset;
    const localStrength=(mode==='full'?Math.min(1,strength*1.16+.08):strength)*(1-(preserve*(mode==='full'?.1:.18)));
    const moveLimit=mode==='full'?Math.min(maxMove*1.75,.25):maxMove;
    const delta=Math.round(clamp((snap-time)*localStrength,-moveLimit,moveLimit)*sr);
    segments.push({a,b,dest:a+delta});
  }
  let skipped=0;
  // Only move within the original silence around a segment. This conservative
  // rule leaves neighboring words untouched, including when their move fails.
  for(let i=0;i<segments.length;i++) {
    const s=segments[i],low=i?segments[i-1].b:0,high=segments[i+1]?.a??x.length;
    if(s.dest<low||s.dest+s.b-s.a>high){s.dest=s.a;skipped++;}
  }
  for(let i=1;i<segments.length;i++) {
    const left=segments[i-1],right=segments[i];
    if(left.dest+left.b-left.a>right.dest) {
      if(left.dest!==left.a){left.dest=left.a;skipped++;}
      if(right.dest!==right.a){right.dest=right.a;skipped++;}
    }
  }
  const moved=segments.filter(s=>s.dest!==s.a);
  for(const s of moved)out.fill(0,s.a,s.b);
  for(const s of moved)out.set(x.subarray(s.a,s.b),s.dest);
  return {audio:out,moved:moved.length,skipped};
}
export function estimateKey(x,sr,from,to) {
  const chroma=new Float64Array(12);
  const end=Math.min(x.length,Math.floor(to*sr));
  const start=Math.max(0,Math.floor(from*sr));
  const length=2048;
  for(let p=start;p+length<end;p+=Math.max(length,Math.floor((end-start)/24))) {
    for(let note=36;note<84;note++) {
      const w=2*Math.PI*440*Math.pow(2,(note-69)/12)/sr;
      let real=0,imag=0;
      for(let j=0;j<length;j+=2) {
        const sample=x[p+j]*(0.5-0.5*Math.cos(2*Math.PI*j/length));
        real+=sample*Math.cos(w*j);imag+=sample*Math.sin(w*j);
      }
      chroma[note%12]+=Math.sqrt(real*real+imag*imag);
    }
  }
  const major=[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
  const minor=[6.33,2.68,3.52,5.38,2.6,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
  const candidates=[];
  for(const [scale,profile] of [['major',major],['minor',minor]]) {
    for(let root=0;root<12;root++) {
      let dot=0;
      for(let i=0;i<12;i++)dot+=chroma[(root+i)%12]*profile[i];
      candidates.push({root,scale,score:dot});
    }
  }
  candidates.sort((a,b)=>b.score-a.score);
  return {...candidates[0],margin:(candidates[0].score-candidates[1].score)/Math.max(1,candidates[0].score)};
}

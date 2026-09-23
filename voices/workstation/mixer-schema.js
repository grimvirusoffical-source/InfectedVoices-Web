// Core 3 is an explicit arrangement v2 extension. Core 2 rejects v2 rather than
// silently ignoring buses. Original PCM and original/corrected DSP revisions stay unchanged.
export const MIXER_ENGINE = 'mixbus-1';
export const DIVISIONS = {'half':2,'quarter':1,'eighth':0.5,'dotted-eighth':0.75,'triplet-eighth':1/3,'sixteenth':0.25};
const number=(v,min,max,label)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error(label+' must be between '+min+' and '+max+'.');};
const obj=(v,label)=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Invalid '+label+'.');};
const flag=(v,label)=>{if(typeof v!=='boolean')throw Error('Invalid '+label+'.');};
export const hasMixer=p=>p?.mixer?.engine===MIXER_ENGINE&&p.mixer.enabled===true;
export function newRack(){return {bypass:false,highpass:{enabled:false,hz:80},eq:{enabled:false,bands:[
  {type:'lowshelf',hz:120,db:0,q:0.7},{type:'peaking',hz:450,db:0,q:1},
  {type:'peaking',hz:3000,db:0,q:1},{type:'highshelf',hz:10000,db:0,q:0.7}]},
  compressor:{enabled:false,threshold:-18,ratio:3,knee:6,attackMs:10,releaseMs:150,makeupDb:0,blend:1}};}
export function newStrip(){return {route:'main',delaySend:0,reverbSend:0,sendTap:'post',rack:newRack()};}
export function newMixer(){return {engine:MIXER_ENGINE,enabled:true,masterDb:0,delayReturnDb:-9,reverbReturnDb:-12,
  delayMute:false,reverbMute:false,
  buses:['Lead','Doubles','Ad-libs','Music'].map((name,i)=>({id:'bus-'+i,name,gainDb:0,mute:false,solo:false,rack:newRack()})),
  delay:{division:'quarter',repeats:4,feedback:0.4,lowcut:180,highcut:6000},
  reverb:{seconds:1.3,predelayMs:25,dampingHz:6500,width:0.8,seed:17891}};}
export function enableMixer(p){if(!p.mixer)p.mixer=newMixer();p.mixer.enabled=true;p.version=Math.max(2,p.version||1);for(const t of p.tracks)if(!t.mixStrip)t.mixStrip=newStrip();return p;}
export function validateRack(v){obj(v,'insert rack');flag(v.bypass,'rack bypass');obj(v.highpass,'high-pass');flag(v.highpass.enabled,'high-pass');number(v.highpass.hz,20,4000,'High-pass frequency');
  obj(v.eq,'EQ');flag(v.eq.enabled,'EQ');if(!Array.isArray(v.eq.bands)||v.eq.bands.length!==4)throw Error('Four EQ bands are required.');
  for(const b of v.eq.bands){obj(b,'EQ band');if(!['lowshelf','peaking','highshelf'].includes(b.type))throw Error('Unsupported EQ type.');number(b.hz,20,20000,'EQ frequency');number(b.db,-18,18,'EQ gain');number(b.q,0.1,12,'EQ bandwidth');}
  obj(v.compressor,'compressor');flag(v.compressor.enabled,'compressor');for(const [key,min,max] of [['threshold',-60,0],['ratio',1,20],['knee',0,24],['attackMs',0.1,100],['releaseMs',10,1500],['makeupDb',-18,18],['blend',0,1]])number(v.compressor[key],min,max,key);
}
export function validateMixer(p){
  if(p.mixer===undefined){if(p.version===2)throw Error('Core 3 v2 project is missing its mixer.');if(p.tracks?.some(t=>t.mixStrip!==undefined))throw Error('A track insert requires a Core 3 mixer.');return;}
  obj(p.mixer,'mixer');const m=p.mixer;if(![2,3,4].includes(p.version)||m.engine!==MIXER_ENGINE)throw Error('This mixer requires a compatible Core 3 project reader.');flag(m.enabled,'mixer enabled');
  number(m.masterDb,-24,6,'Master trim');number(m.delayReturnDb,-60,6,'Delay return');number(m.reverbReturnDb,-60,6,'Reverb return');flag(m.delayMute,'delay mute');flag(m.reverbMute,'reverb mute');
  if(!Array.isArray(m.buses)||m.buses.length>8)throw Error('At most eight buses are supported.');const ids=new Set();
  for(const b of m.buses){obj(b,'bus');if(typeof b.id!=='string'||!/^bus-[A-Za-z0-9_-]{1,80}$/.test(b.id)||ids.has(b.id)||typeof b.name!=='string'||!b.name.trim()||b.name.length>80)throw Error('Invalid or duplicate bus.');ids.add(b.id);number(b.gainDb,-60,12,'Bus level');flag(b.mute,'bus mute');flag(b.solo,'bus solo');validateRack(b.rack);}
  obj(m.delay,'delay');if(!Object.hasOwn(DIVISIONS,m.delay.division)||!Number.isInteger(m.delay.repeats))throw Error('Invalid tempo delay.');number(m.delay.repeats,1,6,'Delay repeats');number(m.delay.feedback,0,0.8,'Repeat decay');number(m.delay.lowcut,20,3000,'Delay low cut');number(m.delay.highcut,1000,20000,'Delay high cut');if(m.delay.lowcut>=m.delay.highcut)throw Error('Delay low cut must be below high cut.');
  obj(m.reverb,'reverb');for(const [k,min,max] of [['seconds',0.2,5],['predelayMs',0,150],['dampingHz',500,20000],['width',0,1],['seed',1,2147483647]])number(m.reverb[k],min,max,k);if(!Number.isInteger(m.reverb.seed))throw Error('Reverb seed must be an integer.');
  for(const t of p.tracks||[]){if(t.mixStrip===undefined)continue;const s=t.mixStrip;obj(s,'track strip');if(s.route!=='main'&&!ids.has(s.route))throw Error('Track references a missing bus.');if(!['pre','post'].includes(s.sendTap))throw Error('Invalid send tap.');number(s.delaySend,0,1,'Delay send');number(s.reverbSend,0,1,'Reverb send');validateRack(s.rack);}
}
export function strip(t){return t.mixStrip||newStrip();}
export function audibleMixIds(p){const m=p.mixer;const buses=new Map(m.buses.map(b=>[b.id,b]));const soloBuses=new Set(m.buses.filter(b=>b.solo).map(b=>b.id));const soloTracks=p.tracks.some(t=>t.solo);
  return new Set(p.tracks.filter(t=>{const route=strip(t).route;return !t.mute&&!buses.get(route)?.mute&&(!soloBuses.size&&!soloTracks||t.solo||soloBuses.has(route));}).map(t=>t.id));}
export function delaySeconds(p){return 60/p.bpm*DIVISIONS[p.mixer.delay.division];}
export function mixTailSeconds(p,raw=false){if(raw||!hasMixer(p))return 0;let tail=0.25;const ids=audibleMixIds(p);for(const t of p.tracks){if(!ids.has(t.id))continue;const s=strip(t);
  if(s.delaySend>0&&!p.mixer.delayMute)tail=Math.max(tail,delaySeconds(p)*(p.mixer.delay.feedback===0?1:p.mixer.delay.repeats)+0.25);
  if(s.reverbSend>0&&!p.mixer.reverbMute)tail=Math.max(tail,p.mixer.reverb.seconds+p.mixer.reverb.predelayMs/1000+0.25);}
  const grim=p.producer?.engine==='producer-1'&&p.producer?.enabled&&p.producer?.grim?.enabled?p.producer.grim:null;
  if(grim?.space>0){if(!p.mixer.delayMute)tail=Math.max(tail,delaySeconds(p)*(p.mixer.delay.feedback===0?1:p.mixer.delay.repeats)+0.25);if(!p.mixer.reverbMute)tail=Math.max(tail,p.mixer.reverb.seconds+p.mixer.reverb.predelayMs/1000+0.25);}
  return tail;}
export function mixerChangeIsLive(before,after){
  if(!hasMixer(before)||!hasMixer(after))return false;
  const normalize=p=>{p=structuredClone(p);delete p.modified;delete p.producer;delete p.mixer.masterDb;delete p.mixer.delayReturnDb;delete p.mixer.reverbReturnDb;delete p.mixer.delayMute;delete p.mixer.reverbMute;delete p.mixer.delay.lowcut;delete p.mixer.delay.highcut;
    for(const t of p.tracks){delete t.gainDb;delete t.pan;delete t.mute;delete t.solo;const s=t.mixStrip;if(s){delete s.rack;delete s.delaySend;delete s.reverbSend;}}
    for(const b of p.mixer.buses){delete b.gainDb;delete b.mute;delete b.solo;delete b.rack;}return JSON.stringify(p);};
  return normalize(before)===normalize(after);
}

// Starting points, not automatic mastering. They do not alter the earlier vocal engine.
export function rackPreset(name){const r=newRack();if(name==='Neutral')return r;r.highpass.enabled=true;r.eq.enabled=true;r.compressor.enabled=true;
  if(name==='Clean lead'){r.highpass.hz=80;r.eq.bands[1].db=-2;r.eq.bands[2].db=1.5;r.compressor.threshold=-20;r.compressor.ratio=3;}
  else if(name==='Controlled double'){r.highpass.hz=120;r.eq.bands[1].db=-3;r.eq.bands[3].db=-1;r.compressor.threshold=-22;r.compressor.ratio=4;r.compressor.attackMs=6;}
  else if(name==='Parallel punch'){r.highpass.hz=65;r.compressor.threshold=-26;r.compressor.ratio=6;r.compressor.attackMs=15;r.compressor.releaseMs=90;r.compressor.blend=.35;}
  else if(name==='GRIM body'){r.highpass.hz=65;r.eq.bands[0].db=2;r.eq.bands[1].db=-2;r.eq.bands[2].db=2;r.eq.bands[3].db=-1;r.compressor.threshold=-18;r.compressor.ratio=3;r.compressor.blend=.7;}
  else throw Error('Unknown insert preset.');return r;}

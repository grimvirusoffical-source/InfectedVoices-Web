import {FORMAT, validateProject, uid, SOUND_DEFAULTS, MASTER_PRESETS, TIMING_PRESETS, newProject, newTrack, newClip, clamp} from './model.js';

const encoder=new TextEncoder(),decoder=new TextDecoder();
export const memoryLimit=()=>typeof navigator!=='undefined'&&/iPhone|iPad|Android/i.test(navigator.userAgent)?256*1024*1024:768*1024*1024;
export function asset(id,name,rate,channels) {
  if(typeof id!=='string'||!id||id.length>100||typeof name!=='string'||name.length>160||!Number.isFinite(rate)||rate<8000||rate>192000||!Number.isInteger(rate)||!Array.isArray(channels)||channels.length<1||channels.length>2)throw Error('Invalid audio asset metadata.');
  const length=channels[0]?.length;
  if(!length||channels.some(c=>!(c instanceof Float32Array)||c.length!==length))throw Error('Invalid audio asset channels.');
  for(const c of channels)for(const v of c)if(!Number.isFinite(v))throw Error('Audio contains an invalid sample.');
  return {id,name,rate,channels,duration:length/rate,length,bytes:length*4*channels.length};
}
export function fromBuffer(buffer,name='Audio') {
  return asset(uid(),name.slice(0,160),buffer.sampleRate,Array.from({length:Math.min(2,buffer.numberOfChannels)},(_,i)=>buffer.getChannelData(i).slice()));
}
export function usedIds(p) {
  return new Set(p.clips.flatMap(c=>[c.assetId,c.originalAssetId]));
}
export function encodeProject(p,assets) {
  validateProject(p,assets);
  const list=[...usedIds(p)].map(id=>assets.get(id));let offset=0;
  const descriptors=list.map(a=>{const d={id:a.id,name:a.name,rate:a.rate,channels:a.channels.length,length:a.length,offset,bytes:a.bytes};offset+=a.bytes;return d;});
  const metadata=encoder.encode(JSON.stringify({project:p,assets:descriptors}));
  if(metadata.length>4*1024*1024||offset>memoryLimit())throw Error('This project exceeds the safe backup memory budget on this device. Export stems or move to a larger-memory device.');
  const header=new Uint8Array(8);header.set(encoder.encode('IVP5'));new DataView(header.buffer).setUint32(4,metadata.length,true);
  // Float32 typed arrays are copied into explicitly little-endian bytes for portability.
  const audio=list.flatMap(a=>a.channels.map(channel=>{const bytes=new Uint8Array(channel.length*4),view=new DataView(bytes.buffer);for(let i=0;i<channel.length;i++)view.setFloat32(i*4,channel[i],true);return bytes;}));
  return new Blob([header,metadata,...audio],{type:'application/x-infected-voices-project'});
}
export function decodeProject(bytes,budget=memoryLimit()) {
  if(!(bytes instanceof ArrayBuffer)||bytes.byteLength<10||bytes.byteLength>budget+4*1024*1024)throw Error('Invalid or oversized project file.');
  const view=new DataView(bytes);
  if(decoder.decode(new Uint8Array(bytes,0,4))!=='IVP5')throw Error('Choose an .ivproject file. Open older .ivweb backups with Import classic project.');
  const length=view.getUint32(4,true);if(length>4*1024*1024||8+length>bytes.byteLength)throw Error('Invalid project header.');
  const data=JSON.parse(decoder.decode(new Uint8Array(bytes,8,length)));
  if(!data||!Array.isArray(data.assets))throw Error('Invalid project assets.');
  const assets=new Map();let offset=0;
  for(const d of data.assets){
    if(!d||!Number.isInteger(d.length)||d.length<1||![1,2].includes(d.channels)||d.bytes!==d.length*d.channels*4||d.offset!==offset||offset+d.bytes>budget||8+length+offset+d.bytes>bytes.byteLength||assets.has(d.id))throw Error('Invalid project audio bounds.');
    const channels=[];
    for(let c=0;c<d.channels;c++){const channel=new Float32Array(d.length);for(let i=0;i<d.length;i++)channel[i]=view.getFloat32(8+length+offset+(c*d.length+i)*4,true);channels.push(channel);}
    assets.set(d.id,asset(d.id,d.name,d.rate,channels));offset+=d.bytes;
  }
  if(8+length+offset!==bytes.byteLength)throw Error('Unexpected trailing project data.');
  return {project:validateProject(data.project,assets),assets};
}
export function importClassic(data,budget=memoryLimit()) {
  if(!data||data.format!=='InfectedVoicesBrowser'||data.version!==1||!Array.isArray(data.clips))throw Error('This is not a classic .ivweb project.');
  const p=newProject(),assets=new Map();p.coreRevision='legacy-2026-09';p.title=String(data.title||'Imported classic session').slice(0,120);
  let total=0;
  const unpack=(b,name)=>{
    if(!b||!Array.isArray(b.channels))throw Error('Missing audio in classic project.');
    const size=b.channels.reduce((n,c)=>n+(Array.isArray(c)||ArrayBuffer.isView(c)?c.length:0)*4,0);
    total+=size;if(total>budget)throw Error('Classic project exceeds this device memory budget.');
    const a=asset(uid(),name,b.sr,b.channels.map(c=>new Float32Array(c)));assets.set(a.id,a);return a;
  };
  p.bpm=data.bpm;p.gridOffset=data.gridOffset||0;p.root=data.settings?.root??7;p.scale=data.settings?.scale||'minor';
  p.loopStart=data.loopStart||0;p.loopEnd=data.loopEnd||6.4;p.loop=!!data.loop;
  if(data.beat){const t=newTrack('Classic beat','beat'),a=unpack(data.beat,'Beat');t.gainDb=20*Math.log10(Math.max(0.001,data.beatGain??0.65));p.tracks.push(t);p.clips.push(newClip(t.id,a.id,a.duration,'Beat'));}
  for(const c of data.clips){
    const t=newTrack(String(c.name||'Vocal').slice(0,120),'vocal');t.settings={...SOUND_DEFAULTS,...data.settings};t.gainDb=clamp(20*Math.log10(Math.max(0.001,c.gain??1)),-60,12);t.mute=!!c.mute;p.tracks.push(t);
    const a=unpack(c.audio,String(c.name||'Vocal').slice(0,160)),original=unpack(c.original||c.audio,'Original '+String(c.name||'Vocal').slice(0,140));
    const clip=newClip(t.id,a.id,a.duration,a.name,c.start||0);clip.originalAssetId=original.id;p.clips.push(clip);
  }
  p.sections=data.sections||[];p.timing={...TIMING_PRESETS['Natural rap'],...data.pocketing};
  p.mastering={...MASTER_PRESETS.Balanced,...data.mastering};
  return {project:validateProject(p,assets),assets};
}
export function wav(channels,rate,bits=24) {
  if(![16,24].includes(bits)||![1,2].includes(channels.length)||!channels[0]?.length||channels.some(c=>c.length!==channels[0].length))throw Error('Invalid WAV export.');
  const bytes=bits/8,size=channels[0].length*channels.length*bytes;
  if(size>0xffffffff-44)throw Error('WAV is too large. Export shorter sections.');
  const buffer=new ArrayBuffer(44+size),v=new DataView(buffer),text=(p,s)=>{for(let i=0;i<s.length;i++)v.setUint8(p+i,s.charCodeAt(i));};
  text(0,'RIFF');v.setUint32(4,size+36,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels.length,true);v.setUint32(24,rate,true);v.setUint32(28,rate*channels.length*bytes,true);v.setUint16(32,channels.length*bytes,true);v.setUint16(34,bits,true);text(36,'data');v.setUint32(40,size,true);
  let at=44;
  for(let i=0;i<channels[0].length;i++)for(const channel of channels){
    if(!Number.isFinite(channel[i]))throw Error('Cannot export invalid audio.');
    const x=clamp(channel[i],-1,1);
    if(bits===16){v.setInt16(at,Math.round(x*(x<0?32768:32767)),true);at+=2;}
    else{const n=Math.round(x*(x<0?8388608:8388607));v.setUint8(at++,n&255);v.setUint8(at++,(n>>8)&255);v.setUint8(at++,(n>>16)&255);}
  }
  return new Blob([buffer],{type:'audio/wav'});
}
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(data){let c=0xffffffff;for(const b of data)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
export async function zip(files) {
  const parts=[],directory=[];let offset=0,centralSize=0;
  if(files.length>65535)throw Error('Too many files for this ZIP.');
  for(const file of files){
    if(!/^[^\\/]+$/.test(file.name)||file.name==='.'||file.name==='..')throw Error('Invalid export filename.');
    const name=encoder.encode(file.name),bytes=new Uint8Array(await file.blob.arrayBuffer()),crc=crc32(bytes);
    const head=new Uint8Array(30+name.length),h=new DataView(head.buffer);h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint32(14,crc,true);h.setUint32(18,bytes.length,true);h.setUint32(22,bytes.length,true);h.setUint16(26,name.length,true);head.set(name,30);
    const central=new Uint8Array(46+name.length),c=new DataView(central.buffer);c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint32(16,crc,true);c.setUint32(20,bytes.length,true);c.setUint32(24,bytes.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);central.set(name,46);
    parts.push(head,bytes);directory.push(central);offset+=head.length+bytes.length;centralSize+=central.length;
    if(offset+centralSize>0xffffffff)throw Error('Export exceeds ZIP32 size limit.');
  }
  const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
  return new Blob([...parts,...directory,end],{type:'application/zip'});
}
export function download(blob,name) {
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
export async function localProjects(userId,action,payload) {
  if(!userId)throw Error('Sign in before saving projects.');
  const database=await new Promise((resolve,reject)=>{const r=indexedDB.open('infected-voices-projects-v5:'+userId,1);r.onupgradeneeded=()=>r.result.createObjectStore('projects',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{return await new Promise((resolve,reject)=>{const tx=database.transaction('projects',['list','get'].includes(action)?'readonly':'readwrite'),store=tx.objectStore('projects');let r;
    if(action==='list')r=store.getAll();else if(action==='get')r=store.get(payload);else if(action==='delete')r=store.delete(payload);else if(action==='save')r=store.put(payload);else{tx.abort();reject(Error('Unknown local save action.'));return;}
    tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Local project save was interrupted.'));
  });}finally{database.close();}
}

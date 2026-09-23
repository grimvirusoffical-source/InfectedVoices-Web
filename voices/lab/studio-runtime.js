import {defaults,presets,pocketProfiles,masterDefaults,masterProfiles,mono,metrics,alignOnsets,estimateKey,clamp} from './dsp.js';
import {StudioAudio,processed,mix,wav,mp3,download,serialize,restore,database,sectionSettings,tick} from './engine.js';
import {api} from './mp3-codec.js';
const $=id=>document.getElementById(id);
const notes=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
const audio=new StudioAudio();
let project={title:'My infected session',bpm:150,gridOffset:0,loopStart:0,loopEnd:1.6,beat:null,beatGain:0.65,master:1,acapella:false,mastering:{...masterDefaults},pocketing:{profile:'Rap',mode:'conservative',...pocketProfiles.Rap},settings:{...defaults},sections:[],clips:[]};
let takes=[],recording=null,playing=false,position=0,busy=false,dirty=false,previewURL,alignPreview=null,masterUndo=null,custom={};
const uid=()=>crypto.randomUUID();
const say=message=>{$('status').textContent=message;};
function changed(){dirty=true;alignPreview=null;for(const c of project.clips)delete c.rendered;}
function guard(){if(recording||playing)throw new Error('Stop playback or recording before editing the project.');}
async function action(task) {
  if(busy)return;
  busy=true;document.body.classList.add('busy');
  try {await task();}catch(e){say(e?.message||String(e));}
  finally{busy=false;document.body.classList.remove('busy');}
}
const bind=(id,fn)=>$(id).addEventListener('click',()=>action(fn));
const number=(id,min,max)=>{
  const value=Number($(id).value);
  if(!Number.isFinite(value)||value<min||value>max)throw new Error(id+' must be between '+min+' and '+max+'.');
  return value;
};
function sync() {
  project.title=$('title').value.trim()||'My infected session';
  project.bpm=number('bpm',30,300);project.gridOffset=number('gridOffset',0,1200);
  project.loopStart=number('loopStart',0,1200);project.loopEnd=number('loopEnd',0.1,1200);
  project.beatGain=Number($('beatGain').value);project.acapella=$('acapella').checked;syncPocket();syncMaster();
}
function validateLoop(){sync();if(project.loopEnd<=project.loopStart+0.1)throw new Error('B must be at least 0.1 seconds after A.');}
function syncPocket(){
  const current=project.pocketing||{...pocketProfiles.Rap};
  project.pocketing={...current,profile:$('pocketProfile').value,mode:$('pocketMode').value,division:Number($('division').value),strength:Number($('strength').value),maxMove:Number($('maxMove').value),swing:Number($('pocketSwing').value),sensitivity:Number($('pocketSensitivity').value),preserve:Number($('pocketPreserve').value),minGapMs:Number($('pocketGap').value)};
}
function fillPocket(){
  const p={...pocketProfiles.Rap,...(project.pocketing||{})};
  $('pocketProfile').value=p.profile||'Rap';$('pocketMode').value=p.mode||'conservative';$('division').value=String(p.division);$('strength').value=p.strength;$('maxMove').value=p.maxMove;
  $('pocketSwing').value=p.swing;$('pocketSensitivity').value=p.sensitivity;$('pocketPreserve').value=p.preserve;$('pocketGap').value=p.minGapMs??90;
  $('strengthOut').textContent=Math.round(Number(p.strength)*100)+'%';$('pocketSwingOut').textContent=Math.round(Number(p.swing)*100)+'%';
  $('pocketSensitivityOut').textContent=Math.round(Number(p.sensitivity)*100)+'%';$('pocketPreserveOut').textContent=Math.round(Number(p.preserve)*100)+'%';$('pocketBeatSummary').textContent=project.bpm+' BPM · '+notes[project.settings.root]+' '+project.settings.scale;
}
function usePocketProfile(name){
  const profile=pocketProfiles[name];if(!profile)return;
  project.pocketing={...profile,profile:name,mode:project.pocketing?.mode||'conservative'};dirty=true;alignPreview=null;fillPocket();
  say(name+' timing profile loaded. Confirm BPM and key, then preview and audition the correction.');
}
$('pocketProfile').onchange=()=>action(()=>{guard();usePocketProfile($('pocketProfile').value);});
for(const id of ['pocketMode','division','strength','maxMove','pocketSwing','pocketSensitivity','pocketPreserve','pocketGap']){
  $(id).oninput=()=>{syncPocket();fillPocket();dirty=true;};
}
const masterFields=[['targetDb','Target RMS proxy / dB'],['ceiling','Ceiling / dB'],['compression','Glue compression'],['vocalLevel','Vocal level / dB'],['beatLevel','Beat level / dB'],['ducking','Vocal ducking'],['width','Stereo width'],['drive','Master drive'],['air','Air EQ / dB'],['lowCut','Master low-cut / Hz']];
function syncMaster(){
  const current=project.mastering||{...masterDefaults};
  project.mastering={...current,profile:$('masterProfile').value};
  for(const [id] of masterFields)project.mastering[id]=Number($('master'+id[0].toUpperCase()+id.slice(1)).value);
}
function fillMaster(){
  const p={...masterDefaults,...(project.mastering||{})};
  $('masterProfile').value=p.profile||'Rap';
  for(const [id] of masterFields){const el=$('master'+id[0].toUpperCase()+id.slice(1));el.value=p[id];$('master'+id[0].toUpperCase()+id.slice(1)+'Out').textContent=Number(p[id]).toFixed(id==='lowCut'?0:1)+(id==='lowCut'?' Hz':id==='targetDb'||id==='ceiling'||id==='vocalLevel'||id==='beatLevel'||id==='air'?' dB':'');}
}
function useMasterProfile(name){
  const profile=masterProfiles[name];if(!profile)return;
  project.mastering={...profile,profile:name};dirty=true;changed();fillMaster();
  say(name+' mastering profile loaded. Adjust the controls, preview the mix, then export.');
}
$('masterProfile').onchange=()=>action(()=>{guard();useMasterProfile($('masterProfile').value);});
for(const [id] of masterFields){
  const control=$('master'+id[0].toUpperCase()+id.slice(1));
  control.oninput=()=>{syncMaster();dirty=true;};
}
function fill() {
  for(const id of ['title','bpm','gridOffset','loopStart','loopEnd','beatGain'])$(id).value=project[id];
  $('acapella').checked=project.acapella;
  fillSound();fillPocket();fillMaster();drawClips();drawSections();drawWave();
}
$('root').innerHTML=notes.map((name,i)=>'<option value="'+i+'">'+name+'</option>').join('');
const controls=[
  ['tune','Pitch correction',0,1,0.01,'%','basicControls'],
  ['retune','Retune speed',1,250,1,'ms','basicControls'],
  ['shift','Voice depth / pitch',-12,12,0.5,'st','basicControls'],
  ['sub','Octave-down layer',0,0.7,0.01,'%','basicControls'],
  ['drive','Dark saturation',0,0.8,0.01,'%','basicControls'],
  ['echo','Echo',0,0.7,0.01,'%','basicControls'],
  ['reverb','Reverb',0,0.8,0.01,'%','basicControls'],
  ['gate','Noise gate',-70,-20,1,'dB','advancedControls'],
  ['highpass','Low-cut frequency',40,250,1,'Hz','advancedControls'],
  ['body','Voice body EQ',-9,9,0.5,'dB','advancedControls'],
  ['presence','Presence EQ',-6,6,0.5,'dB','advancedControls'],
  ['compression','Compression threshold',-40,0,1,'dB','advancedControls'],
  ['ratio','Compression ratio',1,12,0.5,':1','advancedControls'],
  ['delay','Echo delay',0.05,1,0.01,'s','advancedControls'],
  ['gain','Vocal output gain',-18,12,0.5,'dB','advancedControls'],
  ['glitch','Grim pulse',0,0.8,0.01,'%','advancedControls']
];
for(const [id,label,min,max,step,unit,parent] of controls) {
  const wrapper=document.createElement('div');wrapper.className='control';
  wrapper.innerHTML='<label for="fx-'+id+'">'+label+'<output id="out-'+id+'"></output></label><input id="fx-'+id+'" type="range" min="'+min+'" max="'+max+'" step="'+step+'">';
  $(parent).append(wrapper);
  $('fx-'+id).oninput=()=>{
    project.settings[id]=Number($('fx-'+id).value);fillOutputs();changed();
    audio.update(sectionSettings(project.settings,project.sections,currentPosition()));
    markPreset(''); 
  };
}
function fillOutputs(){
  for(const [id,label,min,max,step,unit] of controls) {
    const value=project.settings[id];
    $('out-'+id).textContent=(unit==='%'?Math.round(value*100):value)+unit;
  }
}
function fillSound(){
  for(const [id] of controls)$('fx-'+id).value=project.settings[id];
  $('root').value=project.settings.root;$('scale').value=project.settings.scale;fillOutputs();$('pocketBeatSummary').textContent=project.bpm+' BPM · '+notes[project.settings.root]+' '+project.settings.scale;
}
function markPreset(name){for(const b of $('presets').children)b.classList.toggle('selected',b.textContent===name);}
function usePreset(name,values){
  project.settings={...values,root:project.settings.root,scale:project.settings.scale};
  changed();fillSound();audio.update(sectionSettings(project.settings,project.sections,currentPosition()));markPreset(name);
  say(name+' loaded. Adjust depth and octave layer to taste.');
}
for(const [name,values] of Object.entries(presets)){
  const b=document.createElement('button');b.textContent=name;b.onclick=()=>usePreset(name,values);$('presets').append(b);
}
for(const id of ['root','scale'])$(id).onchange=()=>{
  project.settings.root=Number($('root').value);project.settings.scale=$('scale').value;
  changed();fillPocket();audio.update(sectionSettings(project.settings,project.sections,currentPosition()));
};
try{custom=JSON.parse(localStorage.getItem('iv-custom-sounds')||'{}');}catch{}
function drawCustom(){
  $('customPresets').replaceChildren();
  for(const [name,values] of Object.entries(custom)){
    const b=document.createElement('button');b.textContent=name;
    b.onclick=()=>usePreset(name,{...defaults,...values});$('customPresets').append(b);
  }
}
bind('savePreset',()=>{
  const name=$('presetName').value.trim();
  if(!name)throw new Error('Give your custom sound a name first.');
  custom[name]={...project.settings};localStorage.setItem('iv-custom-sounds',JSON.stringify(custom));
  drawCustom();say('Custom sound saved: '+name);
});
function duration(){return Math.max(project.beat?.duration||0,...project.clips.map(c=>c.start+c.audio.duration),project.loopEnd,8);}
function currentPosition(){
  if(!playing||!audio.ctx)return position;
  const elapsed=Math.max(0,audio.ctx.currentTime-audio.origin);
  return audio.position+(audio.loop?elapsed%audio.segment:elapsed);
}
function drawWave(){
  const canvas=$('wave'),w=Math.max(300,Math.round(canvas.clientWidth*devicePixelRatio)),h=160*devicePixelRatio;
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  const g=canvas.getContext('2d'),total=duration();g.clearRect(0,0,w,h);
  g.fillStyle='#231931';g.fillRect(project.loopStart/total*w,0,(project.loopEnd-project.loopStart)/total*w,h);
  const beat=60/project.bpm;
  for(let t=project.gridOffset,k=0;t<total;t+=beat,k++){
    if(total/beat>600&&k%4)continue;
    const x=t/total*w;g.strokeStyle=k%4===0?'#483158':'#292031';g.beginPath();g.moveTo(x,0);g.lineTo(x,h);g.stroke();
    if(k%4===0){g.fillStyle='#aa8dbc';g.font=10*devicePixelRatio+'px monospace';g.fillText(String(k/4+1),x+4,15*devicePixelRatio);}
  }
  const plot=(buffer,start,y,height,color)=>{
    const x=buffer.getChannelData(0),left=start/total*w,width=buffer.duration/total*w;
    g.strokeStyle=color;g.beginPath();
    const samplesPerPixel=Math.max(1,Math.floor(x.length/Math.max(1,width)));
    for(let p=0;p<width;p+=2){
      let peak=0;const a=Math.floor(p/Math.max(1,width)*x.length);
      for(let j=a;j<Math.min(a+samplesPerPixel*2,x.length);j+=Math.max(1,Math.floor(samplesPerPixel/12)))peak=Math.max(peak,Math.abs(x[j]));
      g.moveTo(left+p,y-peak*height);g.lineTo(left+p,y+peak*height);
    }g.stroke();
  };
  if(project.beat)plot(project.beat,0,h*0.38,h*0.22,'#b792db');
  for(const c of project.clips)if(!c.mute)plot(c.audio,c.start,h*0.78,h*0.17,'#97c4bd');
  const cursor=currentPosition()/total*w;
  g.strokeStyle='#f6ddff';g.beginPath();g.moveTo(cursor,0);g.lineTo(cursor,h);g.stroke();
}
$('wave').onclick=e=>{
  if(playing)return;
  position=clamp((e.clientX-$('wave').getBoundingClientRect().left)/$('wave').clientWidth*duration(),0,duration());
  $('cursor').value=position.toFixed(3);drawWave();
};
$('cursor').onchange=()=>{if(!playing){position=clamp(Number($('cursor').value)||0,0,1200);drawWave();}};
for(const id of ['title','bpm','gridOffset','loopStart','loopEnd','beatGain','acapella'])$(id).addEventListener('change',()=>action(()=>{guard();sync();changed();fillPocket();drawWave();}));
bind('setA',()=>{guard();$('loopStart').value=currentPosition().toFixed(3);sync();changed();drawWave();});
bind('setB',()=>{guard();$('loopEnd').value=currentPosition().toFixed(3);sync();changed();drawWave();});
bind('oneBar',()=>{guard();sync();$('loopStart').value=position.toFixed(3);$('loopEnd').value=(position+240/project.bpm).toFixed(3);sync();changed();drawWave();});
async function readAudio(file){
  if(file.size>120*1024*1024)throw new Error('Use an audio file under 120 MB.');
  const ctx=await audio.init();
  let result;
  try{result=await ctx.decodeAudioData(await file.arrayBuffer());}catch{throw new Error('This audio format could not be decoded. Try WAV or MP3.');}
  if(result.duration>1200)throw new Error('Use clips under 20 minutes.');
  return result;
}
$('beatFile').onchange=()=>action(async()=>{
  guard();const file=$('beatFile').files[0];if(!file)return;
  say('Opening beat…');const result=await readAudio(file);project.beat=result;changed();drawWave();say('Beat loaded: '+file.name+'. Set its BPM before recording.');$('beatFile').value='';
});
$('vocalFile').onchange=()=>action(async()=>{
  guard();
  for(const file of $('vocalFile').files){
    const result=await readAudio(file);
    project.clips.push({id:uid(),name:file.name,start:position,gain:1,mute:false,audio:result,original:result});
  }
  changed();drawClips();drawWave();say('Vocals imported at the cursor. Sound controls apply on playback and export.');$('vocalFile').value='';
});
function button(label,fn){const b=document.createElement('button');b.textContent=label;b.onclick=()=>action(fn);return b;}
function clipBuffer(x,sr){const b=audio.ctx.createBuffer(1,Math.max(1,x.length),sr);b.copyToChannel(x,0);return b;}
async function showPreview(buffer,name='Preview ready'){
  if(previewURL)URL.revokeObjectURL(previewURL);
  previewURL=URL.createObjectURL(wav(buffer,16));$('preview').src=previewURL;
  try{await $('preview').play();}catch{}
  say(name);
}
function drawTakes(){
  $('takes').classList.toggle('empty',takes.length===0);$('takes').replaceChildren();
  $('takeCount').textContent=takes.length;
  if(!takes.length)$('takes').textContent='Your recorded takes will appear here.';
  for(const take of takes){
    const row=document.createElement('div');row.className='take';
    const label=document.createElement('strong');label.textContent=take.name+' · '+take.audio.duration.toFixed(2)+'s';row.append(label);
    row.append(button('Audition',async()=>{guard();say('Rendering take…');await showPreview(await processed(take.audio,project.settings,project.sections,take.start));}));
    row.append(button('Insert',()=>{guard();project.clips.push({...take,id:uid(),gain:1,mute:false,original:take.audio});takes=takes.filter(t=>t.id!==take.id);changed();drawClips();drawTakes();drawWave();say('Take inserted at '+take.start.toFixed(2)+' seconds.');}));
    row.append(button('Dry WAV',()=>download(wav(take.audio,24),'take-dry.wav')));
    row.append(button('Discard',()=>{guard();if(confirm('Discard this uninserted take?')){takes=takes.filter(t=>t.id!==take.id);drawTakes();}}));
    $('takes').append(row);
  }
}
function drawClips(){
  const selected=$('selectedClip').value;
  $('clips').classList.toggle('empty',project.clips.length===0);$('clips').replaceChildren();$('selectedClip').replaceChildren();
  if(!project.clips.length){$('clips').textContent='Import vocals or insert a take to begin.';$('selectedClip').append(new Option('No vocals yet',''));}
  for(const c of project.clips){
    $('selectedClip').append(new Option(c.name,c.id));
    const row=document.createElement('div');row.className='clip';
    const name=document.createElement('strong');name.textContent=c.name;row.append(name);
    const label=document.createElement('label');label.textContent='Start / seconds';
    const start=document.createElement('input');start.type='number';start.min=0;start.max=1200;start.step=0.01;start.value=c.start.toFixed(3);
    start.onchange=()=>action(()=>{guard();const value=Number(start.value);if(!Number.isFinite(value)||value<0||value>1200)throw new Error('Invalid start time.');c.start=value;changed();drawWave();});label.append(start);row.append(label);
    const volume=document.createElement('label');volume.textContent='Clip volume';
    const slider=document.createElement('input');slider.type='range';slider.min=0;slider.max=2;slider.step=.01;slider.value=c.gain;
    slider.oninput=()=>{c.gain=Number(slider.value);changed();};volume.append(slider);row.append(volume);
    row.append(button(c.mute?'Unmute':'Mute',()=>{guard();c.mute=!c.mute;changed();drawClips();drawWave();}));
    row.append(button('Delete',()=>{guard();if(confirm('Remove this vocal from the project?')){project.clips=project.clips.filter(v=>v.id!==c.id);changed();drawClips();drawWave();}}));
    $('clips').append(row);
  }
  if(project.clips.some(c=>c.id===selected))$('selectedClip').value=selected;
}
function selected(){const c=project.clips.find(c=>c.id===$('selectedClip').value);if(!c)throw new Error('Import vocals or insert a take first.');return c;}
async function renderClips(){
  for(const c of project.clips)if(!c.mute&&!c.rendered){
    say('Preparing effects for '+c.name+'…');c.rendered=await processed(c.audio,project.settings,project.sections,c.start);
  }
}
bind('play',async()=>{
  if(!(await api.get('/api/access')).data.allowed)throw new Error('Your studio access has ended. Save a backup and visit your account.');
  guard();sync();if($('loop').checked)validateLoop();
  $('preview').pause();await renderClips();
  await audio.play(project,$('loop').checked?project.loopStart:position,$('loop').checked,$('metronome').checked);
  playing=true;say('Playing. Stop before editing or importing.');
});
async function mic(){
  await audio.microphone(project.settings,onBlock);
  $('mic').textContent='Disconnect mic';
  $('micInfo').textContent='Mic enabled · '+audio.ctx.sampleRate+' Hz · '+Math.round((audio.ctx.baseLatency||0)*1000)+' ms reported output latency. Input latency still needs compensation.';
}
bind('mic',async()=>{
  if(recording)throw new Error('Stop recording before disconnecting the microphone.');
  if(audio.stream){audio.disconnectMic();$('mic').textContent='Enable mic';$('meterFill').style.width='0';say('Microphone disconnected.');}
  else {await mic();say('Microphone ready.');}
});
$('monitor').onchange=()=>action(async()=>{
  if($('monitor').checked&&!audio.stream)await mic();
  audio.monitor=$('monitor').checked;audio.update(project.settings);
});
function onBlock({audio:chunk,frame,stopped}){
  if(stopped){recording?.resolveStop?.();return;}
  if(!recording||!chunk)return;
  const sr=audio.ctx.sampleRate,r=recording;
  const compensation=r.compensation*sr/1000;
  for(let i=0;i<chunk.length;i++){
    const sampleIndex=Math.round(frame+i-r.origin*sr-compensation);
    if(sampleIndex<0||frame+i>r.stopFrame)continue;
    const pass=r.loop?Math.floor(sampleIndex/r.loopSamples):0;
    if(pass>=128){if(!r.limitReached){r.limitReached=true;stop().catch(e=>say(e.message));}continue;}
    const index=r.loop?sampleIndex%r.loopSamples:sampleIndex;
    if(index>=sr*600)continue;
    if(!r.passes.has(pass))r.passes.set(pass,{chunks:new Map(),length:0});
    const take=r.passes.get(pass),block=Math.floor(index/8192),at=index%8192;
    if(!take.chunks.has(block))take.chunks.set(block,new Float32Array(8192));
    take.chunks.get(block)[at]=chunk[i];take.length=Math.max(take.length,index+1);
  }
}
bind('record',async()=>{
  if(!(await api.get('/api/access')).data.allowed)throw new Error('Your studio access has ended. Save a backup and visit your account.');
  guard();sync();const loop=$('loop').checked;if(loop)validateLoop();
  $('preview').pause();await mic();await renderClips();
  const start=loop?project.loopStart:position;
  const origin=await audio.play(project,start,loop,$('metronome').checked,undefined,true);
  recording={origin,start,loop,loopSamples:Math.round((project.loopEnd-project.loopStart)*audio.ctx.sampleRate),passes:new Map(),compensation:number('latency',-500,500),stopFrame:Infinity};
  audio.worklet.port.postMessage({record:true});
  playing=true;$('record').classList.add('active');$('record').textContent='● Recording';
  say(loop?'Recording separate loop passes. Press Stop to choose a take.':'Recording dry vocal with your chosen live effects.');
});
let stopPending=null;
function stop(){if(!stopPending)stopPending=finishStop().finally(()=>{stopPending=null;});return stopPending;}
async function finishStop(){
  const r=recording;
  let flushed;
  if(r) {
    r.stopFrame=audio.ctx.currentTime*audio.ctx.sampleRate;
    flushed=new Promise(resolve=>{r.resolveStop=resolve;setTimeout(resolve,1500);});
    audio.worklet?.port.postMessage({record:false});
  }
  position=currentPosition();playing=false;audio.stop();
  if(r){
    // Wait for the audio thread to acknowledge the final PCM block.
    await flushed;
    recording=null;
    for(const [pass,data] of [...r.passes].sort((a,b)=>a[0]-b[0])){
      if(data.length<audio.ctx.sampleRate*0.1)continue;
      const x=new Float32Array(data.length);
      for(const [block,chunk] of data.chunks)x.set(chunk.subarray(0,Math.min(8192,data.length-block*8192)),block*8192);
      takes.push({id:uid(),name:'Take '+(takes.length+1)+(r.loop?' · pass '+(pass+1):''),start:r.start,audio:clipBuffer(x,audio.ctx.sampleRate)});
    }
    drawTakes();say(r.limitReached?'128-pass limit reached. Recording stopped; audition and insert your takes.':'Recording stopped. Audition and insert a take before saving the project.');
  }else say('Stopped.');
  $('record').classList.remove('active');$('record').textContent='● Record';
  $('cursor').value=position.toFixed(3);drawWave();
}
$('stop').onclick=()=>{if(!busy)action(stop);};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&recording)stop().catch(e=>say(e.message));});
bind('detectKey',async()=>{
  guard();validateLoop();if(!project.beat)throw new Error('Import a beat first.');
  say('Estimating key in the selected section…');await tick();
  const result=estimateKey(mono(project.beat),project.beat.sampleRate,project.loopStart,Math.min(project.loopEnd,project.loopStart+20));
  project.settings.root=result.root;project.settings.scale=result.scale;changed();fillSound();
  say('Estimated '+notes[result.root]+' '+result.scale+'. Estimates can be wrong; audition before adding this section.');
});
bind('addSection',()=>{
  guard();validateLoop();
  if(project.sections.some(s=>project.loopStart<s.end&&project.loopEnd>s.start))throw new Error('This overlaps an existing key section. Remove the old section first.');
  project.sections.push({id:uid(),start:project.loopStart,end:project.loopEnd,root:project.settings.root,scale:project.settings.scale});
  project.sections.sort((a,b)=>a.start-b.start);changed();drawSections();say('Key section added.');
});
function drawSections(){
  $('sections').replaceChildren();
  for(const s of project.sections){
    const row=document.createElement('div');row.className='sectionRow';
    const text=document.createElement('span');text.textContent=s.start.toFixed(2)+'–'+s.end.toFixed(2)+'s · '+notes[s.root]+' '+s.scale;
    row.append(text,button('Remove',()=>{guard();project.sections=project.sections.filter(v=>v.id!==s.id);changed();drawSections();}));
    $('sections').append(row);
  }
}
bind('align',async()=>{
  guard();sync();const c=selected();say('Finding syllable starts…');await tick();
  syncPocket();const result=alignOnsets(mono(c.audio),c.audio.sampleRate,c.start,project.bpm,project.gridOffset,Number(project.pocketing.division),Number(project.pocketing.strength),number('maxMove',5,250)/1000,{mode:project.pocketing.mode,swing:Number(project.pocketing.swing),sensitivity:Number(project.pocketing.sensitivity),preserve:Number(project.pocketing.preserve),minGapMs:Number(project.pocketing.minGapMs)});
  alignPreview={id:c.id,audio:clipBuffer(result.audio,c.audio.sampleRate)};
  const altered={...project,clips:project.clips.map(v=>v.id===c.id?{...v,audio:alignPreview.audio}:v)};
  await showPreview(await mix(altered,audio.ctx,say),'Preview: '+result.moved+' starts moved; '+result.skipped+' collision/edge adjustments. Listen, then Keep correction or restore original timing.');
});
bind('applyAlign',()=>{guard();const c=selected();if(alignPreview?.id!==c.id)throw new Error('Preview a correction for this vocal first.');c.audio=alignPreview.audio;alignPreview=null;changed();drawWave();say('Timing correction kept. Restore original timing remains available.');});
bind('undoAlign',()=>{guard();const c=selected();c.audio=c.original;alignPreview=null;changed();drawWave();say('Original vocal timing restored.');});
for(const [id,direction] of [['earlier',-1],['later',1]])bind(id,()=>{
  guard();const c=selected();c.start=Math.max(0,c.start+direction*number('nudgeMs',1,1000)/1000);alignPreview=null;changed();drawClips();drawWave();say('Vocal starts at '+c.start.toFixed(3)+' seconds.');
});
bind('master',async()=>{
  guard();sync();syncMaster();if(!project.clips.length)throw new Error('Insert or import vocals before balancing.');
  masterUndo={settings:{...project.settings},beatGain:project.beatGain,master:project.master,mastering:{...project.mastering},gains:project.clips.map(c=>({id:c.id,gain:c.gain}))};
  if($('tuneWithMix').checked&&project.settings.tune===0)project.settings.tune=0.7;
  say('Analyzing vocal levels and applying '+project.mastering.profile+' balance…');await tick();
  for(const c of project.clips){const {rms}=metrics(mono(c.audio));c.gain=rms>0.0001?clamp(0.12/rms,0.2,2):1;}
  if(project.beat){const {rms}=metrics(mono(project.beat));project.beatGain=rms?clamp(0.09/rms,0.1,0.9):0.65;}
  project.mastering={...masterProfiles[project.mastering.profile],...project.mastering};
  project.master=0.8;changed();fill();say('Mix balance applied for '+project.mastering.profile+'. Preview the result and adjust the mastering controls before exporting.');
});
bind('undoMaster',()=>{
  guard();if(!masterUndo)throw new Error('No mix balance to undo.');
  project.settings=masterUndo.settings;project.beatGain=masterUndo.beatGain;project.master=masterUndo.master;
  project.mastering=masterUndo.mastering;
  for(const g of masterUndo.gains){const c=project.clips.find(v=>v.id===g.id);if(c)c.gain=g.gain;}
  masterUndo=null;changed();fill();say('Previous mix settings restored.');
});
bind('save',async()=>{
  guard();sync();say('Saving project on this device…');await database('put',serialize(project));dirty=false;
  say('Project saved on this device.'+(takes.length?' Uninserted takes are not included; insert or download them.':''));
});
bind('load',async()=>{
  guard();if(dirty&&!confirm('Replace current work with the saved project? Download a backup first if needed.'))return;
  const data=await database('get');if(!data)throw new Error('No project has been saved on this browser yet.');
  project=restore(data,await audio.init());dirty=false;alignPreview=null;masterUndo=null;fill();say('Saved project restored.');
});
function replacer(key,value){if(value instanceof Float32Array)return Array.from(value);return value;}
bind('backup',()=>{
  guard();sync();const data=serialize(project);
  download(new Blob([JSON.stringify(data,replacer)],{type:'application/json'}),project.title+'.ivweb');
  say('Portable browser project downloaded. Large audio projects make large backups.');
});
$('openProject').onchange=()=>action(async()=>{
  guard();const file=$('openProject').files[0];if(!file)return;
  if(file.size>250*1024*1024)throw new Error('Project backup exceeds the 250 MB browser import limit.');
  if(dirty&&!confirm('Replace current work with this project?'))return;
  const data=JSON.parse(await file.text());const restored=restore(data,await audio.init());
  project=restored;dirty=true;alignPreview=null;masterUndo=null;fill();say('Project opened. Save on device to keep it here.');$('openProject').value='';
});
bind('export',async()=>{
  if(!(await api.get('/api/access')).data.allowed)throw new Error('Your studio access has ended. Save a backup and visit your account.');
  guard();sync();if(!project.beat&&!project.clips.length)throw new Error('Add a beat or vocals before exporting.');
  $('preview').pause();const buffer=await mix(project,await audio.init(),say);
  const format=$('format').value;say('Encoding '+(format==='mp3'?'MP3':'WAV')+'…');await tick();
  const blob=format==='mp3'?await mp3(buffer,Number($('bitrate').value)):wav(buffer,format==='wav16'?16:24);
  download(blob,project.title+(format==='mp3'?'.mp3':'.wav'));say('Mix rendered and download started. Listen to the file before publishing.');
});
bind('previewMix',async()=>{
  if(!(await api.get('/api/access')).data.allowed)throw new Error('Your studio access has ended. Save a backup and visit your account.');
  guard();sync();if(!project.beat&&!project.clips.length)throw new Error('Add a beat or vocals before previewing.');
  await showPreview(await mix(project,await audio.init(),say),'Final mix preview ready.');
});
bind('demo',async()=>{
  guard();if((project.beat||project.clips.length)&&!confirm('Replace this session with a synthetic test beat and vocal tone?'))return;
  const ctx=await audio.init(),sr=ctx.sampleRate,length=Math.round(sr*6.4);
  const beat=ctx.createBuffer(1,length,sr),vocal=ctx.createBuffer(1,length,sr);
  const b=beat.getChannelData(0),v=vocal.getChannelData(0);
  for(let i=0;i<length;i++){
    const t=i/sr,phase=t%0.4;
    b[i]=Math.sin(2*Math.PI*(55*phase+70*0.035*(1-Math.exp(-phase/0.035))))*Math.exp(-phase*25)*0.5;
    const syllable=(t+0.037)%0.4;
    v[i]=Math.sin(2*Math.PI*202*t)*Math.exp(-syllable*15)*0.18;
  }
  project={...project,bpm:150,gridOffset:0,loopStart:0,loopEnd:1.6,beat,clips:[{id:uid(),name:'Synthetic vocal · timing test',start:0,gain:1,mute:false,audio:vocal,original:vocal}],sections:[],settings:{...defaults}};
  position=0;changed();fill();say('Synthetic test session loaded. These tones test controls; they are not a voice-quality demonstration.');
});
bind('helpButton',()=>{$('help').open=true;$('help').scrollIntoView({behavior:'smooth'});});
window.addEventListener('beforeunload',e=>{if(dirty||takes.length||recording){e.preventDefault();e.returnValue='';}});
let lastSection='',lastDraw=0;
function animate(time){
  if(time-lastDraw>80){
    const p=currentPosition();$('clock').textContent=Math.floor(p/60)+':'+(p%60).toFixed(2).padStart(5,'0');
    if(playing){
      drawWave();
      if(!audio.loop&&p>=audio.position+audio.segment&&!recording)stop();
      if(recording&&audio.ctx.currentTime-recording.origin>600)stop();
      const settings=sectionSettings(project.settings,project.sections,p),key=settings.root+':'+settings.scale;
      if(key!==lastSection){audio.worklet?.port.postMessage({settings});lastSection=key;}
    }
    if(audio.meter){
      const a=new Float32Array(256);audio.meter.getFloatTimeDomainData(a);
      const peak=metrics(a).peak;$('meterFill').style.width=Math.min(100,peak*100)+'%';
      $('meterFill').style.background=peak>0.9?'#ff627f':'#a7d8a1';
    }
    lastDraw=time;
  }
  requestAnimationFrame(animate);
}
fill();drawCustom();markPreset('Clean rap');requestAnimationFrame(animate);
new ResizeObserver(drawWave).observe($('wave'));
window.ivShutdown=async()=>{if(recording||playing)await stop();audio.disconnectMic();};
window.ivRecovery=()=>{sync();download(new Blob([JSON.stringify(serialize({...project,clips:[...project.clips,...takes.map(t=>({...t,gain:1,mute:false,original:t.audio}))]}),replacer)],{type:'application/json'}),project.title+'.ivweb');};


bind('exportStem',async()=>{
  if(!(await api.get('/api/access')).data.allowed)throw new Error('Studio access is required.');
  guard();sync();const clip=selected();
  const wet=$('stemKind').value==='processed';
  say('Preparing aligned vocal stem…');
  const render=wet?await processed(clip.audio,project.settings,project.sections,clip.start):clip.audio;
  const ctx=await audio.init();
  const frames=Math.ceil(clip.start*render.sampleRate)+render.length;
  if(frames>render.sampleRate*1200)throw new Error('Stem export limit is 20 minutes.');
  const out=ctx.createBuffer(render.numberOfChannels,frames,render.sampleRate);
  const offset=Math.round(clip.start*render.sampleRate);
  for(let ch=0;ch<render.numberOfChannels;ch++)out.copyToChannel(render.getChannelData(ch),ch,offset);
  download(wav(out,24),'Infected-Voices-'+(wet?'processed':'dry')+'-aligned-stem.wav');
  say('Vocal stem exported with leading silence to preserve its song position. Import it at time zero in your other project at '+project.bpm+' BPM. It excludes beat and master-bus processing.');
});
window.ivPrepareAI = async ({tune, detailed}) => {
  if (!(await api.get('/api/access')).data.allowed) throw new Error('Studio access is required.');
  guard();
  if (busy) throw new Error('Wait for the current studio operation to finish.');
  sync();
  const clips = project.clips.filter(clip => !clip.mute).map(clip => ({...clip}));
  if (!project.beat || !clips.length) throw new Error('Import a beat and at least one unmuted vocal first.');
  const beat = project.beat;
  const duration = Math.max(beat.duration, ...clips.map(clip => clip.start + clip.audio.duration));
  if (duration > 480) throw new Error('AI mixes are limited to eight minutes. Shorten the project first.');
  const settings = {...defaults, root:project.settings.root, scale:project.settings.scale, tune:project.settings.tune||0.7, retune:project.settings.retune, shift:0, sub:0, drive:0, glitch:0, echo:0, reverb:0, body:0, presence:0, gain:0};
  const sections = project.sections.map(section => ({...section}));
  const measurements = clips.map(clip => ({name:clip.name, ...metrics(mono(clip.audio))}));
  if (measurements.every(item => item.peak < 0.001) || metrics(mono(beat)).peak < 0.001) throw new Error('The beat or vocals are silent. Check the audio before uploading.');
  if (detailed && measurements.some(item => item.peak >= 0.999)) throw new Error('Grim Beats found clipping in a vocal. Use a clean original take, or choose Infected Mixer after listening to the clipped track.');
  const frameCount = Math.ceil((duration + 1.5) * 44100);
  const vocalsContext = new OfflineAudioContext(2, frameCount, 44100);
  for (const clip of clips) {
    const buffer = tune ? await processed(clip.audio, settings, sections, clip.start) : clip.audio;
    const source = vocalsContext.createBufferSource();
    source.buffer = buffer;
    const gain = vocalsContext.createGain();
    gain.gain.value = clip.gain;
    source.connect(gain).connect(vocalsContext.destination);
    source.start(clip.start);
  }
  const vocalBuffer = await vocalsContext.startRendering();
  let peak = 0;
  for (let channel = 0; channel < vocalBuffer.numberOfChannels; channel++) peak = Math.max(peak, metrics(vocalBuffer.getChannelData(channel)).peak);
  if (peak > 0.95) for (let channel = 0; channel < vocalBuffer.numberOfChannels; channel++) {
    const samples = vocalBuffer.getChannelData(channel);
    for (let i = 0; i < samples.length; i++) samples[i] *= 0.95 / peak;
  }
  const beatContext = new OfflineAudioContext(2, frameCount, 44100);
  const beatSource = beatContext.createBufferSource();
  beatSource.buffer = beat;
  beatSource.connect(beatContext.destination);
  beatSource.start();
  const beatBuffer = await beatContext.startRendering();
  return {vocals:wav(vocalBuffer,24),beat:wav(beatBuffer,24),summary:measurements.length+' vocal tracks prepared'+(tune?' with local pitch correction.':'.')};
};

// Native lifecycle integration: the original Classic DSP and projects remain unchanged.
window.ivGetSessionState=()=>({recording:!!recording,playing:!!playing,busy:!!busy,dirty:!!dirty||takes.length>0,starting:false,finalizing:false,pendingWrites:false});
setInterval(()=>window.ivDesktop?.setSessionState?.(window.ivGetSessionState()),1000);
window.ivPrepareNativeUpdate=async()=>{
 guard();if(busy)throw Error('Finish Classic Studio processing first.');
 if(takes.length)throw Error('Insert or download uninserted Classic takes, then save before updating.');
 sync();await database('put',serialize(project));dirty=false;
 window.ivDesktop?.setSessionState?.(window.ivGetSessionState());return {saved:true};
};

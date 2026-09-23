import {newProject,newTrack,newClip,uid,copy,History,ROOTS,PRESETS,TIMING_PRESETS,MASTER_PRESETS,SOUND_RANGES,SOUND_DEFAULTS,endTime,snapTime,splitClip,trimClip,duplicateClip,validateProject,barBeat,clamp} from './model.js';
import {MixerStudio as Studio, isMixerOnlyChange} from './mixer-studio.js';
import {installMixerUI} from './mixer-ui.js';
import {installReliabilityUI} from './reliability-ui.js';
import {asset,encodeProject,decodeProject,importClassic,wav,download,localProjects,memoryLimit} from './files.js';
import {GUIDES,GUIDE_VERSION,describe,PRESET_HELP} from './help.js';
import {CATALOG,validatePlugin,readPlugin,SDK_GUIDE} from './plugins.js';
import {measure,dbGain} from './core.js';
import {installCore2UI} from './core2-ui.js';
import {insertPunchTake} from './take-editing.js';
import {installPrecisionUI} from './precision-ui.js';
import {installProducerUI} from './producer-ui.js';

const $=id=>document.getElementById(id);
const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
const STAGES=[
  ['Prepare','Import a beat, confirm tempo/key, and set up a vocal track with headphones.'],
  ['Record','Select a vocal track, set the count-in and record a short test before your full take.'],
  ['Arrange','Choose your best takes. Move, trim, split and fade clips without changing the source recording.'],
  ['Timing','Confirm the grid. Preview the selected vocal’s alignment, listen, and then keep it.'],
  ['Tuning','Choose a preset and song key. Compare pitch and character without losing the dry original.'],
  ['Mix','Balance beat, lead, doubles and effects before reaching for a louder master.'],
  ['Master','Choose a conservative starting point, preview the combined mix, and listen at a comparable volume.'],
  ['Export','Save the project, export your master or aligned stems, then prepare release metadata.']
];
export async function mount({api,auth,openExternal,isDesktop}) {
  let collaboration=null;
  const changed=()=>collaboration?.changed?.();
  let p=newProject(),user=null,access=null,capabilities=null,selectedTrack='',selectedClip='',stage=0,busy=false,dirty=false,revision=0,alignment=null,previewURL='',importKind='beat',importSeparate=true;
  let pendingPage=location.hash.slice(1);
  let refreshing=false,initialized=false,tutorialComplete=false,guideRequired=false,guideIndex=0,guideList=GUIDES,guideHighest=0,guideBusy=false,installed=[],autosaving=false,stopPending=null;
  const history=new History(),studio=new Studio(text=>status(text));
  let reliabilityUI = null;
  let core2UI = null;
  let core3UI = null;
  let core4UI = null;
  let core5UI = null;
  const native=!!window.ivDesktop||isDesktop;
  const portalURL=path=>new URL(path,window.ivNative?.serverOrigin||'https://infectedvoices.space/').href;
  if(native)document.body.classList.add('native');
  const desktopMixer=el('section',undefined,'desktop-mixer');
  desktopMixer.setAttribute('aria-label','Desktop mixer rack');
  if(native)$('appShell').append(desktopMixer);
  function drawDesktopMixer(){
    if(!native)return;
    desktopMixer.replaceChildren();
    for(const t of p.tracks){
      const channel=el('article',undefined,'desktop-channel');
      channel.append(el('strong',t.name),field('gainDb','Level / dB',t.gainDb,value=>edit(next=>{next.tracks.find(x=>x.id===t.id).gainDb=value;}),{type:'range',min:-60,max:12,step:.5}),field('pan','Pan',t.pan,value=>edit(next=>{next.tracks.find(x=>x.id===t.id).pan=value;}),{type:'range',min:-1,max:1,step:.01}),button(t.mute?'Unmute':'Mute',()=>edit(next=>{const target=next.tracks.find(x=>x.id===t.id);target.mute=!target.mute;})),button(t.solo?'Unsolo':'Solo',()=>edit(next=>{const target=next.tracks.find(x=>x.id===t.id);target.solo=!target.solo;})));
      desktopMixer.append(channel);
    }
  }
  function status(text){$('status').textContent=text;$('loginStatus').textContent=text;}
  function failure(error){return error?.response?.data?.error||error?.message||'This action could not finish. Your project is unchanged.';}
  function requireAccess(){if(!access?.allowed||!tutorialComplete)throw Error('Complete sign-in, access and the studio walkthrough first.');}
  function requireStopped() {
    requireAccess();
    if (studio.recording || studio.protectedStart || studio.finalizingRecording || stopPending) {
      throw Error('Finish recording before editing, changing engines or opening another project.');
    }
  }
  function edit(fn) {
    requireAccess();
    if (studio.protectedStart || studio.finalizingRecording || stopPending) {
      throw Error('Wait for recording to start or finish before editing.');
    }
    const next = copy(p);
    fn(next);
    if(collaboration && (next.mixer||next.version>=2) && collaboration.protocol!=='collab-v2')throw Error("This project requires the Core 6 collaboration protocol.");
    collaboration?.beforeEdit?.(p,next,selectedTrack);
    next.modified = Date.now();
    validateProject(next, studio.assets);
    const mixerOnly = isMixerOnlyChange(p, next);
    if (studio.recording && !mixerOnly) {
      throw Error('Stop recording before changing the arrangement or processing. Track gain, pan, mute and solo stay available.');
    }
    if (mixerOnly) studio.updateMixer(next);
    else { studio.stopPlayback(); studio.clearCache(); }
    history.push(p);
    p = next;
    dirty = true;
    revision++;
    alignment = null;
    draw();changed();
  }
  async function run(fn){if(busy){status('Finish the current operation first. Stop remains available.');return;}busy=true;document.body.classList.add('busy');try{await fn();}catch(error){const text=failure(error);status(text);if($('detailDialog').open){let notice=$('dialogError');if(!notice){notice=el('p',undefined,'dialog-note');notice.id='dialogError';notice.setAttribute('role','alert');$('dialogContent').prepend(notice);}notice.textContent=text;}}finally{busy=false;document.body.classList.remove('busy');updateTransport();}}
  function track(){return p.tracks.find(t=>t.id===selectedTrack);}
  function clip(){return p.clips.find(c=>c.id===selectedClip);}
  function button(text,fn,className=''){const b=el('button',text,className);b.onclick=()=>run(fn);return b;}
  function help(key,label){const [title,text]=describe(key,label);$('helpTitle').textContent=title;$('helpContent').replaceChildren(el('p',text));$('helpDialog').showModal();}
  function info(key,label){const b=el('button','i','info');b.type='button';b.setAttribute('aria-label','About '+(label||key));b.onclick=e=>{e.preventDefault();e.stopPropagation();help(key,label);};return b;}
  function field(key,label,value,onChange,options={}) {
    const wrapper=el('label',undefined,'field'),row=el('span',label),out=el('output',typeof value==='number'?String(Math.round(value*1000)/1000):'');
    let input;
    if(options.choices){input=el('select');for(const [v,text] of options.choices.map(x=>Array.isArray(x)?x:[x,x])){const option=el('option',text);option.value=v;input.append(option);}input.value=String(value);}
    else{input=el('input');input.type=options.type||'number';if(input.type==='checkbox')input.checked=!!value;else input.value=value;if(options.min!==undefined)input.min=options.min;if(options.max!==undefined)input.max=options.max;if(options.step!==undefined)input.step=options.step;}
    input.setAttribute('aria-label',label);row.append(out,info(options.helpKey||key,label));wrapper.append(row,input);
    input.oninput=()=>{if(input.type==='range')out.value=String(Math.round(Number(input.value)*1000)/1000);};
    input.onchange=()=>run(()=>onChange(input.type==='checkbox'?input.checked:options.choices?(options.numeric?Number(input.value):input.value):input.type==='text'?input.value:Number(input.value)));
    return wrapper;
  }
  function dialog(title,content){$('dialogTitle').textContent=title;$('dialogContent').replaceChildren(...(Array.isArray(content)?content:[content]));if(!$('detailDialog').open)$('detailDialog').showModal();}
  function closeDialog(){if($('detailDialog').open)$('detailDialog').close();}
  $('detailDialog').addEventListener('close',()=>{$('dialogContent').querySelectorAll('audio').forEach(audio=>audio.pause());$('dialogContent').querySelectorAll('input[type=password]').forEach(input=>{input.value='';});});
  $('closeDialog').onclick=()=>{if(busy){status('Finish or cancel the current operation before closing this panel.');return;}closeDialog();};$('closeHelp').onclick=()=>$('helpDialog').close();
  function releasePreview(){if(previewURL)URL.revokeObjectURL(previewURL);previewURL='';}
  function audioPreview(blob,text='Listen before applying') {
    releasePreview();previewURL=URL.createObjectURL(blob);const audio=el('audio');audio.controls=true;audio.src=previewURL;dialog(text,[audio,el('p','Preview does not overwrite your recording. Use headphones and compare at a comfortable volume.','fine')]);
  }
  function setStage(index){stage=clamp(index,0,STAGES.length-1);drawInspector();document.querySelectorAll('#steps button').forEach((b,i)=>b.classList.toggle('selected',i===stage));$('stepNumber').textContent=String(stage+1).padStart(2,'0');$('stepTitle').textContent=STAGES[stage][0]+' your session';$('stepTip').textContent=STAGES[stage][1];$('nextStage').textContent=stage===7?'Back to prepare':'Next step →';}
  STAGES.forEach(([name],index)=>{const b=el('button');b.append(el('b',String(index+1).padStart(2,'0')),document.createTextNode(name));b.onclick=()=>setStage(index);$('steps').append(b);});
  $('nextStage').onclick=()=>setStage((stage+1)%STAGES.length);
  for(const [index,name] of ROOTS.entries()){const option=el('option',name);option.value=index;$('root').append(option);}
  for(const [id,key] of [['bpm','bpm'],['root','root'],['scale','scale'],['snap','snap'],['loop','loop'],['metronome','metronome'],['zoom','zoom']]){
    const input=$(id);input.parentElement.append(info(key));input.onchange=()=>run(()=>edit(next=>{const value=input.type==='checkbox'?input.checked:key==='scale'?input.value:Number(input.value);if(collaboration&&['root','scale'].includes(key)){const t=next.tracks.find(t=>t.id===selectedTrack);if(!collaboration.canEdit(t))throw Error('Select your own track first.');t.songKey={...(t.songKey||{root:p.root,scale:p.scale}),[key]:value};}else next[key]=value;}));
  }
  for(const [id,key,description] of [['soundEngine','sound','sound'],['tuneEngine','tune','tuneEngine'],['timingEngine','timing','timingEngine'],['masterEngine','master','masterEngine']]){
    $(id).parentElement.append(info(description));$(id).onchange=()=>run(()=>edit(next=>{if(collaboration&&['sound','tune'].includes(key)){const t=next.tracks.find(t=>t.id===selectedTrack);if(!collaboration.canEdit(t))throw Error('Select your own track first.');t.engines={sound:p.engines.sound,tune:p.engines.tune,...t.engines,[key]:$(id).value};}else next.engines[key]=$(id).value;}));
  }
  $('title').parentElement.append(info('title'));
  $('title').onchange=()=>run(()=>edit(next=>{next.title=$('title').value.slice(0,120)||'Untitled session';}));
  function updateTransport(){
    window.ivDesktop?.setSessionState?.({recording:!!studio.recording,starting:!!studio.protectedStart,finalizing:!!studio.finalizingRecording||!!stopPending,playing:!!studio.playing,dirty,busy,pendingWrites:!!studio.writer?.pendingBytes});
    $('record').classList.toggle('active',!!studio.recording);$('record').textContent=studio.recording?'● Recording':'● Record';
    $('memory').textContent=Math.round(studio.bytes()/1024/1024)+' MB source audio';$('accessBadge').textContent=access?.kind||'';
    reliabilityUI?.refresh();
    core2UI?.refresh();
    core3UI?.refresh();
    core5UI?.refresh();
    collaboration?.transport?.({recording:!!studio.recording,playing:!!studio.playing,selectedTrack});
    if(studio.recording)$('status').textContent='Recording dry audio onto '+(p.tracks.find(t=>t.id===studio.recordTrack)?.name||'vocal track')+' — Stop keeps your take.';
  }
  function draw(){
    drawDesktopMixer();
    const selected=p.tracks.find(t=>t.id===selectedTrack);
    for(const key of ['title','bpm','root','scale','snap','zoom'])$(key).value=collaboration&&['root','scale'].includes(key)?(selected?.songKey?.[key]??p[key]):p[key];for(const key of ['loop','metronome'])$(key).checked=p[key];
    for(const [id,key] of [['soundEngine','sound'],['tuneEngine','tune'],['timingEngine','timing'],['masterEngine','master']])$(id).value=collaboration&&['sound','tune'].includes(key)?(selected?.engines?.[key]??p.engines[key]):p.engines[key];
    if(!p.tracks.some(t=>t.id===selectedTrack))selectedTrack=p.tracks[0]?.id||'';
    if(!p.clips.some(c=>c.id===selectedClip))selectedClip='';
    $('arrangementTitle').textContent=p.title;$('clipCount').textContent=p.clips.length+' clips';$('emptyTimeline').hidden=p.clips.length>0;
    drawTracks();drawTimeline();drawInspector();updateTransport();collaboration?.decorate?.();$('undo').disabled=!history.past.length;$('redo').disabled=!history.future.length;
  }
  function drawTracks(){
    $('trackList').replaceChildren();
    for(const t of p.tracks){const row=el('div',undefined,'track-card'+(t.id===selectedTrack?' selected':''));row.dataset.trackId=t.id;row.dataset.kind=t.kind;row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-label','Select track '+t.name);row.append(el('strong',t.name),el('small',t.kind+(t.ownerId?' · '+(t.ownerId===collaboration?.userId?'YOURS':'PARTNER · READ ONLY'):'')));
      const controls=el('div',undefined,'track-controls');for(const [key,label] of [['mute','M'],['solo','S']]){const b=el('button',label,t[key]?'on':'');b.setAttribute('aria-label',(key==='mute'?'Mute ':'Solo ')+t.name);b.onclick=e=>{e.stopPropagation();run(()=>edit(next=>{next.tracks.find(v=>v.id===t.id)[key]=!t[key];}));};controls.append(b);}
      row.append(controls);const choose=()=>{selectedTrack=t.id;selectedClip='';draw();collaboration?.selection?.();};row.onclick=choose;row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}};$('trackList').append(row);
    }
  }
  function drawWave(canvas,c,width,t){
    const a=studio.assets.get(c.assetId);if(!a)return;const pixels=Math.min(1600,Math.max(10,Math.round(width)));canvas.width=pixels;canvas.height=36;const ctx=canvas.getContext('2d'),x=a.channels[0],begin=Math.floor(c.offset*a.rate),length=Math.round(c.duration*a.rate);
    ctx.strokeStyle=t.kind==='beat'?'#e6f6cb':t.kind==='effect'?'#ffe1c6':'#e6d4ff';ctx.lineWidth=1;ctx.beginPath();
    for(let i=0;i<pixels;i++){let max=0;const start=begin+Math.floor(i*length/pixels),end=Math.min(a.length,begin+Math.floor((i+1)*length/pixels));for(let j=start;j<end;j+=Math.max(1,Math.floor((end-start)/60)))max=Math.max(max,Math.abs(x[j]));const h=Math.min(16,max*38);ctx.moveTo(i,18-h);ctx.lineTo(i,18+h);}ctx.stroke();
  }
  function drawTimeline(){
    const width=Math.min(250000,Math.max(650,(endTime(p)+4)*p.zoom)),bar=240/p.bpm*p.zoom;
    $('timeline').style.width=width+'px';$('timeline').style.setProperty('--grid',bar+'px');$('ruler').replaceChildren();
    const labelEvery=Math.max(1,Math.ceil(40/bar));for(let index=0;index*bar<width;index+=labelEvery){const mark=el('span',String(index+1));mark.style.left=(p.gridOffset*p.zoom+index*bar+5)+'px';$('ruler').append(mark);}
    $('lanes').replaceChildren();
    p.tracks.forEach((t,rowIndex)=>{const lane=el('div',undefined,'lane'+(t.id===selectedTrack?' selected':''));lane.dataset.track=t.id;lane.append(el('span',t.name,'lane-name'));
      lane.ondblclick=e=>{if(e.target===lane){selectedTrack=t.id;importKind=t.kind;importSeparate=false;chooseAudio();}};
      for(const c of p.clips.filter(c=>c.trackId===t.id)){
        const block=el('div',undefined,'audio-clip'+(c.id===selectedClip?' selected':'')+(c.muted?' muted':''));block.dataset.kind=t.kind;block.style.left=c.start*p.zoom+'px';block.style.width=Math.max(5,c.duration*p.zoom)+'px';block.tabIndex=0;block.setAttribute('aria-label',c.name+' at '+c.start.toFixed(2)+' seconds');
        block.append(el('strong',c.name));const canvas=el('canvas');block.append(canvas);drawWave(canvas,c,c.duration*p.zoom,t);
        for(const edge of ['left','right']){const handle=el('span',undefined,'trim-handle '+edge);handle.dataset.edge=edge;block.append(handle);}
        block.onpointerdown=e=>{
          if(e.button!==0||studio.recording||busy)return;
          if(collaboration&&!collaboration.canEdit(t)){selectedTrack=t.id;selectedClip=c.id;draw();status('Your collaborator owns this clip. You can audition it, but not change it.');return;}e.preventDefault();e.stopPropagation();selectedClip=c.id;selectedTrack=t.id;drawTracks();drawInspector();document.querySelectorAll('.audio-clip').forEach(b=>b.classList.toggle('selected',b===block));
          const original=copy(c),startX=e.clientX,startY=e.clientY,edge=e.target.dataset.edge;let moved=false,targetRow=rowIndex,candidate=copy(c);block.setPointerCapture(e.pointerId);
          block.onpointermove=event=>{const delta=(event.clientX-startX)/p.zoom;if(Math.abs(event.clientX-startX)>2||Math.abs(event.clientY-startY)>10)moved=true;candidate=copy(original);
            if(edge)trimClip(candidate,edge,delta,studio.assets.get(c.assetId).duration);else{candidate.start=snapTime(original.start+delta,p,event.shiftKey);targetRow=clamp(rowIndex+Math.round((event.clientY-startY)/83),0,p.tracks.length-1);candidate.trackId=p.tracks[targetRow].id;}
            block.style.left=candidate.start*p.zoom+'px';block.style.width=Math.max(5,candidate.duration*p.zoom)+'px';block.style.transform=edge?'':`translateY(${(targetRow-rowIndex)*83}px)`;};
          block.onpointerup=()=>{block.onpointermove=null;block.onpointerup=null;if(moved)run(()=>edit(next=>{Object.assign(next.clips.find(v=>v.id===c.id),candidate);}));};
          block.onpointercancel=()=>{block.onpointermove=null;drawTimeline();};
        };
        block.onkeydown=e=>{if(e.key==='Enter'){selectedTrack=t.id;selectedClip=c.id;draw();}};lane.append(block);
      }$('lanes').append(lane);
    });
    $('playhead').style.left=p.cursor*p.zoom+'px';
  }
  $('ruler').onpointerdown=e=>{if(studio.recording)return;const rect=$('ruler').getBoundingClientRect();p.cursor=snapTime((e.clientX-rect.left)/p.zoom,p,e.shiftKey);studio.stopPlayback();$('playhead').style.left=p.cursor*p.zoom+'px';drawInspector();};
  function soundPresets(container,t){
    const group=el('div',undefined,'preset-grid');for(const [name,settings] of Object.entries(PRESETS)){const item=el('div',undefined,'preset-item');item.append(button(name,()=>edit(next=>{next.tracks.find(v=>v.id===t.id).settings={...settings};})),presetInfo(name));group.append(item);}container.append(group);
  }
  function presetInfo(name){const b=el('button','i','info');b.setAttribute('aria-label','About preset '+name);b.onclick=e=>{e.preventDefault();e.stopPropagation();$('helpTitle').textContent=name;$('helpContent').replaceChildren(el('p',PRESET_HELP[name]||'This preset supplies a starting set of parameters. It changes real processing controls, not the source audio. Audition and fine-tune it for your own track.'));$('helpDialog').showModal();};return b;}
  function selectedSoundField(container,t,key,label){const [min,max]=SOUND_RANGES[key];container.append(field(key,label,t.settings[key],value=>edit(next=>{next.tracks.find(v=>v.id===t.id).settings[key]=value;}),{type:'range',min,max,step:max<=1?.01:key==='retune'||key==='highpass'?1:.1}));}
  function drawInspector(){
    const box=$('inspectorBody');box.replaceChildren();$('inspectorTitle').textContent=STAGES[stage][0].toUpperCase();const t=track(),c=clip();
    box.append(el('h3',c?c.name:t?t.name:'Session settings'),el('p',c?'Selected timeline clip':t?t.kind.toUpperCase()+' TRACK':'Create or import a track to begin.','subhead'));
    if(stage===0||stage===1){
      for(const [key,label,min,max,step] of [['gridOffset','Grid start / s',0,21600,.01],['cursor','Playhead / s',0,21600,.01],['loopStart','Loop A / s',0,21600,.01],['loopEnd','Loop B / s',.01,21600,.01],['countIn','Count-in / bars',0,4,1],['compensationMs','Recording compensation / ms',-1000,1000,1]])box.append(field(key,label,p[key],v=>edit(next=>{next[key]=v;}),{min,max,step}));
      box.append(field('punch','Punch record A-B',!!p.punch,value=>edit(next=>{next.punch=value;if(value)next.loop=false;}),{type:'checkbox'}));
      box.append(el('p','Punch captures a new take only inside A-B after the count-in. Existing audio is retained and muted only over the captured region. Undo restores the old arrangement. The recording journal and a backing-session snapshot are kept.','mini-note'));
      box.append(field('monitor','Hear dry microphone',!!studio.monitor,v=>{requireAccess();studio.setMonitor(v);},{type:'checkbox'}));
      box.append(button('Choose microphone',async()=>{requireStopped();await studio.mic(studio.onLevel);const devices=await navigator.mediaDevices.enumerateDevices();const choices=devices.filter(d=>d.kind==='audioinput').map(d=>[d.deviceId,d.label||'Microphone']);dialog('Microphone input',field('inputDevice','Microphone',studio.inputId||'default',v=>{studio.releaseMic();studio.inputId=v;closeDialog();status('Input selected. Enable mic to test it.');},{choices}));},'wide'));
      box.append(el('p','Microphone audio is captured dry. The classic studio remains available for live processed monitoring. Use headphones and make a short latency test.','mini-note'));
    }
    if(stage===2){
      if(t){box.append(field('trackName','Track name',t.name,v=>edit(next=>{next.tracks.find(x=>x.id===t.id).name=v.slice(0,120);}),{type:'text'}));box.append(field('kind','Track type',t.kind,v=>edit(next=>{next.tracks.find(x=>x.id===t.id).kind=v;}),{choices:['beat','vocal','effect']}));}
      if(c){
        box.append(field('clipName','Clip name',c.name,v=>edit(next=>{next.clips.find(x=>x.id===c.id).name=v.slice(0,160);}),{type:'text'}));
        for(const [key,label,min,max,step] of [['start','Song start / s',0,21600,.01],['offset','Source offset / s',0,studio.assets.get(c.assetId).duration,.01],['duration','Clip length / s',.001,studio.assets.get(c.assetId).duration,.01],['fadeIn','Fade-in / s',0,c.duration,.005],['fadeOut','Fade-out / s',0,c.duration,.005],['gainDb','Clip gain / dB',-60,12,.5]])box.append(field(key,label,c[key],v=>edit(next=>{const target=next.clips.find(x=>x.id===c.id);target[key]=v;if(key==='duration'){target.fadeIn=Math.min(target.fadeIn,v);target.fadeOut=Math.min(target.fadeOut,v);}}),{min,max,step}));
        box.append(button(c.muted?'Unmute selected clip':'Mute selected clip',()=>edit(next=>{next.clips.find(x=>x.id===c.id).muted=!c.muted;}),'wide'));
      }else box.append(el('p','Select a clip to edit its position, length, gain and fades. Drag clips between tracks. Hold Shift to move without snap.','mini-note'));
      if(t)box.append(button('Delete track…',()=>{if(confirm('Delete '+t.name+' and its timeline clips? Undo can restore them during this session.'))edit(next=>{next.tracks=next.tracks.filter(x=>x.id!==t.id);next.clips=next.clips.filter(x=>x.trackId!==t.id);});},'quiet wide'));
    }
    if(stage===3){
      box.append(button('Open Precision Pocket editor',()=>core4UI.openWarp(),'primary wide'));
      box.append(field('timingPreset','Timing preset','Natural rap',name=>edit(next=>{next.timing={...TIMING_PRESETS[name]};}),{choices:Object.keys(TIMING_PRESETS)}));
      box.append(field('division','Timing division',p.timing.division,v=>edit(next=>{next.timing.division=v;}),{choices:[[4,'Quarter'],[8,'Eighth'],[12,'Eighth triplet'],[16,'Sixteenth'],[32,'Thirty-second']],numeric:true}));
      box.append(field('strength','Correction strength',p.timing.strength,v=>edit(next=>{next.timing.strength=v;}),{type:'range',min:0,max:1,step:.01}));
      box.append(field('maxMove','Maximum move / ms',p.timing.maxMove,v=>edit(next=>{next.timing.maxMove=v;}),{min:0,max:250,step:1}));
      const advanced=el('details');advanced.append(el('summary','Advanced timing'));for(const [key,label,min,max,step] of [['swing','Swing',-.35,.35,.01],['sensitivity','Sensitivity',.03,.8,.01],['preserve','Transient preservation',0,1,.01],['minGapMs','Minimum region gap / ms',25,250,1]])advanced.append(field(key,label,p.timing[key],v=>edit(next=>{next.timing[key]=v;}),{min,max,step}));box.append(advanced);
      box.append(button('Preview alignment',previewAlignment,'primary wide'),button('Keep alignment',keepAlignment,'wide'),el('p','Preview and listen first. Edit changes invalidate a preview. Zero strength preserves every sample. Undo restores the previous clip.','mini-note'));
    }
    if(stage===4||stage===5){
      if(t&&t.kind==='vocal'){
        box.append(field('channelMode','Vocal source channels',t.channelMode||'mono',value=>edit(next=>{next.tracks.find(item=>item.id===t.id).channelMode=value;}),{choices:[['mono','Mono sum · current behavior'],['left','Left input only'],['right','Right input only'],['stereo-dry','Preserve stereo · bypass vocal DSP']]}));
        box.append(el('p','Stereo passthrough retains imported channels without pitch/character processing; track gain and pan still apply. Choose a mono channel for vocal correction. Original audio is never changed.','mini-note'));
        if(stage===4)box.append(button('Open Precision Tune editor',()=>core4UI.openPitch(),'primary wide'));
        soundPresets(box,t);for(const [key,label] of (stage===4?[['tune','Pitch correction'],['retune','Retune / ms'],['shift','Transpose / semitones'],['sub','Lower octave']]:[['highpass','High-pass / Hz'],['body','Body / dB'],['presence','Presence / dB'],['compression','Threshold / dB'],['ratio','Ratio']]))selectedSoundField(box,t,key,label);
        const advanced=el('details');advanced.append(el('summary','Advanced vocal controls'));for(const [key,label] of [['drive','Drive'],['gate','Gate / dB'],['echo','Echo blend'],['delay','Delay / s'],['reverb','Reverb'],['gain','Vocal output / dB'],['glitch','Glitch'],['deess','Infected de-essing']])selectedSoundField(advanced,t,key,label);box.append(advanced);
        box.append(button('Save custom preset',()=>{const name=prompt('Name this preset');if(!name)return;const pack=validatePlugin({apiVersion:1,id:'user.'+uid(),name:name.slice(0,100),author:'Local artist',version:'1.0.0',kind:'preset',description:'Custom studio preset saved from the selected track.',settings:{...t.settings}});installed.push(pack);savePlugins();status('Preset installed in your plugin library.');},'wide'));
      }else box.append(el('p','Select a Vocal track to change voice processing. Beat and Effect tracks retain their imported pitch and sound.','mini-note'));
      if(t){box.append(field('gainDb','Track gain / dB',t.gainDb,v=>edit(next=>{next.tracks.find(x=>x.id===t.id).gainDb=v;}),{type:'range',min:-60,max:12,step:.5}));box.append(field('pan','Track pan',t.pan,v=>edit(next=>{next.tracks.find(x=>x.id===t.id).pan=v;}),{type:'range',min:-1,max:1,step:.01}));}
      if(stage===5)box.append(button('Open Producer tools · automation / GRIM / sidechain',()=>core5UI.open(),'primary wide'),button('Analyze starting balance',balance,'wide'));
      if(stage===4){
        const sections=el('details'),entries=collaboration?(t?.keySections||[]):p.sections;
        const changeSections=fn=>edit(next=>{if(collaboration){const target=next.tracks.find(v=>v.id===selectedTrack);if(!collaboration.canEdit(target))throw Error('Select your own track first.');target.keySections||=[];fn(target.keySections,target.songKey||{root:p.root,scale:p.scale});}else fn(next.sections,{root:p.root,scale:p.scale});});
        sections.append(el('summary',collaboration?'Selected track key sections':'Song key sections'));
        sections.append(button('Use current key for A–B',()=>changeSections((list,key)=>list.push({start:p.loopStart,end:p.loopEnd,...key})),'wide'));
        entries.forEach((s,i)=>sections.append(button(`${s.start.toFixed(2)}–${s.end.toFixed(2)} · ${ROOTS[s.root]} ${s.scale} · remove`,()=>changeSections(list=>list.splice(i,1)),'quiet wide')));box.append(sections);
      }
    }
    if(stage===6||stage===7){
      if(stage===6){box.append(button('Open Producer tools · mastering',()=>core5UI.open(),'primary wide'));if(p.producer?.mastering?.enabled)box.append(el('p','Core 5 mastering is active. The older master controls below stay saved for compatibility, but mastered preview/export uses the Core 5 LUFS / true-peak path.','mini-note'));const grid=el('div',undefined,'preset-grid');for(const [name,settings] of Object.entries(MASTER_PRESETS)){const item=el('div',undefined,'preset-item');item.append(button(name,()=>edit(next=>{next.mastering={...settings};})),presetInfo(name));grid.append(item);}box.append(grid);
        for(const [key,label,min,max,step,helpKey] of [['targetDb','Target RMS proxy / dB',-24,-8,.5,'targetDb'],['ceiling','Sample ceiling / dBFS',-6,-.1,.1,'ceiling'],['compression','Glue compression',0,1,.01,'masterCompression'],['width','Stereo width',0,1.5,.01,'width'],['drive','Master drive',0,.35,.01,'masterDrive']])box.append(field(key,label,p.mastering[key],v=>edit(next=>{next.mastering[key]=v;}),{type:'range',min,max,step,helpKey}));
      }
      box.append(button('Preview mastered mix',()=>previewMix(true),'primary wide'),button('Preview unmastered mix',()=>previewMix(false),'wide'));
      if(stage===7)box.append(button('Export master · 24-bit WAV',()=>exportMix(24,true),'primary wide'),button('Export master · 16-bit WAV',()=>exportMix(16,true),'wide'),button('Export unmastered · 24-bit WAV',()=>exportMix(24,false),'wide'),button('Export aligned processed stems',()=>exportStems(false),'wide'),button('Export aligned dry stems',()=>exportStems(true),'wide'),button('Save portable project',saveBackup,'wide'),el('p','WAVs are 44.1 kHz. Stem files include leading silence and should be imported at time zero. Master ceilings are sample-peak limits, not certified LUFS or true-peak readings. MP3 export remains in Classic Studio.','mini-note'));
    }
  }
  async function previewAlignment(){requireStopped();const c=clip(),t=track();if(!c||t?.kind!=='vocal')throw Error('Select a vocal clip first.');const result=await studio.align(c,p);alignment={...result,clipId:c.id,revision};audioPreview(wav([result.audio],result.rate),'Timing preview');$('dialogContent').append(el('p',result.moved+' regions moved; '+result.skipped+' left in place to avoid collisions.'),button('Keep this alignment',()=>{keepAlignment();closeDialog();},'primary'));}
  function keepAlignment(){requireStopped();if(!alignment||alignment.revision!==revision||alignment.clipId!==selectedClip)throw Error('Make a fresh alignment preview for this selected clip.');const pending=alignment,a=studio.addAsset(asset(uid(),'Aligned vocal',pending.rate,[pending.audio.slice()]));edit(next=>{const c=next.clips.find(x=>x.id===pending.clipId);c.assetId=a.id;c.offset=0;c.duration=a.duration;});status('Alignment kept. Original audio retained; Undo restores the prior clip.');}
  async function balance(){requireStopped();const changes=new Map();for(const t of p.tracks){if(collaboration&&!collaboration.canEdit(t))continue;let sum=0,n=0;for(const c of p.clips.filter(c=>c.trackId===t.id&&!c.muted)){const m=measure(studio.region(c).channels);if(m.activeRms>.000001){sum+=m.activeRms;n++;}}if(n){const target=t.kind==='vocal'?.12:t.kind==='beat'?.09:.05;changes.set(t.id,clamp(20*Math.log10(target/(sum/n)),-24,6));}}edit(next=>next.tracks.forEach(t=>{if(changes.has(t.id))t.gainDb=changes.get(t.id);}));status('Starting gains applied from active-region measurements. Listen and adjust; this is not AI mastering.');}
  async function previewMix(master){requireStopped();const result=await studio.render(p,{master});audioPreview(wav(result.channels,result.rate),master?'Master preview':'Unmastered preview');const pm=result.producerMetrics;const text=pm?`Integrated ${Number.isFinite(pm.integratedLufs)?pm.integratedLufs.toFixed(2):'-∞'} LUFS · true peak ${pm.truePeakDbtp.toFixed(2)} dBTP · LRA ${pm.loudnessRange.toFixed(2)} LU.`:`Sample peak ${result.metrics.peakDb.toFixed(1)} dBFS · RMS proxy ${result.metrics.rmsDb.toFixed(1)} dB. Enable Core 5 Producer mastering for measured loudness/true-peak output.`;$('dialogContent').append(el('p',text,'fine'));}
  async function exportMix(bits,master){requireStopped();const result=await studio.render(p,{master});await saveFile(wav(result.channels,result.rate,bits),safeName(p.title)+(master?'-master':'-premaster')+'.wav');status('WAV exported. Keep a project backup too.');}
  async function exportStems(raw){requireStopped();const blob=await studio.stems(p,raw);await saveFile(blob,safeName(p.title)+(raw?'-dry-stems':'-processed-stems')+'.zip');status('Aligned track WAVs exported with session metadata.');}
  const safeName=name=>name.replace(/[^a-zA-Z0-9_ -]/g,'_').trim().slice(0,100)||'Infected-Voices';
  async function saveFile(blob,name){if(window.ivNative?.saveFile){const result=await window.ivNative.saveFile(name,blob);if(result?.saved===false||result?.cancelled)throw Error('Save cancelled. Your project is unchanged.');}else if(window.ivDesktop?.saveFile){const result=await window.ivDesktop.saveFile({name,bytes:await blob.arrayBuffer()});if(result?.cancelled)throw Error('Save cancelled. Your project is unchanged.');}else download(blob,name);}
  async function saveBackup(){if(!user)throw Error('No project account is open.');const blob=encodeProject(p,studio.assets);await saveFile(blob,safeName(p.title)+'.ivproject');status('Portable project downloaded, including source audio.');}
  async function saveLocal(){requireStopped();const blob=encodeProject(p,studio.assets);await localProjects(user.userId,'save',{id:p.id,title:p.title,modified:Date.now(),blob});dirty=false;status('Project saved on this device. Keep an external backup.');}
  async function openSaved(){requireStopped();const rows=await localProjects(user.userId,'list'),box=el('div',undefined,'file-list');if(!rows.length)box.append(el('p','No projects saved in this account on this device yet.'));for(const row of rows.sort((a,b)=>b.modified-a.modified)){const item=el('div',undefined,'file-row'),name=el('div');name.append(el('strong',row.title),el('small',new Date(row.modified).toLocaleString()));item.append(name,button('Open',async()=>{if(dirty&&!confirm('Open this saved project? Unsaved edits in the current project will be replaced.'))return;replaceProject(decodeProject(await row.blob.arrayBuffer()));closeDialog();}),button('Delete',async()=>{if(!confirm('Delete this local saved project? External backups are not deleted.'))return;await localProjects(user.userId,'delete',row.id);item.remove();}));box.append(item);}dialog('Saved projects · this device',box);}
  function replaceProject(result){if(collaboration)throw Error('Exit the collaboration before opening or replacing the whole project. Download project remains available.');studio.stopPlayback();studio.assets=result.assets;studio.clearCache();p=result.project;history.clear();dirty=false;revision++;alignment=null;selectedTrack=p.tracks[0]?.id||'';selectedClip='';draw();status('Project opened. Source audio and arrangement restored.');}
  function chooseAudio(){requireStopped();if(window.ivDesktop?.openAudio){window.ivDesktop.openAudio().then(files=>run(()=>importFiles(files.map(f=>new File([f.bytes],f.name,{type:f.type||'audio/wav'}))))).catch(e=>status(failure(e)));}else $('audioFiles').click();}
  function importDialog(){requireStopped();let kind=track()?.kind||'beat',separate=true;const wrapper=el('div');wrapper.append(field('kind','Audio type',kind,v=>{kind=v;},{choices:[['beat','Beat / music'],['vocal','Vocal'],['effect','Sound effect']]}),field('importSeparate','One track per file',separate,v=>{separate=v;},{type:'checkbox'}),el('p','To add files to the currently selected track, turn off One track per file. Clips begin at the playhead.','fine'),button('Choose files',()=>{importKind=kind;importSeparate=separate;closeDialog();chooseAudio();},'primary'));dialog('Import audio into the arrangement',wrapper);}
  async function importFiles(files){requireStopped();const errors=[];let count=0;for(const file of files){try{status('Importing '+file.name+'…');const a=await studio.import(file);edit(next=>{let t=next.tracks.find(t=>t.id===selectedTrack);if(importSeparate||!t){t=newTrack(file.name.replace(/\.[^.]+$/,'').slice(0,120),importKind);next.tracks.push(t);}const c=newClip(t.id,a.id,a.duration,file.name.slice(0,160),next.cursor);next.clips.push(c);selectedTrack=t.id;selectedClip=c.id;});count++;}catch(error){errors.push(file.name+': '+failure(error));}}draw();status(count+' file(s) imported.'+(errors.length?' '+errors.join(' '):''));}
  $('audioFiles').onchange=()=>{const files=[...$('audioFiles').files];$('audioFiles').value='';run(()=>importFiles(files));};
  $('importAudio').onclick=()=>run(importDialog);$('emptyImport').onclick=()=>run(importDialog);
  $('addTrack').onclick=()=>run(()=>{requireStopped();let name='Lead vocal',kind='vocal';const content=el('div');content.append(field('trackName','Name',name,v=>{name=v;},{type:'text'}),field('kind','Track type',kind,v=>{kind=v;},{choices:['vocal','beat','effect']}),button('Create track',()=>{const t=newTrack(name.slice(0,120)||'Track',kind);edit(next=>{next.tracks.push(t);selectedTrack=t.id;});closeDialog();},'primary'));dialog('Add a track',content);});
  $('newProject').onclick=()=>run(()=>{requireStopped();if(dirty&&!confirm('Start a new project? Download or save the current project first to keep unsaved edits.'))return;replaceProject({project:newProject(),assets:new Map()});});
  $('saveProject').onclick=()=>run(saveLocal);$('openSaved').onclick=()=>run(openSaved);$('backup').onclick=()=>run(saveBackup);$('recovery').onclick=()=>run(saveBackup);
  $('openProject').onclick=()=>run(()=>{requireStopped();$('projectFile').click();});$('projectFile').onchange=()=>run(async()=>{const f=$('projectFile').files[0];$('projectFile').value='';if(!f)return;if(dirty&&!confirm('Replace unsaved edits with this project?'))return;if(f.size>memoryLimit()+4194304)throw Error('Project file exceeds this device memory budget.');replaceProject(decodeProject(await f.arrayBuffer()));});
  $('importClassic').onclick=()=>run(()=>{requireStopped();$('classicFile').click();});$('classicFile').onchange=()=>run(async()=>{const f=$('classicFile').files[0];$('classicFile').value='';if(!f)return;if(f.size>memoryLimit())throw Error('Classic project is too large for this device.');if(dirty&&!confirm('Replace the current unsaved project with the imported classic project?'))return;replaceProject(importClassic(JSON.parse(await f.text())));});
  function undoRedo(direction){
    requireStopped();const next=history[direction](p);
    if(collaboration)collaboration.mergeHistory(p,next);
    studio.stopPlayback();p=next;dirty=true;revision++;alignment=null;studio.clearCache();draw();changed();
  }
  $('undo').onclick=()=>run(()=>undoRedo('undo'));$('redo').onclick=()=>run(()=>undoRedo('redo'));
  $('split').onclick=()=>run(()=>edit(next=>{const c=splitClip(next,selectedClip,p.cursor);selectedClip=c.id;}));$('duplicate').onclick=()=>run(()=>edit(next=>{selectedClip=duplicateClip(next,selectedClip).id;}));$('deleteClip').onclick=()=>run(()=>{if(!clip())throw Error('Select a clip first.');edit(next=>{next.clips=next.clips.filter(c=>c.id!==selectedClip);});});$('muteClip').onclick=()=>run(()=>{if(!clip())throw Error('Select a clip first.');edit(next=>{const c=next.clips.find(c=>c.id===selectedClip);c.muted=!c.muted;});});
  $('audition').onclick=()=>run(async()=>{requireStopped();const c=clip();if(!c)throw Error('Select a clip first.');const t=track(),result=await studio.rendered(c,t,p);audioPreview(wav(result.channels,result.rate),c.name+' · audition');});
  studio.onLevel=peak=>{$('meterFill').style.width=Math.min(100,peak*100)+'%';$('micLabel').textContent=peak>=.98?'INPUT CLIP':'MIC ON';$('meterFill').style.background=peak>=.98?'var(--red)':'var(--lime)';};
  $('enableMic').onclick=()=>run(async()=>{requireAccess();if(studio.stream&&!studio.recording){studio.releaseMic();$('micLabel').textContent='MIC OFF';$('meterFill').style.width='0';$('enableMic').textContent='Enable mic';return;}await studio.mic(studio.onLevel);$('enableMic').textContent='Release mic';status('Microphone enabled. Check input level before recording.');});
  $('play').onclick=()=>run(async()=>{requireStopped();await studio.play(p);});
  async function stop(){
    if(stopPending)return stopPending;
    stopPending=(async()=>{
      try{
        if(studio.recording){
          const clips=await studio.stopRecording();
          const next=copy(p);
          if(studio.recordProject?.punch)insertPunchTake(next,clips,studio.recordProject.loopStart,studio.recordProject.loopEnd);
          else next.clips.push(...clips);
          if(collaboration && (next.mixer||next.version>=2) && collaboration.protocol!=='collab-v2')throw Error("This project requires the Core 6 collaboration protocol.");
    collaboration?.beforeEdit?.(p,next,selectedTrack);
          validateProject(next,studio.assets);history.push(p);p=next;dirty=true;revision++;changed();
          if(clips.length && core2UI){try{await core2UI.checkpoint('recorded');}catch(problem){status('Take is retained; session snapshot failed: '+failure(problem));}}
          selectedClip=clips[0]?.id||selectedClip;draw();
        }else{studio.cancelPending?.();studio.stopPlayback();status('Stopped.');}
      }catch(error){
        status(failure(error));
        if(studio.recordedSamples>0)dialog('Recover captured audio',[
          el('p','The microphone did not finish normally. The completed capture chunks are still in memory. Save them before closing; the final partial worklet buffer may be missing.'),
          button('Save recovered recording',async()=>{const audio=studio.captureRecovery();await saveFile(wav([audio.samples],audio.rate),'Infected-Voices-recovered-take.wav');},'primary')
        ]);
      }finally{updateTransport();}
    })();
    try{return await stopPending;}finally{stopPending=null;updateTransport();}
  }
  $('stop').onclick=stop;$('record').onclick=()=>studio.recording?stop():run(async()=>{requireStopped();if(collaboration&&!collaboration.canEdit(track()))throw Error('Select your own vocal track.');collaboration?.beforeRecord?.();const recordingProject = copy(p);
    if (recordingProject.punch) {
      if (recordingProject.loop) throw Error('Turn Loop off before using punch recording. A-B remains the punch range.');
      recordingProject.cursor = recordingProject.loopStart;
    }
    await studio.record(recordingProject,track(),stop);updateTransport();});
  $('classic').onclick=()=>{if(dirty&&!confirm('Open Classic Studio? Save or download this project first to keep unsaved changes.'))return;location.href='./lab/index.html';};
  $('demo').onclick=()=>run(()=>{requireStopped();if(p.clips.length&&!confirm('Add synthetic practice tracks to the current project?'))return;const rate=24000,length=rate*12.8,beat=new Float32Array(length);let seed=123456;
    for(let i=0;i<length;i++){const time=i/rate,phase=time%.4;seed=(seed*1664525+1013904223)>>>0;beat[i]=.24*Math.sin(2*Math.PI*(55*phase+15*(1-Math.exp(-phase*35))))*Math.exp(-phase*24)+((time%.2)<.03?(seed/4294967296-.5)*.055*Math.exp(-(time%.2)*100):0);}
    const voice=Float32Array.from({length:rate*4.8},(_,i)=>{const time=i/rate,phase=time%.4;return phase>.04&&phase<.28?.17*Math.sin(2*Math.PI*(Math.floor(time/.8)%2?196:224)*time)*Math.sin(Math.PI*(phase-.04)/.24):0;});
    const fx=Float32Array.from({length:rate*1.6},(_,i)=>.055*Math.sin(2*Math.PI*(300*i/rate+700*Math.pow(i/rate,2)))*(i/(rate*1.6)));
    const assets=[studio.addAsset(asset(uid(),'Practice beat',rate,[beat])),studio.addAsset(asset(uid(),'Synthetic vocal tones',rate,[voice])),studio.addAsset(asset(uid(),'Practice riser',rate,[fx]))];
    edit(next=>{const tracks=[newTrack('01 · Practice beat','beat'),newTrack('02 · Lead test tones','vocal'),newTrack('03 · Transition','effect')];next.tracks.push(...tracks);next.clips.push(newClip(tracks[0].id,assets[0].id,assets[0].duration,'Beat / 150 BPM'),newClip(tracks[1].id,assets[1].id,assets[1].duration,'Synthetic lead · take 1',1.6),newClip(tracks[1].id,assets[1].id,assets[1].duration,'Synthetic lead · reprise',8),newClip(tracks[2].id,assets[2].id,assets[2].duration,'Riser',6.4));selectedTrack=tracks[1].id;selectedClip=next.clips[next.clips.length-3].id;next.loopEnd=12.8;});status('Synthetic practice session added. These tones test controls, not human vocal quality.');
  });
  function savePlugins(){localStorage.setItem('iv-plugins-v1:'+user.userId,JSON.stringify(installed));}
  function pluginStore(){requireStopped();const root=el('div'),grid=el('div',undefined,'dialog-grid');root.append(el('p','Install a preset package, then apply it to a selected vocal track. Packages are validated data—not executable third-party code.','dialog-note'));
    for(const pack of [...CATALOG,...installed.filter(p=>!CATALOG.some(c=>c.id===p.id))]){const card=el('article',undefined,'dialog-card');card.append(el('span','PRESET / FREE','badge'),el('h3',pack.name),el('small',pack.author+' · '+pack.version),el('p',pack.description));const existing=installed.some(p=>p.id===pack.id);
      card.append(button(existing?'Apply to vocal track':'Install',()=>{if(!existing){installed.push(validatePlugin(pack));savePlugins();pluginStore();status(pack.name+' installed.');return;}const t=track();if(!t||t.kind!=='vocal')throw Error('Select a Vocal track before applying a preset.');edit(next=>{next.tracks.find(v=>v.id===t.id).settings={...pack.settings};});closeDialog();status(pack.name+' applied. Undo is available.');},existing?'':'primary'));
      if(existing)card.append(button('Remove',()=>{installed=installed.filter(p=>p.id!==pack.id);savePlugins();pluginStore();}));grid.append(card);
    }root.append(grid);const actions=el('div',undefined,'dialog-actions');actions.append(button('Import .ivplugin',()=>$('pluginFile').click()),button('Download Plugin API guide',()=>saveFile(new Blob([SDK_GUIDE],{type:'text/markdown'}),'Infected-Voices-Plugin-API.md')),button('Download example plugin',()=>saveFile(new Blob([JSON.stringify(CATALOG[0],null,2)],{type:'application/json'}),'Clear-Lead.ivplugin')));root.append(actions,el('p','Native binary plugins, arbitrary code execution, third-party paid listings and developer payouts are not enabled in this preview.','fine'));dialog('Plugin library',root);
  }
  $('pluginFile').onchange=()=>run(async()=>{requireStopped();const file=$('pluginFile').files[0];$('pluginFile').value='';if(!file)return;const pack=await readPlugin(file);if(installed.some(p=>p.id===pack.id)&&!confirm('Replace the installed preset package '+pack.name+'?'))return;installed=installed.filter(p=>p.id!==pack.id);installed.push(pack);savePlugins();pluginStore();});
  $('pluginsTab').onclick=()=>run(pluginStore);$('studioTab').onclick=closeDialog;
  function integrationPage(){requireStopped();const root=el('div'),grid=el('div',undefined,'dialog-grid');
    const integrations=[
      ['FL Studio','FILE / PLUGIN HANDOFF','Export aligned WAV stems and import them at time zero. The earlier separately supplied CLAP effect can be used in compatible hosts. This is not an FL cloud-account login.','Export aligned stems',()=>exportStems(false)],
      ['Rap Fame','MANUAL AUDIO HANDOFF','A supported public account/upload API has not been verified for this app. Export your completed audio and import or share it in Rap Fame. No password is collected here.','Export mix WAV',()=>exportMix(16,true)],
      ['Distribution','PARTNER API REQUIRED','Direct release delivery, royalties and DSP status require an approved distributor API account. Prepare your release metadata here; no release is submitted automatically.','Prepare release package',releasePackage],
      ['SoundCloud','APP CREDENTIALS NOT CONFIGURED','SoundCloud documents OAuth and uploads. App registration, secure credentials and a terms-compliant integration are required before linking is enabled here. Export remains available.','Export audio',()=>exportMix(16,true)]
    ];
    for(const [name,state,text,label,action] of integrations){const card=el('article',undefined,'dialog-card');card.append(el('span',state,'badge'),el('h3',name),el('p',text),button(label,action));grid.append(card);}root.append(grid,el('p','No connection is labeled linked unless the provider has actually authorized it. A download, profile URL or app launch is not account linking.','dialog-note'));dialog('Release & permitted connections',root);
  }
  function releasePackage(){requireStopped();let title=p.title,artist='',isrc='',releaseDate='',explicit=false,rights=false;const root=el('div');root.append(el('p','Creates metadata and an audio handoff package only. It does not upload a release, assign an ISRC or verify rights. Confirm your distributor’s required artwork, audio and legal details.','dialog-note'));
    root.append(field('releaseTitle','Release title',title,v=>{title=v;},{type:'text'}),field('artist','Primary artist',artist,v=>{artist=v;},{type:'text'}),field('isrc','Existing ISRC (optional)',isrc,v=>{isrc=v;},{type:'text'}),field('releaseDate','Requested release date (YYYY-MM-DD)',releaseDate,v=>{releaseDate=v;},{type:'text'}),field('explicit','Contains explicit content',explicit,v=>{explicit=v;},{type:'checkbox'}),field('rights','I own or have appropriate permission for this audio',rights,v=>{rights=v;},{type:'checkbox'}));
    root.append(button('Download release metadata',async()=>{if(!title.trim()||!artist.trim()||!rights)throw Error('Enter a title and artist, and confirm your audio rights.');const code=isrc.trim().replaceAll('-','').toUpperCase();if(code&&!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(code))throw Error('Check the existing ISRC format. Leave it blank when your distributor will assign one.');if(releaseDate&&!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate))throw Error('Use YYYY-MM-DD for the requested date.');
      const data={schema:'InfectedVoicesReleaseDraft',version:1,title:title.trim(),primaryArtist:artist.trim(),isrc:code||null,requestedReleaseDate:releaseDate||null,explicit,rightsConfirmed:true,bpm:p.bpm,key:ROOTS[p.root]+' '+p.scale,submitted:false,artworkIncluded:false,notice:'Draft metadata only. Validate distributor-specific requirements before submission.'};await saveFile(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),safeName(title)+'-release-metadata.json');status('Release draft exported. Nothing was submitted to a distributor.');},'primary'),button('Export accompanying master WAV',()=>exportMix(24,true)));dialog('Prepare a release draft',root);
  }
  $('integrationsTab').onclick=()=>run(integrationPage);
  async function aiPage(){requireStopped();capabilities=(await api.get('/api/workstation/capabilities')).data;const root=el('div'),grid=el('div',undefined,'dialog-grid');
    const assistant=el('article',undefined,'dialog-card');assistant.append(el('span',capabilities.aiAssist?'OWNER PREVIEW':'PREMIUM / NOT ACTIVATED','badge'),el('h3','AI-assisted parameters'),el('p','Uses written goals and measured levels to suggest bounded tuning, alignment, mix or master settings. It does not receive or hear your audio. Changes remain previewable and undoable.'),button('Open parameter assistant',parameterAssistant));
    const mixer=el('article',undefined,'dialog-card');mixer.append(el('span','ROEX / BRING YOUR APPROVED API KEY','badge'),el('h3','Cloud vocal + beat master'),el('p','Renders your vocal and backing groups at the same song origin, then sends them to RoEx with explicit consent. RoEx provider credits are separate from any future app wallet.'),button('Open cloud mixer',()=>cloudAudio('mix')));
    const stems=el('article',undefined,'dialog-card');stems.append(el('span',capabilities.stemSeparation?'HIGHEST-TIER OWNER PREVIEW':'HIGHEST TIER / NOT ACTIVATED','badge'),el('h3','Separate vocals & instruments'),el('p','Use the documented separation service for vocals + instrumental or four stems. Requires a provider account, rights confirmation and explicit provider-credit consent.'),button('Open stem separation',()=>cloudAudio('separate')));
    const wallet=el('article',undefined,'dialog-card');wallet.append(el('span','PURCHASES NOT ENABLED','badge'),el('h3','Plans & credits'),el('p','Existing Studio subscriptions and lifetime codes are preserved. New tier prices, app currency bundles and a transactional wallet must be activated before money is accepted.'),button('View plan status',planStatus));grid.append(assistant,mixer,stems,wallet);root.append(grid);dialog('AI tools & membership',root);
  }
  function planStatus(){dialog('Plans and app currency',[
    el('p','Current access: '+(access?.kind||'none'),'dialog-note'),
    el('h3','Studio · existing membership'),el('p','The current subscription and assigned lifetime codes continue to unlock local Studio and the existing approved-provider workflow.'),
    el('h3','AI tier · configuration pending'),el('p','Reserved for AI-assisted tuning, timing, mix and master workflows. No new price or entitlement is being sold in this preview.'),
    el('h3','Highest tier · configuration pending'),el('p','Adds stem separation and vocal/instrumental isolation. Provider cost controls and the highest-tier entitlement must be activated before public sales.'),
    el('h3','App credits · not activated'),el('p','No fabricated balance is shown. Credit pricing, bundles, refunds, reservations and exactly-once payment fulfillment belong to the transactional wallet supplied with the migration source. RoEx credits are not this app’s currency.'),
    button('Manage existing subscription / code',()=>openExternal(portalURL('./#account')))
  ]);}
  function parameterAssistant(){requireStopped();if(!capabilities?.aiAssist)throw Error('Premium AI parameter tools are not activated for this account. Existing Studio access is unchanged.');let task='tune',goal='Keep the performance clear and natural.';const root=el('div'),result=el('div',undefined,'dialog-status');
    root.append(el('p','Only your written goal, project settings and selected clip’s numeric level measurements are sent. No recording is uploaded. Suggested parameters are not automatic artistic approval.','dialog-note'),field('aiTask','Task',task,v=>{task=v;},{choices:[['tune','Pitch correction'],['align','Timing alignment'],['mix','Vocal mix'],['master','Stereo master']]}),field('goal','What should change?',goal,v=>{goal=v;},{type:'text'}));
    root.append(button('Get parameter plan',async()=>{const c=clip();if(!c)throw Error('Select a vocal clip before using the parameter assistant.');const capturedRevision=revision,capturedTrack=selectedTrack,measurements=measure(studio.region(c).channels);result.textContent='Requesting a parameter plan…';try{const response=await api.post('/api/workstation/assist',{task,goal:goal.slice(0,600),bpm:p.bpm,root:p.root,scale:p.scale,metrics:{peakDb:measurements.peakDb,rmsDb:measurements.rmsDb,crestDb:measurements.crestDb}});const plan=response.data;result.replaceChildren(el('p',plan.explanation));const apply=button('Apply suggested settings',()=>{if(revision!==capturedRevision||selectedTrack!==capturedTrack)throw Error('The project changed. Request a fresh plan before applying.');edit(next=>{if(task==='align')Object.assign(next.timing,plan.settings);else if(task==='master')Object.assign(next.mastering,plan.settings);else{const t=next.tracks.find(t=>t.id===capturedTrack);if(t.kind!=='vocal')throw Error('Select a vocal track.');for(const [k,v] of Object.entries(plan.settings)){if(k==='gainDb')t.gainDb=v;else t.settings[k]=v;}}});closeDialog();setStage(task==='align'?3:task==='tune'?4:task==='mix'?5:6);status('AI-assisted settings applied. Preview and listen; Undo is available.');});result.append(apply);}catch(error){result.textContent=failure(error);throw error;}},'primary'),result);dialog('AI parameter assistant',root);
  }
  const cloudURL=value=>{if(typeof value!=='string'||value.length>8192)throw Error('Provider returned an invalid audio URL.');const url=new URL(value);if(url.protocol!=='https:'||url.hostname!=='storage.googleapis.com'||url.username||url.password||url.port)throw Error('Unexpected provider storage location.');return url.href;};
  async function cloudAudio(mode){requireStopped();if(mode==='separate'&&!capabilities?.stemSeparation)throw Error('Highest-tier stem separation is not activated for this account.');const root=el('div'),key=el('input'),consent=el('input'),charge=el('input'),rights=el('input'),output=el('div',undefined,'dialog-status');key.type='password';key.autocomplete='off';key.placeholder='Approved RoEx Tonn API key';key.setAttribute('aria-label','RoEx Tonn API key');consent.type=charge.type=rights.type='checkbox';let separation='vocals_instrumental',style='HIPHOP_GRIME',loudness='MEDIUM',job=null;
    root.append(el('p','The API key is used for these requests and is not saved. Cloud processing uploads audio to RoEx. Closing this panel does not cancel a submitted provider job. Save the returned job reference to resume status checks.','dialog-note'),el('label','RoEx Tonn API key'),key);
    for(const [input,text] of [[rights,'I have rights to process the audio I submit.'],[consent,'I consent to uploading this audio to RoEx.']]){const label=el('label');label.append(input,document.createTextNode(' '+text));root.append(label,el('br'));}
    if(mode==='separate'){root.append(field('separationMode','Stem output',separation,v=>{separation=v;},{choices:[['vocals_instrumental','Vocals + instrumental'],['four','Vocals, drums, bass and other']]}));const label=el('label');label.append(charge,document.createTextNode(' I approve the provider’s 75-credit separation reservation/charge on success.'));root.append(label,el('p','This is 75 RoEx credits—not an Infected Voices credit price. The selected clip is uploaded as a standalone region.','fine'));}
    else root.append(field('cloudStyle','Music style',style,v=>{style=v;},{choices:[['HIPHOP_GRIME','Hip-hop / Grime'],['TRAP','Trap'],['ELECTRONIC','Electronic'],['POP','Pop'],['ROCK_INDIE','Rock / Indie'],['METAL','Metal']]}),field('cloudLoudness','Loudness preset',loudness,v=>{loudness=v;},{choices:['LOW','MEDIUM','HIGH']}),el('p','Submission and preview use the provider’s preview workflow. Retrieving the final master requires a separate confirmation for 250 RoEx credits. Files must already be aligned; the provider does not tune or align them.','fine'));
    async function call(action,body={}){if(key.value.trim().length<12)throw Error('Enter a valid approved RoEx API key.');return (await api.post(mode==='separate'?'/api/workstation/separation':'/api/ai/audio',{key:key.value.trim(),action,consent:consent.checked,...body})).data;}
    async function upload(blob){const data=(await api.post('/api/ai/audio',{key:key.value.trim(),action:'upload',consent:true})).data;const response=await fetch(cloudURL(data.signed_url),{method:'PUT',headers:{'Content-Type':'audio/wav'},body:blob});if(!response.ok)throw Error('Audio upload failed. No new processing job was submitted.');return cloudURL(data.readable_url);}
    const submit=button(mode==='separate'?'Upload selected clip & separate':'Upload aligned vocal/backing & mix',async()=>{
      if(!rights.checked||!consent.checked)throw Error('Confirm your audio rights and cloud-upload consent.');if(job)throw Error('A job is already submitted in this panel. Check its status instead.');output.textContent='Preparing audio…';
      try{if(mode==='separate'){if(!charge.checked)throw Error('Approve the provider-credit reservation before submitting.');const c=clip();if(!c)throw Error('Select a mixed-audio clip to separate.');const region=studio.region(c),url=await upload(wav(region.channels,region.rate));submit.disabled=true;const data=await call('submit',{audioUrl:url,mode:separation,acceptCharge:true});job=data.jobId;output.textContent='Separation submitted. Job reference: '+job+'. Use Check status.';}
      else{if(!p.tracks.some(t=>t.kind==='vocal')||!p.tracks.some(t=>t.kind!=='vocal'))throw Error('The cloud mixer needs vocal and backing tracks.');const vocals=copy(p),backing=copy(p);vocals.tracks.forEach(t=>{t.mute=t.mute||t.kind!=='vocal';});backing.tracks.forEach(t=>{t.mute=t.mute||t.kind==='vocal';});const v=await studio.render(vocals,{raw:false}),b=await studio.render(backing,{raw:true});const vocalUrl=await upload(wav(v.channels,v.rate)),beatUrl=await upload(wav(b.channels,b.rate));const data=await call('mix',{vocals:vocalUrl,beat:beatUrl,style,loudness,vocalGain:0});job=data.recombineTaskId;if(!job)throw Error('Provider did not return a mix job reference. Do not resubmit automatically.');output.textContent='Cloud mix submitted. Job reference: '+job+'. Use Check status.';}
      }catch(error){output.textContent=failure(error);throw error;}
    },'primary');root.append(el('div',undefined,'dialog-actions'));root.lastChild.append(submit,button('Check status',async()=>{if(!job)throw Error('Submit a job or enter an existing job reference first.');const data=await call('status',mode==='separate'?{jobId:job}:{taskId:job});output.textContent='Provider status: '+data.status+' · '+job;if(data.status==='failed')throw Error('Provider processing failed. Review the provider account before retrying.');}),button('Resume job',()=>{const value=prompt('Enter the job reference returned by this app');if(value&&/^[A-Za-z0-9_-]{1,120}$/.test(value)){job=value;output.textContent='Job reference selected. Check status; this does not submit or charge a new job.';}}));
    if(mode==='separate')root.append(button('Retrieve completed stems',async()=>{if(!job)throw Error('Select a completed separation job.');const data=await call('retrieve',{jobId:job});if(!data.stems||typeof data.stems!=='object')throw Error('No completed stem files returned.');output.replaceChildren();for(const [name,url] of Object.entries(data.stems)){if(!url)continue;const safe=cloudURL(url);const row=el('div',undefined,'file-row');row.append(el('strong',name),button('Download',()=>openExternal(safe)),button('Import to project',async()=>{const response=await fetch(safe);if(!response.ok)throw Error('Stem download failed or expired. Retrieve fresh URLs.');const blob=await response.blob();importKind=name==='vocals'?'vocal':'beat';importSeparate=true;await importFiles([new File([blob],name+'.wav',{type:'audio/wav'})]);}));output.append(row);}},'wide'));
    else root.append(button('Retrieve free preview',async()=>{if(!job)throw Error('Select a completed mix job.');const data=await call('preview',{taskId:job});const audio=el('audio');audio.controls=true;audio.src=cloudURL(data.preview?.preview_url);output.replaceChildren(audio,el('p','Provider preview. Listen before purchasing the final master.'));},'wide'),button('Retrieve final master · 250 RoEx credits',async()=>{if(!job)throw Error('Select a completed mix job.');if(!confirm('Approve the provider’s 250 RoEx-credit charge for this job’s final master? This is not an Infected Voices credit purchase.'))return;const data=await call('final',{taskId:job,acceptCharge:true});const url=cloudURL(data.result?.master_url);output.replaceChildren(el('p','Final master available. Provider-reported format: 44.1 kHz stereo, 16-bit PCM WAV.'),button('Open master download',()=>openExternal(url)));},'wide'));
    root.append(output);dialog(mode==='separate'?'Cloud stem separation':'Cloud vocal + beat mix',root);
  }
  $('aiTab').onclick=()=>run(aiPage);
  function deviceMenu(){const root=el('div');let mode=localStorage.getItem('iv-device-mode')||'auto';root.append(field('deviceMode','Layout mode',mode,v=>{localStorage.setItem('iv-device-mode',v);applyMode();},{choices:[['auto','Automatic'],['ios','iOS touch'],['android','Android touch'],['pc','PC / desktop']]}),el('p','Layout changes affect spacing and control sizes, not the actual operating system or audio-driver capabilities.','fine'),button('Check desktop updates',async()=>{requireStopped();if(window.ivDesktop?.checkForUpdates){const result=await window.ivDesktop.checkForUpdates();status(result.message||'Update check completed.');dialog('Desktop update status',el('p',result.message||'No status returned.'));}else{dialog('Desktop updates',el('p','This client has no verified automatic-install update bridge. Use the protected Downloads page for available builds. Do not assume that reloading web assets installs a signed native update.'));}}),button('Open downloads & setup',()=>openExternal(portalURL('./#windows'))));dialog('Application settings',root);}
  function applyMode(){const requested=localStorage.getItem('iv-device-mode')||'auto';let mode=requested;if(mode==='auto'){const ua=navigator.userAgent;mode=/iPhone|iPad|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)?'ios':/Android/.test(ua)?'android':'pc';}document.body.dataset.deviceMode=mode;}
  $('wrench').onclick=()=>run(deviceMenu);applyMode();
  function showGuide(list,index,required,progress=0){guideList=list;guideIndex=index;guideRequired=required;guideHighest=progress;$('closeGuide').hidden=required;$('guideDialog').showModal();renderGuide();}
  function renderGuide(){const chapter=guideList[guideIndex];$('guideTitle').textContent=chapter.title;$('guideBody').replaceChildren(...chapter.paragraphs.map(text=>el('p',text)));$('guideCount').textContent=(guideRequired?'FIRST-USE WALKTHROUGH · ':'RECAP · ')+(guideIndex+1)+' OF '+guideList.length;$('guideBack').disabled=guideIndex===0;$('guideNext').textContent=guideIndex===guideList.length-1?'Finish walkthrough':'Continue →';$('guideTopics').replaceChildren();
    guideList.forEach((g,i)=>{const b=el('button',g.title,i===guideIndex?'current':'');b.disabled=guideRequired&&i>guideHighest;b.onclick=()=>{guideIndex=i;renderGuide();};$('guideTopics').append(b);});document.querySelectorAll('.guide-highlight').forEach(n=>n.classList.remove('guide-highlight'));$(chapter.target)?.classList.add('guide-highlight');}
  $('guideDialog').addEventListener('cancel',e=>{if(guideRequired)e.preventDefault();});
  $('guideDialog').addEventListener('close',()=>document.querySelectorAll('.guide-highlight').forEach(n=>n.classList.remove('guide-highlight')));
  $('closeGuide').onclick=()=>{if(!guideRequired)$('guideDialog').close();};$('guideBack').onclick=()=>{if(guideIndex>0){guideIndex--;renderGuide();}};
  $('guideNext').onclick=async()=>{
    if(guideBusy)return;guideBusy=true;$('guideNext').disabled=true;$('guideStatus').textContent='';
    try{if(guideRequired&&guideIndex>=guideHighest){const {data}=await api.post('/api/onboarding',{version:GUIDE_VERSION,step:guideIndex,chapter:guideList[guideIndex].id});guideHighest=data.progress;if(data.complete)tutorialComplete=true;}
      if(guideIndex<guideList.length-1){guideIndex++;renderGuide();}else{$('guideDialog').close();guideRequired=false;await refresh();status('Walkthrough complete. Tutorial is always available for a full recap or a specific topic.');}
    }catch(error){$('guideStatus').textContent=failure(error);}finally{guideBusy=false;$('guideNext').disabled=false;}
  };
  function tutorialMenu(){if(!access?.allowed){help('tutorial','Studio tutorial');return;}if(!tutorialComplete){showGuide(GUIDES,Math.min(guideHighest,GUIDES.length-1),true,guideHighest);return;}const root=el('div'),list=el('div',undefined,'file-list');root.append(button('Full walkthrough',()=>{closeDialog();showGuide(GUIDES,0,false);},'primary wide'));for(const chapter of GUIDES)list.append(button(chapter.title,()=>{closeDialog();showGuide([chapter],0,false);}));root.append(list);dialog('Tutorial · full recap or a topic',root);}
  $('tutorial').onclick=()=>run(tutorialMenu);
  const guideAccount=el('button','Account','quiet');guideAccount.onclick=()=>openExternal('https://nation.infectedvoices.space/');document.querySelector('.guide-top').append(guideAccount);
  window.addEventListener('hashchange',()=>{pendingPage=location.hash.slice(1);if(tutorialComplete)run(refresh);});
  $('accountButton').onclick=()=>openExternal('https://nation.infectedvoices.space/');$('unlock').onclick=()=>run(async()=>{const {data}=await api.post('/api/billing/checkout',{});openExternal(data.url);});
  async function lock(message,signedIn=!!user){studio.cancelPending();if(studio.recording)await stop();studio.stopPlayback();studio.releaseMic();if($('guideDialog').open)$('guideDialog').close();if($('helpDialog').open)$('helpDialog').close();closeDialog();$('appShell').hidden=true;$('loginWall').hidden=false;$('gateText').textContent=message;$('unlock').hidden=!signedIn;$('signIn').hidden=signedIn;$('recovery').hidden=!p.clips.length;$('logout').hidden=!signedIn;if(!signedIn&&!studio.protectedStart&&!studio.finalizingRecording)studio.configureAccount(null);reliabilityUI?.refresh();}
  async function refresh(){
    if(refreshing)return;refreshing=true;
    try{const current=await auth.getUser();if(!current){access=null;await lock('Sign in with InfectedNation to use Infected Voices.',false);return;}
      if(user&&user.userId!==current.userId){studio.cancelPending();if(studio.recording)await stop();studio.stopPlayback();studio.releaseMic();studio.clearCache();installed=[];selectedClip='';selectedTrack='';studio.assets.clear();p=newProject();history.clear();initialized=false;dirty=false;}
      user=current;studio.configureAccount(current.userId);const response=await api.get('/api/access');access=response.data;$('logout').hidden=false;
      if(!access.allowed){await lock(access.kind==='banned'?'This account is restricted.':'Studio access is not active for this account. Activate Studio Plus from the browser to continue.');return;}
      const guide=(await api.get('/api/onboarding')).data;tutorialComplete=guide.complete;guideHighest=guide.progress;
      $('loginWall').hidden=true;$('appShell').hidden=false;$('sessionIdentity').textContent=user.email||'Signed in';window.ivUserId=user.userId;
      if(!initialized){try{const stored=JSON.parse(localStorage.getItem('iv-plugins-v1:'+user.userId)||'[]');installed=Array.isArray(stored)?stored.map(validatePlugin):[];}catch{installed=[];}initialized=true;draw();setStage(0);}
      if(!tutorialComplete&&!$('guideDialog').open)showGuide(GUIDES,Math.min(guide.progress,GUIDES.length-1),true,guide.progress);
      else if(tutorialComplete&&native&&!localStorage.getItem('iv-desktop-recap:'+user.userId)){
        localStorage.setItem('iv-desktop-recap:'+user.userId,'offered');dialog('Welcome to the desktop workspace',[el('p','Your web walkthrough is complete. Would you like a desktop recap now? Tutorial remains available at any time.'),button('Full recap',()=>{closeDialog();showGuide(GUIDES,0,false);},'primary'),button('Choose a topic',tutorialMenu),button('Continue to Studio',closeDialog)]);
      }
      updateTransport();
      if (tutorialComplete && core2UI) await core2UI.restoreAfterUpdate();
      if(tutorialComplete&&!$('guideDialog').open&&pendingPage){const destination=pendingPage;pendingPage='';if(destination==='plugins')pluginStore();else if(destination==='integrations')integrationPage();else if(destination==='tutorial')tutorialMenu();else if(destination==='ai')await aiPage();}
    }catch(error){access=null;await lock('Access could not be verified. Reconnect and refresh. Your in-memory project can still be saved using recovery.');status(failure(error));}finally{refreshing=false;}
  }
  $('signIn').onclick=()=>run(async()=>{try{await auth.signIn();await refresh();}catch(error){if(error.code==='popup_blocked')throw Error('Allow the InfectedNation sign-in popup and try again.');if(error.code==='popup_closed')throw Error('Sign-in was closed. Try again.');throw error;}});
  $('retryAccess').onclick=()=>run(refresh);
  $('logout').onclick=()=>run(async()=>{if(studio.recording)await stop();if(dirty&&!confirm('Log out with unsaved changes? Choose Cancel to save a project backup first.'))return;await collaboration?.logout?.();await auth.signOut();studio.releaseMic();studio.stopPlayback();p=newProject();studio.assets.clear();studio.clearCache();history.clear();user=null;access=null;initialized=false;dirty=false;installed=[];studio.configureAccount(null);reliabilityUI?.refresh();if($('guideDialog').open)$('guideDialog').close();closeDialog();await refresh();});
  window.addEventListener('iv-auth-status',event=>status(event.detail));
  window.addEventListener('beforeunload',event=>{if(dirty||studio.recording){event.preventDefault();event.returnValue='';}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&studio.recording)stop();if(!document.hidden)refresh();});
  window.addEventListener('iv-native-background',()=>{if(studio.recording)stop();studio.stopPlayback();});
  document.addEventListener('keydown',event=>{if(/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)||document.querySelector('dialog[open]'))return;if(event.code==='Space'){event.preventDefault();studio.playing?stop():$('play').click();}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();$('saveProject').click();}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();$(event.shiftKey?'redo':'undo').click();}if(event.key.toLowerCase()==='r'&&!event.ctrlKey&&!event.metaKey){event.preventDefault();studio.recording?stop():$('record').click();}});
  reliabilityUI = installReliabilityUI({
    studio, getProject: () => p, getUser: () => auth.isSignedIn() ? user : null,
    isDirty: () => dirty, edit, run, requireAccess,
    replaceProject, saveFile, dialog, closeDialog
  });
  window.ivWorkstationRecovery=saveBackup;
  window.ivWorkstationShutdown=async()=>{if(studio.recording)await stop();studio.stopPlayback();studio.releaseMic();};
  if(window.ivDesktop?.onMenu)window.ivDesktop.onMenu(action=>{const map={new:'newProject',open:'openProject',save:'saveProject',export:'backup',undo:'undo',redo:'redo',tutorial:'tutorial',updates:'wrench'};$(map[action])?.click();});
  setInterval(()=>{if(!document.hidden&&auth.isSignedIn())refresh();},60000);
  setInterval(async()=>{if(autosaving||busy||studio.recording||!dirty||!access?.allowed||!tutorialComplete||!p.clips.length)return;autosaving=true;const savedRevision=revision;try{await localProjects(user.userId,'save',{id:'recovery-'+p.id,title:p.title+' · recovery',modified:Date.now(),blob:encodeProject(p,studio.assets)});if(revision===savedRevision)status('Recovery checkpoint saved on this device. Download a project backup for permanent storage.');}catch(error){status('Recovery checkpoint failed: '+failure(error));}finally{autosaving=false;}},45000);
  function frame(){if(studio.playing){const time=studio.cursor();$('clock').textContent=barBeat(time,p).replace(':',' : ');$('seconds').textContent=Math.floor(time/60)+':'+(time%60).toFixed(2).padStart(5,'0');$('playhead').style.left=time*p.zoom+'px';if(!studio.loop&&!studio.recording&&time>studio.position+studio.length)studio.stopPlayback();}else{$('clock').textContent=barBeat(p.cursor,p).replace(':',' : ');$('seconds').textContent=Math.floor(p.cursor/60)+':'+(p.cursor%60).toFixed(2).padStart(5,'0');}requestAnimationFrame(frame);}frame();
  core2UI = installCore2UI({
    studio,
    getState: () => ({owner: auth.isSignedIn() ? (user?.userId || null) : null, project: p, projectId: p.id, revision,
      dirty, hasProject: dirty || !!(p.tracks.length || p.clips.length || p.notes || p.title !== 'Untitled session'),
      recording: !!studio.recording, starting: !!studio.protectedStart,
      finalizing: !!studio.finalizingRecording || !!stopPending, pendingWrites: studio.writer?.pendingBytes || 0,
      playing: !!studio.playing, busy, native}),
    getSelection: () => ({track: selectedTrack, clip: selectedClip}),
    selectClip: id => {selectedClip = id;},
    edit, run, requireStopped, replaceProject, saveFile, dialog, closeDialog,
    markSaved: () => {dirty = false;}, openExternal
  });
  core3UI = installMixerUI({studio,getState:()=>({project:p,owner:user?.userId,busy,collaboration}),edit,run,requireStopped,dialog,closeDialog,
    play:async()=>{requireStopped();await studio.play(p);updateTransport();},stop});
  core4UI = installPrecisionUI({getProject:()=>p,getClip:clip,getTrack:track,studio,edit,dialog,status,run,requireStopped});
  core5UI = installProducerUI({studio,getProject:()=>p,edit,run,requireStopped,dialog,status,getPlayhead:()=>studio.playing?studio.cursor():p.cursor});
  window.ivGetSessionState=()=>({recording:!!studio.recording,starting:!!studio.protectedStart,finalizing:!!studio.finalizingRecording||!!stopPending,playing:!!studio.playing,dirty,busy:busy||autosaving,pendingWrites:!!studio.writer?.pendingBytes});
  if(window.ivDesktop?.setSessionState){setInterval(()=>window.ivDesktop.setSessionState(window.ivGetSessionState()),1000);window.ivDesktop.setSessionState(window.ivGetSessionState());}
  await refresh();
  if (tutorialComplete && access?.allowed) await core2UI.restoreAfterUpdate();
  return {
    project:()=>copy(p), assets:()=>studio.assets,
    selection:()=>({trackId:selectedTrack,clipId:selectedClip}),
    currentUser:()=>user, requireReady:requireStopped,
    busy:()=>busy||!!studio.recording||!!studio.protectedStart||!!studio.finalizingRecording||!!stopPending,
    transport:()=>({recording:!!studio.recording,playing:!!studio.playing,playhead:studio.playing?studio.cursor():p.cursor,selectedTrack}),
    setCollaboration(value){if(value&&p.version>=2&&value.protocol!=='collab-v2')throw Error("Core 3/4/5 projects require Core 6 collaboration. Keep a portable backup.");collaboration=value;history.clear();draw();},
    remote(project,assets){
      // The collaboration adapter retains the local unsynced contribution.
      // A partner update changes the arrangement but never cuts off local capture.
      validateProject(project,assets);p=copy(project);studio.assets=assets;studio.clearCache();revision++;alignment=null;draw();
    },
    replace:replaceProject, status, saveBackup,
    async checkpointForNativeUpdate(){if(!user){updateTransport();return {saved:true};}requireStopped();if(collaboration)throw Error("Leave collaboration after saving before installing an update.");if(studio.playing)throw Error("Stop playback before updating.");await core2UI.checkpoint('before-update');await saveLocal();updateTransport();return {saved:true,projectId:p.id};},
    saveLocal, stop,
    async renderMaster(){requireStopped();return studio.render(copy(p),{master:true});},
    async playAt(time){requireStopped();p.cursor=clamp(time,0,21600);await studio.play(p);},
    markSaved(){dirty=false;},
    refresh
  };
}


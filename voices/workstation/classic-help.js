import {HELP,PRESET_HELP,describe} from './help.js';

const aliases={latency:'compensationMs',masterTargetDb:'targetDb',masterCeiling:'ceiling',masterCompression:'masterCompression',masterWidth:'width',masterDrive:'masterDrive',pocketSwing:'swing',pocketSensitivity:'sensitivity',pocketPreserve:'preserve',pocketGap:'minGapMs',pocketProfile:'timingPreset'};
const extra={
  monitor:['Live processed monitoring','Lets you hear the classic vocal processing while recording dry audio. Use headphones. Software buffering, granular pitch processing and Bluetooth can introduce audible latency; turn monitoring off if it disrupts your delivery.'],
  beatGain:['Beat volume','Controls backing-track level in the classic mix, independently of vocal clip gain. Start low, raise the vocal until words are clear, then adjust the beat. It cannot repair clipping that exists in the imported file.'],
  acapella:['Vocals-only playback and export','Omits the backing beat during playback and export. Your original beat remains in the project and can be enabled again. This is track selection, not extraction of vocals from a mixed recording.'],
  stemKind:['Selected vocal stem','Dry exports the selected vocal at its current edited timing without voice effects. Processed adds the selected classic vocal effects. Leading silence preserves the vocal’s position when imported at song time zero in another DAW.'],
  format:['Export format','WAV is uncompressed PCM; 24-bit provides a production handoff and 16-bit supports destinations that require it. MP3 is lossy and uses the quality selector. A higher output bit depth or bitrate cannot restore information missing from the recording.'],
  bitrate:['MP3 bitrate','Sets the encoder output rate in kilobits per second. Higher values use more space and generally preserve more information. Keep a WAV master and encode MP3 only for a destination that needs it.'],
  tuneWithMix:['Pitch correction during mix balance','Enables the existing song-key pitch correction when applying classic mix balance. With tuning off, it supplies the documented 70% starting amount. It does not discover the correct key. Undo mix restores the previous tuning state.'],
  pocketMode:['Timing correction mode','Conservative uses smaller safe moves to retain the performer’s pocket. Full permits stronger safe correction. Neither should overwrite an original recording; audition the preview before committing.'],
  nudgeMs:['Timing nudge / milliseconds','Moves the selected vocal earlier or later by the entered interval. This shifts the region on the timeline without changing its sample rate or pitch. Use small nudges after a measured recording-delay test.'],
  masterProfile:['Mastering style','Selects a bundle of classic bus parameters such as level, width, drive and ducking. It is a starting recipe, not a separate licensed AI model or a guarantee of commercially mastered sound. Adjust the individual controls after listening.'],
  masterVocalLevel:['Master vocal trim / dB','Changes the vocal contribution to the final classic render independently of the beat. Use it for final balance, not to compensate for a clipped microphone recording.'],
  masterBeatLevel:['Master beat trim / dB','Changes the beat contribution to the final classic render. Leave headroom for the vocal and check the whole song before increasing final output level.'],
  masterDucking:['Vocal-driven backing ducking','Reduces the backing around vocal activity to help the words remain audible. Excessive reduction can cause pumping. Begin with a small amount and compare with ducking off.'],
  masterAir:['Master air EQ / dB','Adjusts high-frequency brightness on the combined output. A small boost can sound more open; too much emphasizes hiss and sibilance. Correct harsh individual tracks before brightening the whole mix.'],
  masterLowCut:['Master low-cut / Hz','Reduces low-frequency energy beneath the selected cutoff on the final mix. A high value can remove bass fundamentals; use a conservative cutoff and inspect the bass and kick by listening.'],
  presetName:['Custom preset name','Names a saved collection of classic sound settings on this device. It does not save the whole song or upload a plugin. Save a project backup to preserve your audio and arrangement.']
};
export function mountClassicHelp(){
  if(document.getElementById('classicContextHelp'))return;
  const root=document.getElementById('studioShell');if(!root)return;
  const dialog=document.createElement('dialog');dialog.id='classicContextHelp';
  const title=document.createElement('h2'),text=document.createElement('p'),close=document.createElement('button');
  close.textContent='Close explanation';close.onclick=()=>dialog.close();dialog.append(title,text,close);document.body.append(dialog);
  const style=document.createElement('style');style.textContent='.iv-context-info{border-radius:50%!important;min-height:20px!important;width:20px!important;height:20px!important;padding:0!important;font:italic 12px Georgia!important;margin-left:6px!important;display:inline-grid!important;place-items:center;vertical-align:middle}#classicContextHelp{max-width:min(560px,90vw);background:#1a1522;color:#eeeaf4;border:1px solid #6e4c8b;border-radius:14px;padding:26px}#classicContextHelp::backdrop{background:#08050bbd}#classicContextHelp p{font-size:14px;line-height:1.8}';document.head.append(style);
  function button(label,entry){const b=document.createElement('button');b.type='button';b.className='iv-context-info';b.textContent='i';b.setAttribute('aria-label','About '+label);b.onclick=e=>{e.preventDefault();e.stopPropagation();title.textContent=entry[0];text.textContent=entry[1];dialog.showModal();};return b;}
  function scan(){
    for(const input of root.querySelectorAll('input,select,textarea')){
      if(input.dataset.ivHelpReady||input.type==='hidden'||input.type==='file')continue;
      input.dataset.ivHelpReady='1';const label=input.closest('label')||(input.id?root.querySelector('label[for="'+CSS.escape(input.id)+'"]'):null),name=input.getAttribute('aria-label')||label?.textContent.trim()||input.id||'Control';
      const key=aliases[input.id]||input.id.replace(/^(fx-|control_|control-|s_)/,'');
      let entry=extra[input.id]||HELP[key]||describe(key,name);
      if(!extra[input.id]&&!HELP[key]&&input.hasAttribute('min')&&input.hasAttribute('max'))entry=[name,entry[1]+' The visible allowed range is '+input.min+' to '+input.max+'.'];
      const target=label||input.parentElement;if(target)target.append(button(name,entry));
    }
    for(const item of root.querySelectorAll('#presets>button,#customPresets>button')){
      if(item.dataset.ivHelpReady||item.classList.contains('iv-context-info'))continue;
      item.dataset.ivHelpReady='1';const name=item.textContent.trim();item.after(button('preset '+name,[name,PRESET_HELP[name]||'This saved preset applies its vocal-processing settings. The source audio stays intact. Confirm song key, compare at similar volume and adjust the individual controls for your performance.']));
    }
  }
  let queued=false;
  new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;scan();});}).observe(root,{childList:true,subtree:true});
  scan();
}

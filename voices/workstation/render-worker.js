import {pitchRender,soundRender,legacyShape,alignAudio,masterAudio} from './core.js';
import {precisionPitch,warpAudio,analyzePitch} from './precision-dsp.js';
self.onmessage=({data})=>{
  const {id,action}=data;
  try {
    let result;
    if(action==='vocal') {
      const warped=data.precision?.warpEnabled?warpAudio(data.samples,data.rate,data.precision.warpMarkers):data.samples;
      const pitch=data.precision?.pitchEnabled?precisionPitch(warped,data.rate,data.settings,data.precision,{root:data.settings.root,scale:data.settings.scale,sections:data.sections,start:data.start}):pitchRender(warped,data.rate,data.settings,data.engine,data.sections,data.start);
      result={samples:data.sound==='infected'?soundRender(pitch,data.rate,data.settings):legacyShape(pitch,data.rate,data.settings)};
    } else if(action==='precisionAnalyze') result=analyzePitch(data.samples,data.rate,data.context);
    else if(action==='align') result=alignAudio(data.samples,data.rate,data.start,data.project);
    else if(action==='master')result={channels:masterAudio(data.channels,data.rate,data.project)};
    else throw Error('Unknown render operation.');
    self.postMessage({id,result},[...(result.samples?[result.samples.buffer]:[]),...(result.audio?[result.audio.buffer]:[]),...(result.channels?result.channels.map(c=>c.buffer):[])]);
  }catch(error){self.postMessage({id,error:error.message||'Audio processing failed.'});}
};

self.postMessage({ready:true});

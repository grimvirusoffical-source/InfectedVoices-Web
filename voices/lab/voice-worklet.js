import {VoiceDSP} from './dsp.js';
class VoiceProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.dsp=new VoiceDSP(sampleRate,options.processorOptions||{});
    this.record=false;this.chunk=new Float32Array(2048);this.used=0;
    this.port.onmessage=({data})=>{
      if(data.settings)this.dsp.configure(data.settings);
      if(data.record!==undefined) {this.record=data.record;if(!data.record){this.flush();this.port.postMessage({stopped:true});}}
    };
  }
  flush() {
    if(this.used) {
      const audio=this.chunk.slice(0,this.used);
      this.port.postMessage({audio,frame:this.chunkFrame},[audio.buffer]);
      this.used=0;
    }
  }
  process(inputs,outputs) {
    const input=inputs[0]?.[0], output=outputs[0]?.[0];
    if(!output)return true;
    for(let i=0;i<output.length;i++) {
      const v=input?.[i]||0;
      output[i]=this.dsp.sample(v);
      if(this.record) {
        if(this.used===0)this.chunkFrame=currentFrame+i;
        this.chunk[this.used++]=v;
        if(this.used===2048)this.flush();
      }
    }
    return true;
  }
}
registerProcessor('iv-voice',VoiceProcessor);
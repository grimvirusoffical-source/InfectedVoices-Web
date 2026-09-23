import {LinkedCompressor} from './mix-dynamics.js';
import {SidechainKernel,GrimKernel} from './producer-dsp.js';
class MixerDynamics extends AudioWorkletProcessor {
  static get parameterDescriptors(){return [
    {name:'enabled',defaultValue:0,minValue:0,maxValue:1,automationRate:'k-rate'},
    {name:'threshold',defaultValue:-18,minValue:-60,maxValue:0,automationRate:'k-rate'},
    {name:'ratio',defaultValue:3,minValue:1,maxValue:20,automationRate:'k-rate'},
    {name:'knee',defaultValue:6,minValue:0,maxValue:24,automationRate:'k-rate'},
    {name:'attackMs',defaultValue:10,minValue:0.1,maxValue:100,automationRate:'k-rate'},
    {name:'releaseMs',defaultValue:150,minValue:10,maxValue:1500,automationRate:'k-rate'},
    {name:'makeupDb',defaultValue:0,minValue:-18,maxValue:18,automationRate:'k-rate'},
    {name:'blend',defaultValue:1,minValue:0,maxValue:1,automationRate:'k-rate'}];}
  constructor(){super();this.dynamics=new LinkedCompressor(sampleRate);this.counter=0;this.closed=false;this.values={};this.port.onmessage=e=>{if(e.data==='dispose')this.closed=true;};}
  process(inputs,outputs,params){if(this.closed)return false;const x=inputs[0]||[],y=outputs[0];if(!y?.length)return true;const p=this.values;for(const k in params)p[k]=params[k][0];
    const [attack,release]=this.dynamics.coefficients(p.attackMs,p.releaseMs);
    for(let i=0;i<y[0].length;i++){let peak=0;for(let ch=0;ch<x.length;ch++)peak=Math.max(peak,Math.abs(x[ch][i]||0));const g=this.dynamics.next(peak,p,attack,release);for(let ch=0;ch<y.length;ch++){const v=x[ch]?.[i]??x[0]?.[i]??0;y[ch][i]=Number.isFinite(v)?v*g:0;}}
    this.counter+=y[0].length;if(this.counter>=4096){this.counter=0;this.port.postMessage({reduction:this.dynamics.reduction});}return true;}
}
class SidechainDucker extends AudioWorkletProcessor{
  static get parameterDescriptors(){return [
    {name:'enabled',defaultValue:0,minValue:0,maxValue:1,automationRate:'k-rate'},
    {name:'threshold',defaultValue:-24,minValue:-60,maxValue:0,automationRate:'k-rate'},
    {name:'ratio',defaultValue:4,minValue:1,maxValue:20,automationRate:'k-rate'},
    {name:'knee',defaultValue:6,minValue:0,maxValue:24,automationRate:'k-rate'},
    {name:'attackMs',defaultValue:5,minValue:.1,maxValue:100,automationRate:'k-rate'},
    {name:'releaseMs',defaultValue:180,minValue:10,maxValue:2000,automationRate:'k-rate'},
    {name:'maxReductionDb',defaultValue:12,minValue:0,maxValue:30,automationRate:'k-rate'}];}
  constructor(){super();this.kernel=new SidechainKernel(sampleRate);this.closed=false;this.counter=0;this.values={};this.port.onmessage=e=>{if(e.data==='dispose')this.closed=true;};}
  process(inputs,outputs,params){if(this.closed)return false;const audio=inputs[0]||[],key=inputs[1]||[],out=outputs[0];if(!out?.length)return true;const p=this.values;for(const k in params)p[k]=params[k][0];for(let i=0;i<out[0].length;i++){let keyPeak=0;for(let ch=0;ch<key.length;ch++)keyPeak=Math.max(keyPeak,Math.abs(key[ch][i]||0));const g=this.kernel.next(keyPeak,p);for(let ch=0;ch<out.length;ch++){const v=audio[ch]?.[i]??audio[0]?.[i]??0;out[ch][i]=Number.isFinite(v)?v*g:0;}}this.counter+=out[0].length;if(this.counter>=4096){this.counter=0;this.port.postMessage({reduction:this.kernel.reductionDb});}return true;}
}
class GrimCharacter extends AudioWorkletProcessor{
  static get parameterDescriptors(){return [
    {name:'enabled',defaultValue:0,minValue:0,maxValue:1,automationRate:'k-rate'},
    {name:'darkness',defaultValue:.35,minValue:0,maxValue:1,automationRate:'k-rate'},
    {name:'weight',defaultValue:.3,minValue:0,maxValue:1,automationRate:'k-rate'},
    {name:'bite',defaultValue:.25,minValue:0,maxValue:1,automationRate:'k-rate'},
    {name:'clarity',defaultValue:.55,minValue:0,maxValue:1,automationRate:'k-rate'},
    {name:'glitch',defaultValue:0,minValue:0,maxValue:1,automationRate:'k-rate'},
    {name:'bpm',defaultValue:150,minValue:30,maxValue:300,automationRate:'k-rate'}];}
  constructor(){super();this.kernel=new GrimKernel(sampleRate);this.closed=false;this.values={};this.port.onmessage=e=>{if(e.data==='dispose')this.closed=true;};}
  process(inputs,outputs,params){if(this.closed)return false;const x=inputs[0]||[],y=outputs[0];if(!y?.length)return true;const p=this.values;for(const k in params)p[k]=params[k][0];const enabled=p.enabled>=.5;for(let i=0;i<y[0].length;i++){const l=x[0]?.[i]||0,r=x[1]?.[i]??l;if(enabled){const pair=this.kernel.processFrame(l,r,p);y[0][i]=pair[0];if(y[1])y[1][i]=pair[1];}else{y[0][i]=l;if(y[1])y[1][i]=r;this.kernel.frame++;}}return true;}
}
registerProcessor('iv-mixer-dynamics-v1',MixerDynamics);
registerProcessor('iv-sidechain-v1',SidechainDucker);
registerProcessor('iv-grim-v1',GrimCharacter);

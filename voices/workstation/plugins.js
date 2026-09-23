import {SOUND_DEFAULTS,validateSettings,PRESETS} from './model.js';
export const CATALOG=[
  {apiVersion:1,id:'iv.clear-lead',name:'Clear Lead',author:'Infected Voices',version:'1.0.0',kind:'preset',description:'Dry, articulate lead vocal starting point.',settings:{...PRESETS['Clean rap'],echo:.04,reverb:.04,presence:2.5}},
  {apiVersion:1,id:'iv.ghost-double',name:'Ghost Double',author:'Infected Voices',version:'1.0.0',kind:'preset',description:'Softly lowered double with space. Blend beneath the main vocal.',settings:{...SOUND_DEFAULTS,shift:-2,gain:-6,reverb:.22,echo:.12,tune:.3}},
  {apiVersion:1,id:'iv.abyss',name:'Abyss Character',author:'Infected Voices',version:'1.0.0',kind:'preset',description:'Heavy dark voice character; audition for intelligibility.',settings:{...PRESETS['Grim abyss']}},
  {apiVersion:1,id:'iv.dry-delivery',name:'Dry Delivery',author:'Infected Voices',version:'1.0.0',kind:'preset',description:'No pitch shift or ambience; moderate tone and dynamics only.',settings:{...SOUND_DEFAULTS,tune:0,shift:0,sub:0,echo:0,reverb:0}}
];
export function validatePlugin(p){
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['apiVersion','id','name','author','version','kind','description','settings'].includes(k)))throw Error('Unsupported plugin fields. This API accepts preset data, not executable code.');
  if(p.apiVersion!==1||p.kind!=='preset'||!/^[-a-z0-9.]{3,80}$/.test(p.id)||!/^\d+\.\d+\.\d+$/.test(p.version))throw Error('Invalid plugin API version, ID or semantic version.');
  for(const k of ['name','author','description'])if(typeof p[k]!=='string'||!p[k].trim()||p[k].length>(k==='description'?600:100))throw Error('Invalid plugin '+k+'.');
  if(!p.settings||Object.keys(p.settings).some(k=>!Object.hasOwn(SOUND_DEFAULTS,k)))throw Error('Plugin contains unknown sound controls.');
  validateSettings({...SOUND_DEFAULTS,...p.settings});
  return {...p,settings:{...SOUND_DEFAULTS,...p.settings}};
}
export async function readPlugin(file){if(file.size>65536)throw Error('Plugin preset exceeds 64 KB.');return validatePlugin(JSON.parse(await file.text()));}
export const SDK_GUIDE=`# Infected Voices Plugin API 1\n\nImplemented: declarative preset packages (.ivplugin JSON). Not implemented: native binary hosting, arbitrary JavaScript or WASM modules, third-party payment settlement.\n\nEvery package requires apiVersion: 1, kind: preset, a lowercase unique id, name, author, semantic version, description and settings. Only supported, finite sound controls are accepted. No network, filesystem, auth-token or shell permissions exist.\n\nInstall is explicit. Applying a package copies its validated settings to the selected vocal track and records an undo checkpoint. Removing a package does not modify already-applied track settings. Packages are scoped to the local signed-in account.\n\nExample:\n\n${JSON.stringify(CATALOG[0],null,2)}\n\nUse the info buttons in Studio for setting units/ranges. Test with quiet and full-scale mono vocals, silence, multiple sample rates and wrong-type values. Do not claim an API connection or cloud capability in a preset package.\n`;

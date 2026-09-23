export async function mountNativeChrome(){
 const shell=window.ivShell,config=await shell.config();
 const top=document.querySelector('.account-actions')||document.body;
 const hostButton=document.createElement('button');hostButton.id='nativeHostSettings';hostButton.textContent='Host & updates';top.prepend(hostButton);
 const modal=document.createElement('dialog');modal.className='detail-dialog';modal.id='nativeUpdateDialog';document.body.append(modal);
 let active=false,target=null;
 function element(tag,text){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;}
 function button(text,fn){const b=element('button',text);b.type='button';b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){status.textContent=e.message;}finally{b.disabled=false;}};return b;}
 const heading=element('h2'),body=element('div'),status=element('p');status.id='nativeStatus';status.setAttribute('role','status');
 const close=button('Close',()=>{if(active)throw Error('Cancel or finish the download first.');modal.close();});modal.append(heading,body,status,close);
 modal.addEventListener('cancel',e=>{if(active)e.preventDefault();});
 function open(title){heading.textContent=title;body.replaceChildren();status.textContent='';if(!modal.open)modal.showModal();}
 const safe=()=>{const s=window.ivGetSessionState?.();if(s&&(s.recording||s.starting||s.finalizing||s.playing||s.busy||s.pendingWrites))throw Error('Stop recording/playback and finish saving/exporting first.');};
 const checkpoint=async()=>{safe();if(window.ivPrepareNativeUpdate)await window.ivPrepareNativeUpdate();window.ivShell.setSessionState(window.ivGetSessionState?.()||{dirty:false});};
 async function updates(){
  open('Windows application updates');body.append(element('p','Installed Windows '+config.nativeVersion+' · local Core 2 studio. Website refreshes do not replace this application.'));
  body.append(element('p',config.updatesConfigured?'Feed: '+config.updateBase:'No native publisher feed is configured yet. Use Host & updates to connect your own HTTPS folder and public signing key.'));
  body.append(button('Check for native update',async()=>{status.textContent='Checking signed publisher metadata…';target=await shell.checkUpdates();status.textContent='Verified publisher metadata for '+target.version+' — '+target.notes;}));
  body.append(button('Download verified update',async()=>{await checkpoint();if(!target)throw Error('Check and review the update first.');if(!confirm('Download '+target.version+' from the configured signed feed?'))return;active=true;try{target=await shell.downloadUpdate();status.textContent='Installer downloaded and checksum verified. Not installed yet.';}finally{active=false;}}));
  body.append(button('Install downloaded update',async()=>{await checkpoint();if(!target?.ready)throw Error('Download and verify the installer first.');await shell.installUpdate();}));
  body.append(button('Cancel download',()=>shell.cancelUpdate()));
 }
 async function settings(){
  safe();open('Account server & update hosting');
  body.append(element('p','Keep the current production server until migration is verified. Changing server origin uses a separate local account/storage partition; export portable projects before switching.'));
  const fields={};
  for(const [key,label,value] of [['serverOrigin','Account server HTTPS origin',config.serverOrigin],['updateBase','Update folder HTTPS URL, ending /',config.updateBase],['updateKey','Trusted Ed25519 public key (base64)',config.updateKey]]){const l=element('label',label);l.className='field';const input=element('input');input.value=value;input.setAttribute('aria-label',label);l.append(input);body.append(l);fields[key]=input;}
  const l=element('label','Backend protocol'),select=element('select');select.setAttribute('aria-label','Backend protocol');for(const [v,t]of [['device-v1','Existing accounts / migrated device API'],['collab-v1','Separate legacy collaboration pilot']]){const o=element('option',t);o.value=v;select.append(o);}select.value=config.protocol;l.append(select);body.append(l);
  body.append(element('p','A public update key is not a password. Verify it independently with the publisher. Never paste root, SSH, Stripe or private signing credentials here.'));
  const values=()=>({serverOrigin:fields.serverOrigin.value.trim(),protocol:select.value,updateBase:fields.updateBase.value.trim(),updateKey:fields.updateKey.value.trim()});
  body.append(button('Check account server',async()=>{status.textContent=(await shell.hostCheck(values())).message;}));
  body.append(button('Save settings & restart',async()=>{await checkpoint();await shell.configure(values());}));
 }
 hostButton.onclick=()=>settings().catch(e=>{open('Host settings');status.textContent=e.message;});
 shell.onUpdateProgress(p=>{status.textContent='Downloading '+Math.floor(p.received/p.total*100)+'% · verified installation has not started.';});
 shell.onMenu(name=>{if(name==='native-updates')updates();if(name==='native-settings')settings().catch(e=>{status.textContent=e.message;});});
 const attach=()=>{const b=document.getElementById('studioUpdates');if(b)b.onclick=updates;};
 // Core 2 creates this button after mounting; mutation observation only binds that control.
 const observer=new MutationObserver(attach);observer.observe(document.body,{childList:true,subtree:true});attach();
 window.ivOpenNativeUpdates=updates;
 return {updates,settings};
}

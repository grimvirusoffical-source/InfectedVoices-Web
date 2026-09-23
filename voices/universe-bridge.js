import {request,acceptNativeSession,report} from './api.js';
// Parent messages are accepted only from the explicitly configured Universe origin.
export async function embeddedSignIn() {
  if (window.parent === window) return false;
  const health = await request('/api/health');
  const allowed = health.universeFrameOrigin;
  if (!allowed) return false;
  const verifier = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
  const challenge = btoa(String.fromCharCode(...hash)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  return new Promise(resolve => {
    let used = false;
    const cleanup = () => {clearTimeout(timeout);window.removeEventListener('message',receive);};
    const receive = async event => {
      if (used || event.source !== window.parent || event.origin !== allowed || event.data?.type !== 'iv.studio.ticket' || typeof event.data.ticket !== 'string') return;
      used = true;cleanup();
      try {acceptNativeSession(await request('/api/auth/universe',{ticket:event.data.ticket,verifier,embedded:true}));resolve(true);}
      catch(error){report(error);resolve(false);}
    };
    const timeout=setTimeout(()=>{cleanup();resolve(false);},15000);
    window.addEventListener('message',receive);
    window.parent.postMessage({type:'iv.studio.ready',challenge},allowed);
  });
}

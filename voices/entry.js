import {api, auth, session, request, report, handleNativeLink, acceptNativeSession} from './api.js';
import {mount} from './workstation/app.js';
import {CollaborationUI, invitationGate} from './collaboration.js';
import {embeddedSignIn} from './universe-bridge.js';

if(window.ivNative){window.ivNative.onLink(link=>handleNativeLink(link).catch(report));const initial=await window.ivNative.initialLink();if(initial)await handleNativeLink(initial);}
await embeddedSignIn();
await invitationGate();
// Signed Universe launch tickets must carry a client-generated PKCE verifier.
const params = new URLSearchParams(location.hash.slice(1));
if (params.has('universeTicket')) {
  const ticket = params.get('universeTicket'), verifier = sessionStorage.getItem('iv-universe-verifier');
  history.replaceState(null, '', location.pathname);
  try {acceptNativeSession(await request('/api/auth/universe', {ticket, verifier})); sessionStorage.removeItem('iv-universe-verifier');}
  catch (e) {report(e);}
}
const bridge = await mount({api, auth, openExternal: url => window.ivNative?window.ivNative.openExternal(url):window.open(url, '_blank', 'noopener,noreferrer'), isDesktop: !!window.ivDesktop});
window.ivPrepareNativeUpdate=()=>bridge.checkpointForNativeUpdate();
const s = await session();
if (s.user) {
  const collab = new CollaborationUI(bridge, s.user);
  // The onboarding dialog is intentional: complete it before opening a room.
  const init = () => collab.init().catch(report);
  const guide = document.getElementById('guideDialog');
  if (guide.open) guide.addEventListener('close', init, {once: true}); else await init();
}

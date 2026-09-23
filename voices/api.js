const NATION_ORIGIN=(typeof window!=='undefined'&&window.__INFECTEDNATION_URL)||'https://nation.infectedvoices.space';
const APP_ID='infected-voices';
const TOKEN_KEY='infectednation_session';
let me={user:null},csrf='';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const randomHex=bytes=>{
  const value=crypto.getRandomValues(new Uint8Array(bytes));
  return [...value].map(v=>v.toString(16).padStart(2,'0')).join('');
};
async function jsonFetch(url,options={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch(url,{...options,signal:options.signal||controller.signal});
    const text=await response.text();
    let data={};
    try{data=text?JSON.parse(text):{};}catch{throw Error('The server returned an unreadable response.');}
    if(!response.ok){
      const error=Error(String(data.error||'Request failed.').slice(0,600));
      error.status=response.status;error.code=data.code;throw error;
    }
    return data;
  }finally{clearTimeout(timer);}
}
async function nationPost(path,data){
  return jsonFetch(path,{
    method:'POST',
    headers:{'Content-Type':'application/json','Accept':'application/json'},
    body:JSON.stringify(data||{}),
    credentials:'same-origin',
    redirect:'error'
  });
}
function token(){return localStorage.getItem(TOKEN_KEY)||'';}
function setToken(value){if(value)localStorage.setItem(TOKEN_KEY,value);else localStorage.removeItem(TOKEN_KEY);}
async function connectNation(options={}){
  const flow=options.flow==='signup'?'signup':'login';
  const method=['apple','google','android','email'].includes(options.method)?options.method:'email';
  const secret=randomHex(32);
  const request=await nationPost('/api/auth/connect/start',{appId:APP_ID,secret});
  if(typeof request.id!=='string'||!Number.isFinite(request.expires))throw Error('InfectedNation returned an invalid connection request.');
  const url=NATION_ORIGIN+'/?connect='+encodeURIComponent(request.id)+'&app='+encodeURIComponent(APP_ID)+'&flow='+encodeURIComponent(flow)+'&method='+encodeURIComponent(method);
  const popup=window.open(url,'infectednation-login','popup,width=560,height=780');
  if(!popup){const error=Error('Allow popups for infectedvoices.space, then try again.');error.code='popup_blocked';throw error;}
  while(Date.now()<request.expires){
    await sleep(1400);
    const result=await nationPost('/api/auth/connect/session',{id:request.id,secret});
    if(result.pending)continue;
    if(!result.token||!result.account)throw Error('InfectedNation returned an incomplete session.');
    setToken(result.token);
    try{popup.close();}catch{}
    return result.account;
  }
  try{popup.close();}catch{}
  throw Error('InfectedNation sign-in expired. Start again.');
}
export const endpoint=path=>path;
export async function request(path,body,options={}){
  const method=options.method||(body===undefined?'GET':'POST');
  const headers={'Accept':'application/json',...options.headers};
  const current=token();
  if(current)headers.Authorization='Bearer '+current;
  if(body!==undefined&&!options.binary)headers['Content-Type']='application/json';
  const response=await fetch(path,{
    method,
    credentials:'same-origin',
    headers,
    body:body===undefined?undefined:options.binary?body:JSON.stringify(body),
    signal:options.signal||AbortSignal.timeout(options.binary?120000:20000)
  });
  if(options.bytes&&response.ok)return response.arrayBuffer();
  let data;
  try{data=await response.json();}catch{throw Error('The RedXAIHost Studio service returned an unreadable response.');}
  if(!response.ok){const error=Error(data.error||'Request failed.');error.status=response.status;error.code=data.code;throw error;}
  return data;
}
export function acceptNativeSession(){}
export async function session(){me=await request('/api/me');csrf=me.csrf||'';return me;}
export const api={
  async get(path){return {data:await request(path)};},
  async post(path,body){return {data:await request(path,body)};},
  async put(path,body){return {data:await request(path,body,{method:'PUT'})};},
  async delete(path){return {data:await request(path,{}, {method:'DELETE'})};}
};
export const auth={
  async getUser(){const s=await session();return s.user?{...s.user,userId:s.user.id}:null;},
  isSignedIn:()=>!!me.user,
  async signIn(options={}){const requested=options?.method?options:JSON.parse(sessionStorage.getItem('iv-auth-request')||'{}');sessionStorage.removeItem('iv-auth-request');await connectNation(requested);const s=await session();return {user:s.user};},
  async emailLogin(opts){return emailLogin(opts);},
  async emailSignup(fields){return emailSignup(fields);},
  async signOut(){
    const current=token();
    try{if(current)await request('/api/logout',{});}finally{setToken('');me={user:null};csrf='';}
  }
};
export const isDesktop=false;
export const openExternal=url=>{
  const value=new URL(url,location.href);
  if(!['https:','http:'].includes(value.protocol))throw Error('Unsupported external destination.');
  window.open(value.href,'_blank','noopener,noreferrer');
};
export const op=()=>crypto.randomUUID();
export function node(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;}
export function action(text,fn,className){
  const n=node('button',text,className);n.type='button';
  n.onclick=async()=>{n.disabled=true;try{await fn();}catch(e){report(e);}finally{n.disabled=false;}};
  return n;
}
export function report(e){
  const box=document.getElementById('collabAlert')||node('div');
  box.id='collabAlert';box.className='collab-alert';box.setAttribute('role','alert');box.textContent=e.message||String(e);
  if(!box.isConnected)document.body.append(box);
  clearTimeout(box.dismiss);box.dismiss=setTimeout(()=>box.remove(),15000);
}
export async function handleNativeLink(){}
export class StudioEvents extends EventTarget{
  constructor(path){super();this.path=path;this.closed=false;this.retry=0;this.pump();}
  async pump(){
    if(this.closed)return;this.abort=new AbortController();
    try{
      const headers={Accept:'text/event-stream'};if(token())headers.Authorization='Bearer '+token();
      const response=await fetch(this.path,{credentials:'same-origin',headers,signal:this.abort.signal});
      if(!response.ok)throw Error('Live connection not authorized.');
      const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';this.retry=0;
      while(!this.closed){
        const {value,done}=await reader.read();if(done)break;
        buffer+=decoder.decode(value,{stream:true});if(buffer.length>2097152)throw Error('Live event exceeds safe size.');
        let at;while((at=buffer.indexOf('\n\n'))!==-1){
          const part=buffer.slice(0,at);buffer=buffer.slice(at+2);
          const lines=part.split('\n'),type=lines.find(v=>v.startsWith('event: '))?.slice(7),data=lines.find(v=>v.startsWith('data: '))?.slice(6);
          if(type&&data)this.dispatchEvent(new MessageEvent(type,{data}));
        }
      }
    }catch{}
    if(!this.closed){this.dispatchEvent(new Event('error'));this.timer=setTimeout(()=>this.pump(),Math.min(15000,1000*2**this.retry++));}
  }
  close(){this.closed=true;clearTimeout(this.timer);this.abort?.abort();}
}

export async function emailLogin({login,password,totpCode}){
  const body={appId:APP_ID,email:login,username:login,login,password};
  if(totpCode)body.totpCode=totpCode;
  const data=await nationPost('/api/auth/login/email',body);
  if(!data.token)throw Error(data.error||'Login failed');
  setToken(data.token);return data.account||data;
}
export async function emailSignup(fields){
  const data=await nationPost('/api/auth/signup/email',{...fields,appId:APP_ID});
  if(!data.token)throw Error(data.error||'Signup failed');
  setToken(data.token);return data.account||data;
}
export async function setupTotp(){return nationPost('/api/auth/2fa/totp/setup',{token:token()});}
export async function enableTotp(code){return nationPost('/api/auth/2fa/totp/enable',{token:token(),code});}
export async function disableTotp(password){return nationPost('/api/auth/2fa/totp/disable',{token:token(),password});}
export async function setPhone2fa(phone){return nationPost('/api/auth/2fa/phone/set',{token:token(),phone});}

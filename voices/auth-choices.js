function button(label,flow,method,target){
  const b=document.createElement('button');
  b.type='button';b.textContent=label;
  if(method==='apple')b.className='apple-auth';
  b.onclick=()=>{
    sessionStorage.setItem('iv-auth-request',JSON.stringify({flow,method}));
    target.click();
  };
  return b;
}
function keepHidden(target){
  const hide=()=>{if(!target.hidden)target.hidden=true;};
  hide();
  new MutationObserver(hide).observe(target,{attributes:true,attributeFilter:['hidden']});
}
function ensureStyle(){
  if(document.getElementById('iv-auth-choices-style'))return;
  const style=document.createElement('style');
  style.id='iv-auth-choices-style';
  style.textContent='.infected-auth-choices{display:grid;gap:10px;margin:14px 0 18px}.infected-auth-choices h3{margin:8px 0 0;font-size:14px}.infected-auth-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.infected-auth-grid button{width:100%;min-height:44px;font-size:16px}.infected-auth-grid .apple-auth{background:#fff;color:#111}@media(max-width:520px){.infected-auth-grid{grid-template-columns:1fr}}';
  document.head.append(style);
}
function mount(target,host){
  if(!target||!host||host.querySelector('.infected-auth-choices'))return;
  ensureStyle();
  keepHidden(target);
  const wrap=document.createElement('section');wrap.className='infected-auth-choices';
  const createTitle=document.createElement('h3');createTitle.textContent='Create an InfectedNation account';
  const create=document.createElement('div');create.className='infected-auth-grid';
  for(const [method,label] of [['apple','Apple signup'],['google','Google signup'],['android','Android / passkey signup'],['email','Email signup']])create.append(button(label,'signup',method,target));
  const loginTitle=document.createElement('h3');loginTitle.textContent='Already have an account?';
  const login=document.createElement('div');login.className='infected-auth-grid';
  for(const [method,label] of [['apple','Apple login'],['google','Google login'],['android','Android / passkey login'],['email','Email login']])login.append(button(label,'login',method,target));
  wrap.append(createTitle,create,loginTitle,login);
  host.insertBefore(wrap,target);
}
function run(){
  const signIn=document.getElementById('signIn');
  if(signIn)mount(signIn,signIn.parentElement);
  const hero=document.getElementById('labSignInHero');
  if(hero)mount(hero,hero.parentElement);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run,{once:true});else run();

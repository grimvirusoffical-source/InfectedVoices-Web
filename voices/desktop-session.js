let user=null;
export const isDesktop=true;
export const openExternal=url=>window.ivShell.openExternal(url);
window.ivShell.onAuthStatus(text=>window.dispatchEvent(new CustomEvent('iv-auth-status',{detail:text})));
export const auth={
 getUser:async()=>{const v=await window.ivShell.user();user=v?{...v,userId:v.userId||v.id}:null;return user;},
 isSignedIn:()=>!!user,
 signIn:async()=>{const v=await window.ivShell.signIn();user={...v.user,userId:v.user.userId||v.user.id};return {user};},
 signOut:async()=>{try{const result=await window.ivShell.signOut();if(!result.remote)window.dispatchEvent(new CustomEvent('iv-auth-status',{detail:result.message}));}finally{user=null;}}
};
export const api=Object.fromEntries(['get','post','put','delete'].map(m=>[m,async(path,data)=>({data:await window.ivShell.request(m.toUpperCase(),path,data)})]));

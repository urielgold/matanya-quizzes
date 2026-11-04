/* ---------- boot ---------- */
async function boot(){
  const params=new URLSearchParams(location.search);
  const qpin=(params.get('pin')||'').replace(/\D/g,'').slice(0,6);
  // Recovery link from "forgot password" e-mail
  if(location.hash.includes('type=recovery')) pwRecovery=true;
  api.onAuth(u=>{
    const was=user&&user.id;user=u;
    if(authReady&&(u&&u.id)!==was){loadAccount().then(()=>{if(['home','quiz','edit','setup'].includes(view.name))render()})}
  });
  try{user=await api.currentUser()}catch(e){user=null}
  authReady=true;
  api.authProviders().then(p=>{providers=p;if(view.name==='home'&&!user)render()});
  if(qpin.length===6){
    history.replaceState(null,'',location.pathname);
    go({name:'join',pin:qpin});
  } else {
    // Back to a game this phone was already playing (e.g. after the browser reloaded the tab)
    const last=lastGame();
    if(last&&!touched){go({name:'join',pin:last.pin,rejoin:true});tryRejoin(last)}
    else render();
  }
  loadAccount();
}
function rerenderSoft(){
  if(['home','setup','quiz'].includes(view.name)) render();
  else if(view.name==='edit'&&!findQ(view.id)) {if(cloudState==='ready')go({name:'home'})}
  else{const st=$('#cloudst');if(st) st.outerHTML=cloudBadge()}
}
function cloudBadge(){
  const m=!user?['לא מחובר','']:{connecting:['טוען את החשבון…',''],ready:['נשמר בחשבון שלך','on'],off:['אין חיבור לחשבון, נסו לרענן','']}[cloudState];
  return `<span class="status ${m[1]}" id="cloudst"><i></i>${m[0]}</span>`;
}

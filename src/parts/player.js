/* ---------- player (phone) ---------- */
let PL=null;
const LGK='matanya.lastgame.v1';
function lastGame(){try{const v=JSON.parse(localStorage.getItem(LGK));if(v&&v.pin&&Date.now()-v.t<3*3600*1000)return v}catch(e){}return null}
function saveLastGame(){try{if(PL)localStorage.setItem(LGK,JSON.stringify({pin:PL.pin,nick:PL.nick,av:PL.av,t:Date.now()}))}catch(e){}}
function clearLastGame(){try{localStorage.removeItem(LGK)}catch(e){}}
function joinV(){
  const err=view.err;
  if(view.rejoin) return `<div class="wrap" style="max-width:480px"><div class="top">${brandHTML('הצטרפות למשחק')}</div><div class="panel"><div class="empty">חוזרים למשחק…</div></div></div>`;
  return `<div class="wrap" style="max-width:480px">
    <div class="top">${brandHTML('הצטרפות למשחק')}</div>
    <div class="panel">
      <form id="jform" style="display:flex;flex-direction:column;gap:14px">
        <label class="field"><span class="label">קוד המשחק</span><input class="in pin-in" id="jpin" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" placeholder="000000" value="${esc(view.pin||'')}"></label>
        <label class="field"><span class="label">השם שלכם במשחק</span><input class="in" id="jnick" maxlength="20" autocomplete="off" enterkeyhint="go" placeholder="למשל: נועה" value="${esc(S.nick)}"></label>
        ${err?`<div class="warn">${esc(err)}</div>`:''}
        <button class="btn primary big" type="submit" ${view.busy?'disabled':''}>${view.busy?'מתחברים…':'כניסה למשחק'}</button>
      </form>
    </div>
    ${user?'':`<button class="btn ghost" data-act="home">למנחים: כניסה ויצירת חידונים</button>`}
  </div>`;
}
function joinErr(e){
  const m=String(e&&e.message||'');
  if(/no_game/.test(m)) return 'לא מצאנו משחק עם הקוד הזה. בדקו את הקוד שעל המסך של המנחה.';
  if(/kicked/.test(m)) return 'המנחה הוציא אותך מהמשחק הזה.';
  if(/game_full/.test(m)) return 'המשחק מלא.';
  if(/name_required/.test(m)) return 'כתבו שם כדי שיראו אתכם על המסך.';
  return 'לא הצלחנו להתחבר. בדקו את האינטרנט ונסו שוב.';
}
async function joinGame(pin,nick,av){
  S.nick=nick;saveLocal();
  if(av==null) av=Number.isInteger(S.avIdx)?S.avIdx%AVS.length:Math.floor(Math.random()*AVS.length);
  view={name:'join',pin,busy:true};render();
  let res;
  try{res=await api.joinGame(pin,nick,av)}
  catch(e){clearLastGame();view={name:'join',pin,err:joinErr(e)};render();return}
  leavePlayer(true);
  PL={pin,nick,av,avOpen:false,state:res.state||{},status:res.status,picked:{},sending:{},sendErr:{},seen:{},conn:true,hostHere:true,hostSeenAt:Date.now(),ch:null,poll:0,clock:0,gone:false};
  try{PL.picked=JSON.parse(sessionStorage.getItem('matanya.picked.'+pin))||{}}catch(e){}
  saveLastGame();
  view={name:'player'};
  PL.ch=api.playerChannel(pin,{
    onGame:row=>applyGame(row),
    onGone:()=>{if(PL){PL.gone=true;renderPlayer(true)}},
    onPresence:st=>{if(!PL) return;const h=!!(st&&st.host&&st.host.length);if(h)PL.hostSeenAt=Date.now();if(h!==PL.hostHere){PL.hostHere=h;renderPlayer(true)}},
    onStatus:s=>{if(!PL) return;const ok=s==='SUBSCRIBED';if(ok)refetchGame();if(ok!==PL.conn){PL.conn=ok;connBar()}},
  });
  // Safety net: re-read the game every few seconds, and right away when the phone wakes up.
  PL.poll=setInterval(()=>{if(PL&&document.visibilityState==='visible')refetchGame()},PL.conn?5000:2500);
  PL.clock=setInterval(playerClock,250);
  renderPlayer(true);
  checkMyAnswer();
}
async function tryRejoin(last){
  if(!last) return;
  await joinGame(last.pin,last.nick,last.av);
  if(view.name==='join'&&view.err) {view.rejoin=false;render()}
}
async function refetchGame(){
  if(!PL) return;
  try{const g=await api.getGame(PL.pin);if(!PL) return;if(!g){PL.gone=true;renderPlayer(true);return}applyGame(g)}catch(e){}
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&PL)refetchGame()});
window.addEventListener('online',()=>{if(PL)refetchGame()});
function applyGame(row){
  if(!PL||!row) return;
  const st=row.state||{},old=PL.state||{};
  PL.status=row.status;
  if(st.phase==='question'&&!PL.seen[st.r]) PL.seen[st.r]=Date.now()-(st.time*1000-(st.rem||st.time*1000));
  const same=JSON.stringify(st)===JSON.stringify(old);
  PL.state=st;
  if(st.gid&&old.gid&&st.gid!==old.gid){PL.picked={};PL.seen={}}
  if(!same){renderPlayer(true);if(st.phase==='question')checkMyAnswer()}
}
async function checkMyAnswer(){
  const st=PL&&PL.state;if(!st||st.phase!=='question'||PL.picked[st.r]!==undefined) return;
  const j=await api.myAnswer(PL.pin,st.r);
  if(PL&&j!=null&&PL.picked[st.r]===undefined){PL.picked[st.r]=j;renderPlayer(true)}
}
function leavePlayer(keep){
  if(!PL) return;
  clearInterval(PL.poll);clearInterval(PL.clock);
  if(PL.ch) PL.ch.unsub();
  if(!keep){api.leaveGame(PL.pin);clearLastGame()}
  PL=null;
}
function savePicked(){try{sessionStorage.setItem('matanya.picked.'+PL.pin,JSON.stringify(PL.picked))}catch(e){}}
async function pickAnswer(j){
  if(!PL) return;
  const st=PL.state;
  if(st.phase!=='question'||st.paused||PL.picked[st.r]!==undefined) return;
  const r=st.r;
  PL.picked[r]=j;PL.sending[r]=true;PL.sendErr[r]='';savePicked();renderPlayer(true);
  try{
    const out=await api.submitAnswer(PL.pin,r,j);
    if(!PL) return;
    PL.sending[r]=false;
    if(out==='closed'||out==='late'){PL.sendErr[r]='late'}
    else if(out==='kicked'){PL.state=Object.assign({},PL.state,{kicked:[playerId()]})}
    else if(out==='not_joined'){await api.joinGame(PL.pin,PL.nick,PL.av).catch(()=>{});const again=await api.submitAnswer(PL.pin,r,j).catch(()=>'err');if(again!=='ok'&&again!=='dup')PL.sendErr[r]='err'}
  }catch(e){if(!PL) return;PL.sending[r]=false;PL.sendErr[r]='err';delete PL.picked[r];savePicked()}
  renderPlayer(true);
}
function playerId(){return api.playerIdentity().pid}
function connBar(){
  const el=$('#pconn');if(!el||!PL) return;
  el.hidden=PL.conn;
}
function playerClock(){
  if(!PL) return;
  const st=PL.state;
  if(st.phase==='question'){
    const el=$('#psec');
    if(el){const sec=st.paused?Math.ceil((st.rem||0)/1000):Math.max(0,Math.ceil(((PL.seen[st.r]||Date.now())+st.time*1000-Date.now())/1000));el.textContent=sec}
  }
  // Host screen gone quiet for a while → tell the player (the game itself is kept).
  const quiet=!PL.hostHere&&Date.now()-PL.hostSeenAt>8000;
  const hb=$('#phost');if(hb) hb.hidden=!quiet||!PL.conn;
}
function renderPlayer(force){
  if(!PL||view.name!=='player') return;
  const P=PL.state||{},me=playerId();
  const myName=(P.names&&P.names[me])||PL.nick;
  const top=`<div class="me-bar"><span style="display:flex;align-items:center;gap:8px">${avHTML(PL.av,'sm')}${esc(myName)}</span><span class="muted" dir="ltr">${PL.pin}</span><button class="btn sm ghost" data-act="pleave">יציאה</button></div>
    <div class="pconn" id="pconn" ${PL.conn?'hidden':''}>החיבור נפל — מתחבר מחדש…</div>
    <div class="pconn soft" id="phost" hidden>המסך של המנחה לא מחובר כרגע. המשחק ימשיך כשהוא יחזור.</div>`;
  let h='';
  const mine=P.res&&P.res[me]?P.res[me]:null;
  if(Array.isArray(P.kicked)&&P.kicked.includes(me)){
    clearLastGame();
    h=`<div class="center"><div class="big-n">👋</div><h2 style="font-size:28px">המנחה הוציא אותך מהמשחק</h2><button class="btn primary" data-act="pleave">חזרה</button></div>`;
  } else if(PL.gone||PL.status==='ended'){
    clearLastGame();
    h=`<div class="center"><div class="big-n">🏁</div><h2 style="font-size:28px">המשחק הסתיים</h2><p class="muted">תודה ששיחקת!</p><button class="btn primary" data-act="pleave">יציאה</button></div>`;
  } else if(!P.phase||P.phase==='lobby'){
    h=`<div class="center">${avHTML(PL.av,'big')}<h2 style="font-size:32px">${esc(myName)}</h2><p class="muted" style="margin:0">נכנסת! רואים אותך על המסך. מחכים שהמנחה יתחיל.</p>${P.title?`<p style="margin:0;font-weight:700">${esc(P.title)}</p>`:''}
      <button class="btn" data-act="avopen">${PL.avOpen?'סגירה':'החלפת דמות'}</button>
      ${PL.avOpen?`<div class="avgrid">${AVS.map((e,i)=>`<button class="avbtn ${i===PL.av?'on':''}" data-act="avpick" data-i="${i}" aria-label="דמות ${i+1}">${avHTML(i,'big3')}</button>`).join('')}</div>`:''}</div>`;
  } else if(P.phase==='intro'){
    h=`<div class="center"><div class="label">שאלה ${(P.i||0)+1} מתוך ${P.n}</div><div class="intro-n">${(P.i||0)+1}</div><div class="qmini">${esc(P.q)}</div><p class="muted">התכוננו…</p></div>`;
  } else if(P.phase==='question'){
    const picked=PL.picked[P.r];
    if(picked!==undefined){
      const err=PL.sendErr[P.r],sending=PL.sending[P.r];
      h=`<div class="center"><div class="result none" style="width:100%"><span class="tile c${picked}" style="width:72px;height:72px;min-height:0;padding:0;justify-content:center;box-shadow:none"><span class="L" style="background:none">${P.tf?(picked===0?'✓':'✗'):LET[picked]}</span></span><h2>${sending?'שולחים…':err==='late'?'הזמן נגמר':'התשובה נקלטה'}</h2><p class="muted" style="margin:0">${esc(cut((P.a||[])[picked],60))}</p></div><p class="muted">מחכים לשאר המשתתפים · <span id="psec"></span> שניות</p></div>`;
    } else {
      const err=PL.sendErr[P.r]==='err';
      h=`<div class="sbar"><span class="pill">שאלה ${(P.i||0)+1}/${P.n}</span><span class="pill"><span id="psec"></span> שנ׳</span></div>
      <div class="qmini">${esc(P.q)}</div>
      ${err?'<div class="warn">התשובה לא נשלחה. בדקו את האינטרנט ולחצו שוב.</div>':''}
      ${P.paused?'<div class="note" style="text-align:center">המשחק מושהה</div>':''}
      <div class="tiles ${P.tf?'tf':''}">${(P.a||[]).map((a,j)=>a&&String(a).trim()?`<button class="tile c${j}" data-act="pans" data-j="${j}" ${P.paused?'disabled':''}><span class="L">${P.tf?(j===0?'✓':'✗'):LET[j]}</span><span class="t">${esc(a)}</span></button>`:'').join('')}</div>`;
    }
  } else if(P.phase==='reveal'){
    const choice=mine?mine[3]:-1;
    const ok=choice>=0&&Array.isArray(P.c)&&P.c.includes(choice);
    const right=(P.c||[]).map(j=>(P.a||[])[j]).filter(Boolean).map(a=>esc(a)).join(' / ');
    h=`<div class="center">
      <div class="rcircle ${choice<0?'none':ok?'ok':'no'}">${choice<0?'–':ok?'✓':'✕'}</div>
      <h2 style="font-size:34px">${choice<0?'לא ענית בזמן':ok?'נכון!':'לא הפעם'}</h2>
      ${mine&&ok?`<div class="big-n" style="font-size:44px" dir="ltr">+${fmt(mine[1])}</div>`:''}
      ${!ok?`<span>התשובה הנכונה: <b>${right}</b></span>`:''}
      ${mine?`<p style="margin:0;font-weight:700">${fmt(mine[0])} נקודות · מקום ${mine[2]} מתוך ${P.np}</p>`:''}
    </div>`;
  } else if(P.phase==='board'){
    h=`<div class="center">${mine?`<div class="label">המקום שלך</div><div class="intro-n">${mine[2]}</div><p style="margin:0;font-weight:700">${fmt(mine[0])} נקודות</p>`:''}
      <div class="board">${(P.top||[]).map((t,k)=>`<div class="brow ${k===0?'first':''}"><span class="r">${k+1}</span>${avHTML(t[2],'sm')}<span class="nm">${esc(t[0])}</span><span class="sc">${fmt(t[1])}</span></div>`).join('')}</div></div>`;
  } else if(P.phase==='final'){
    h=`<div class="center"><div class="label">סוף המשחק</div>
      ${mine?`<div class="intro-n">${mine[2]===1?'🏆':mine[2]}</div><h2 style="font-size:30px">${mine[2]===1?'ניצחת!':`מקום ${mine[2]}`}</h2><p style="margin:0;font-weight:700">${fmt(mine[0])} נקודות</p>`:''}
      <div class="board">${(P.top||[]).slice(0,3).map((t,k)=>`<div class="brow ${k===0?'first':''}"><span class="r">${k+1}</span>${avHTML(t[2],'sm')}<span class="nm">${esc(t[0])}</span><span class="sc">${fmt(t[1])}</span></div>`).join('')}</div>
      <p class="muted">אם המנחה יתחיל משחק חוזר, תצטרפו אליו כאן אוטומטית.</p></div>`;
  }
  app().innerHTML=`<div class="phone">${top}${h}</div>`;
  playerClock();
}

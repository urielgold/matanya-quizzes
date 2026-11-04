/* ---------- host game (one screen or live) ---------- */
let G=null;
function stopGame(end){
  if(!G) return;
  clearInterval(G.timer);clearTimeout(G.to);clearInterval(G.poll);
  if(G.ch){G.ch.unsub()}
  if(G.live&&end!==false) api.endGame(G.pin);
  G=null;musicStop();
}
function baseGame(z){
  return {quiz:z,qs:validQs(z),i:0,phase:'intro',players:[],ans:{},cur:0,timer:0,to:0,t0:0,paused:false,pauseAt:0,lastTick:-1,gid:uid(),seq:0,kicked:new Set(),names:{},present:null,conn:true,pubErr:false};
}
function startLocal(id){
  stopGame();
  const z=findQ(id);
  G=baseGame(z);
  const names=S.players.length?S.players:['אני'];
  G.players=names.map((n,k)=>({key:'p'+k,name:n,av:k%AVS.length,streak:0,score:0,prev:0,gain:0,choice:null,here:true}));
  view={name:'game'};
  phaseIntro();
}

/* ----- live game ----- */
function newPlayer(pid,name,av){return {key:pid,name:cut(name||'שחקן',24),av:+av||0,streak:0,score:0,prev:0,gain:0,choice:null,here:true}}
function mergePlayerRow(r){
  if(!G||!r||!r.pid||G.kicked.has(r.pid)) return false;
  let p=G.players.find(x=>x.key===r.pid);
  if(!p){p=newPlayer(r.pid,G.names[r.pid]||r.name,r.av);G.players.push(p);return true}
  let ch=false;
  if(!G.names[r.pid]&&r.name&&p.name!==r.name){p.name=cut(r.name,24);ch=true}
  if(r.av!=null&&p.av!==+r.av){p.av=+r.av;ch=true}
  if(p.left){p.left=false;ch=true}
  return ch;
}
function isHere(p){return !G.present||G.present.has(p.key)}
function activePlayers(){return G.players.filter(p=>!p.left)}
async function startLive(id,resume){
  stopGame();
  const z=findQ(id);
  G=baseGame(z);G.live=true;G.phase='lobby';
  view={name:'game'};
  app().innerHTML=`<div class="wrap"><div class="empty">פותחים משחק…</div></div>`;
  try{
    if(resume){
      G.pin=resume.pin;restoreFrom(resume.state);
    } else {
      const want=/^\d{6}$/.test(setupPin)?setupPin:(/^\d{6}$/.test(S.pin)?S.pin:null);
      setupPin='';if(S.pin){S.pin='';S.pinUsed=true;saveLocal()}
      G.pin=await api.createGame(z.id,{phase:'lobby',gid:G.gid,title:cut(z.title||'חידון',60),n:G.qs.length},want);
    }
  }catch(e){G=null;go({name:'quiz',id,err:'לא הצלחנו לפתוח משחק חי כרגע. בדקו את האינטרנט ונסו שוב.'});return}
  if(!G) return;
  try{localStorage.setItem('matanya.host.pin',G.pin)}catch(e){}
  G.ch=api.hostChannel(G.pin,{
    onPresence:st=>{if(!G) return;const keys=Object.keys(st||{});G.present=new Set(keys.filter(k=>k!=='host'));refreshHere()},
    onPlayers:p=>{if(!G) return;
      if(p.eventType==='DELETE'){const pid=p.old&&p.old.pid;const pl=G.players.find(x=>x.key===pid);if(pl){if(G.phase==='lobby')G.players=G.players.filter(x=>x!==pl);else pl.left=true;afterPlayersChange()}return}
      if(mergePlayerRow(p.new)) afterPlayersChange();
    },
    onAnswer:row=>takeAnswer(row),
    onStatus:s=>{if(!G) return;const ok=s==='SUBSCRIBED';if(ok&&!G.conn){syncPlayers();if(G.phase==='question')syncAnswers()}G.conn=ok||s==='CONNECTING';connBadge()},
  });
  // Safety net in case a realtime message is missed: re-read players/answers every few seconds.
  G.poll=setInterval(()=>{if(!G) return;if(G.phase==='lobby')syncPlayers();else if(G.phase==='question')syncAnswers()},3000);
  await syncPlayers();
  if(!G) return;
  if(resume&&['intro','question'].includes(resume.state.phase)){G.phase='lobby';G.i=resume.state.i||0;phaseIntro();return}
  if(resume&&resume.state.phase!=='lobby'){renderGame();publish();return}
  publish();renderGame();musicPlay('calm');
}
function restoreFrom(st){
  G.gid=st.gid||G.gid;G.seq=(st.seq||0)+1;G.i=Math.min(st.i||0,G.qs.length-1);
  (st.kicked||[]).forEach(k=>G.kicked.add(k));G.names=st.names||{};
  const sc=st.scores||{};
  Object.keys(sc).forEach(pid=>{const v=sc[pid];const p=newPlayer(pid,v[2],v[3]);p.score=+v[0]||0;p.streak=+v[1]||0;p.prev=p.score;G.players.push(p)});
  if(st.res) Object.keys(st.res).forEach(pid=>{const p=G.players.find(x=>x.key===pid);if(p){p.gain=st.res[pid][1]||0;p.choice=st.res[pid][3]>=0?st.res[pid][3]:null}});
  G.phase=st.phase||'lobby';
}
async function syncPlayers(){
  if(!G||!G.live) return;
  try{
    const rows=await api.fetchPlayers(G.pin);if(!G) return;
    let ch=false;rows.forEach(r=>{if(mergePlayerRow(r))ch=true});
    if(G.phase==='lobby'){const ids=new Set(rows.map(r=>r.pid));const before=G.players.length;G.players=G.players.filter(p=>ids.has(p.key));if(G.players.length!==before)ch=true}
    if(ch) afterPlayersChange();
  }catch(e){}
}
async function syncAnswers(){
  if(!G||!G.live||G.phase!=='question') return;
  const r=G.round;
  try{const rows=await api.fetchAnswers(G.pin,r);rows.forEach(takeAnswer)}catch(e){}
}
function takeAnswer(row){
  if(!G||!row||G.phase!=='question'||row.round!==G.round||G.kicked.has(row.pid)) return;
  if(row.pid in G.ans) return;
  if(!G.players.find(p=>p.key===row.pid)){syncPlayers()}
  G.ans[row.pid]={j:row.choice,t:row.elapsed_ms};
  beep(520,.05,'sine',.04);
  answeredChanged();
}
function answeredChanged(){
  const c=$('#acount');if(c) c.textContent=Object.keys(G.ans).length;
  const t=$('#atotal');if(t) t.textContent=activePlayers().filter(isHere).length;
  const present=activePlayers().filter(isHere);
  if(G.phase==='question'&&!G.paused&&present.length&&present.every(p=>p.key in G.ans)) phaseReveal();
}
function refreshHere(){
  let ch=false;G.players.forEach(p=>{const h=isHere(p);if(p.here!==h){p.here=h;ch=true}});
  if(ch) afterPlayersChange();
}
function afterPlayersChange(){
  G.players.forEach(p=>p.here=isHere(p));
  if(G.phase==='lobby'){updateLobby();publish();return}
  if(G.phase==='question') answeredChanged();
}
function connBadge(){
  const el=$('#hconn');if(!el||!G) return;
  const bad=!G.conn||G.pubErr;
  el.hidden=!bad;el.textContent=G.pubErr?'אין חיבור לשרת — מנסים שוב…':'החיבור לטלפונים התנתק — מתחבר מחדש…';
}

// Build the public game state the phones see. The correct answer is only included at reveal.
function buildState(){
  const q=G.qs[G.i],st={gid:G.gid,title:cut(G.quiz.title||'חידון',60),phase:G.phase,i:G.i,n:G.qs.length,seq:G.seq,
    kicked:[...G.kicked],names:G.names,scores:{}};
  G.players.forEach(p=>st.scores[p.key]=[p.score,p.streak||0,p.name,p.av]);
  if(['intro','question','reveal'].includes(G.phase)&&q){
    st.q=cut(q.q,300);st.a=q.answers.map(a=>cut(a,120));st.time=q.time;st.pts=q.points;st.r=G.round;st.tf=q.type==='tf';
    if(q.img&&q.img.url) st.img=q.img.url;
  }
  if(G.phase==='question'){st.paused=G.paused;st.rem=Math.round(remaining())}
  if(['reveal','board','final'].includes(G.phase)){
    const rk=ranked();
    if(q) st.c=q.correct;
    st.np=rk.length;st.res={};
    rk.forEach((p,k)=>st.res[p.key]=[p.score,p.gain,k+1,p.choice===null?-1:p.choice]);
    st.top=rk.slice(0,5).map(p=>[cut(p.name,24),p.score,p.av]);
  }
  return st;
}
// Serialised writes: only the newest state matters, retried until it gets through.
let pubBusy=false,pubNext=null;
function publish(){
  if(!G||!G.live) return;
  const q=G.qs[G.i];
  pubNext={pin:G.pin,o:{state:buildState(),status:G.phase==='lobby'?'lobby':'running',round:G.phase==='lobby'?-1:G.round||0,
    accepting:G.phase==='question'&&!G.paused,time:q?q.time:20,elapsed:G.phase==='question'?(G.paused?G.pauseAt:performance.now())-G.t0:0}};
  if(!pubBusy) pubLoop();
}
async function pubLoop(){
  pubBusy=true;let wait=500;
  while(pubNext){
    const job=pubNext;pubNext=null;
    try{await api.hostUpdate(job.pin,job.o);if(G){G.pubErr=false;connBadge()};wait=500}
    catch(e){
      if(e&&e.permanent){break}
      if(G&&G.pin===job.pin){G.pubErr=true;connBadge()}
      if(!pubNext) pubNext=job;
      await new Promise(r=>setTimeout(r,wait));wait=Math.min(wait*2,5000);
      if(!G||G.pin!==job.pin) pubNext=null;
    }
  }
  pubBusy=false;
}

function remaining(){
  const q=G.qs[G.i];
  const now=G.paused?G.pauseAt:performance.now();
  return Math.max(0,q.time*1000-(now-G.t0));
}
const INTRO_MS=4500;
function phaseIntro(){
  clearTimeout(G.to);
  G.phase='intro';G.showImg=false;G.ans={};G.cur=0;G.players.forEach(p=>{p.choice=null;p.gain=0;p.prev=p.score});
  G.round=G.seq;
  renderGame();publish();musicPlay('calm');
  G.to=setTimeout(phaseQuestion,INTRO_MS);
}
function phaseQuestion(){
  if(!G) return;
  G.phase='question';G.t0=performance.now();G.lastTick=-1;G.paused=false;musicPlay('tense');
  renderGame();publish();
  clearInterval(G.timer);G.timer=setInterval(tick,200);tick();
}
// setInterval (not requestAnimationFrame) so the clock keeps running in a background tab.
function tick(){
  if(!G||G.phase!=='question'){if(G)clearInterval(G.timer);return}
  if(G.paused) return;
  const q=G.qs[G.i],r=remaining(),sec=Math.ceil(r/1000);
  const n=$('#tn'),arc=$('#tarc'),bar=$('#tbar'),ring=$('#ring');
  if(n){n.textContent=sec;arc.style.strokeDashoffset=String(302*(1-r/(q.time*1000)));bar.style.transform=`scaleX(${r/(q.time*1000)})`;ring.classList.toggle('hot',sec<=5)}
  if(sec<=5&&sec>0&&sec!==G.lastTick){G.lastTick=sec;beep(sec<=3?880:660,.06,'square',.04)}
  if(r<=0) phaseReveal();
}
function answerLocal(j){
  if(!G||G.live||G.phase!=='question'||G.paused) return;
  const q=G.qs[G.i];
  if(!q.answers[j]||!q.answers[j].trim()) return;
  const p=G.players[G.cur];
  G.ans[p.key]={j,t:performance.now()-G.t0};
  beep(520,.05,'sine',.05);
  const left=G.players.map((_,k)=>k).filter(k=>!(G.players[k].key in G.ans));
  if(!left.length){phaseReveal();return}
  G.cur=left.find(k=>k>G.cur)??left[0];
  renderWho();
}
let revealing=false;
async function phaseReveal(){
  if(!G||G.phase!=='question'||revealing) return;
  clearInterval(G.timer);
  if(G.live){
    // Close answers first, then collect anything that arrived in the last moment.
    revealing=true;G.paused=true;G.pauseAt=performance.now();
    const g=G;
    try{await Promise.race([api.fetchAnswers(g.pin,g.round).then(rows=>{g.paused=false;rows.forEach(takeAnswerFinal)}),new Promise(r=>setTimeout(r,2500))])}catch(e){}
    revealing=false;
    if(G!==g||G.phase!=='question') return;
    G.paused=false;
  }
  const q=G.qs[G.i];
  G.players.forEach(p=>{
    const a=G.ans[p.key];p.choice=a?a.j:null;
    const ok=a&&q.correct.includes(a.j);
    p.gain=ok?Math.round(1000*q.points*(1-Math.min(1,a.t/(q.time*1000))/2)):0;
    p.score+=p.gain;
    p.streak=ok?(p.streak||0)+1:0;
  });
  G.phase='reveal';G.seq++;musicStop();chime();renderGame();publish();
  if(S.auto) G.to=setTimeout(next,5500);
}
function takeAnswerFinal(row){if(row&&row.round===G.round&&!G.kicked.has(row.pid)&&!(row.pid in G.ans)){if(!G.players.find(p=>p.key===row.pid))return;G.ans[row.pid]={j:row.choice,t:row.elapsed_ms}}}
function next(){
  if(!G) return;
  clearTimeout(G.to);
  if(G.phase==='lobby'){phaseIntro();return}
  if(G.phase==='intro'){phaseQuestion();return}
  if(G.phase==='question'){phaseReveal();return}
  if(G.phase==='reveal'){
    if(G.i>=G.qs.length-1){G.phase='final';renderGame();publish();chime();setTimeout(chime,400);setTimeout(()=>{if(G&&G.phase==='final')musicPlay('party')},1200);return}
    if(G.players.length>1){G.phase='board';renderGame();publish();if(S.auto)G.to=setTimeout(next,5000);return}
  }
  if(G.phase==='reveal'||G.phase==='board'){G.i++;phaseIntro()}
}
function togglePause(){
  if(!G||G.phase!=='question'||revealing) return;
  if(!G.paused){G.paused=true;G.pauseAt=performance.now()}
  else{G.t0+=performance.now()-G.pauseAt;G.paused=false}
  if(G.paused){if(M.el)M.el.pause();if(M.timer){clearInterval(M.timer);M.timer=0}}else{const k=M.kind;M.kind=null;musicPlay(k||'tense')}
  renderGame();publish();
}
function updateLobby(){
  const ps=activePlayers();
  const c=$('#lcount'),n=$('#lnames');if(!n) return;
  c.innerHTML=`<b>${ps.length}</b>${ps.length===1?'משתתף':'משתתפים'}`;
  if(G.renaming&&$('#rname')) return;
  n.innerHTML=ps.length?ps.map(p=>`<span class="nm ${p.here?'':'away'}" title="${p.here?'':'לא מחובר כרגע'}">${avHTML(p.av,'sm')}${G.renaming===p.key?`<input class="rname" id="rname" maxlength="24" value="${esc(p.name)}" data-k="${esc(p.key)}"><button class="rsave" data-act="prsave">✓</button>`:`<span>${esc(p.name)}</span>`}<span class="pmenu"><button class="dots" data-act="pmenu" data-k="${esc(p.key)}" aria-label="אפשרויות למשתתף">⋮</button>${G.menu===p.key?`<span class="pop"><button data-act="pdel" data-k="${esc(p.key)}" class="red">מחיקה</button><button data-act="pren" data-k="${esc(p.key)}">שינוי שם</button></span>`:''}</span></span>`).join(''):'<span class="wait">מחכים שמשתתפים יצטרפו…</span>';
}
function kickPlayer(k){
  G.kicked.add(k);G.players=G.players.filter(x=>x.key!==k);G.menu=null;delete G.ans[k];
  if(G.live) api.kickPlayer(G.pin,k);
  updateLobby();publish();
}
function commitRename(){
  const r=$('#rname');if(!r||!G) return;
  const pl=G.players.find(x=>x.key===r.dataset.k),v=r.value.trim();
  if(pl&&v){pl.name=cut(v,24);G.names[pl.key]=pl.name}
  G.renaming=null;updateLobby();publish();
}
document.addEventListener('keydown',e=>{if(e.target&&e.target.id==='rname'){if(e.key==='Enter'){e.preventDefault();commitRename()}else if(e.key==='Escape'){G.renaming=null;updateLobby()}}});
document.addEventListener('click',e=>{if(G&&G.phase==='lobby'&&G.menu&&!e.target.closest('.pmenu')){G.menu=null;updateLobby()}});

import * as api from './backend.js';
import QRCode from 'qrcode';
(function(){
const LK='bama.quizzes.v1';
const LET=['א','ב','ג','ד'];
const AVS=['🦊','🐼','🐸','🦁','🐙','🦄','🐯','🐨','🐵','🐧','🦉','🐢'];
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Math.random().toString(36).slice(2,10);
const newId=()=>{const a=new Uint8Array(9);crypto.getRandomValues(a);return Array.from(a,b=>(b%36).toString(36)).join('')};
const app=()=>$('#app');
const cut=(s,n)=>{s=String(s||'');return s.length>n?s.slice(0,n-1)+'…':s};
const fmt=n=>Number(n||0).toLocaleString('he-IL');

function sample(){
  return {id:newId(),title:'טריוויה כללית (דוגמה)',questions:[
    {q:'מהי הנקודה הנמוכה ביותר ביבשה בעולם?',answers:['הכנרת','ים המלח','מכתש רמון','עמק החולה'],correct:[1],time:20,points:1},
    {q:'כמה צלעות יש למשושה?',answers:['5','6','7','8'],correct:[1],time:10,points:1},
    {q:'איזה כוכב לכת הכי קרוב לשמש?',answers:['נוגה','מאדים','כוכב חמה','צדק'],correct:[2],time:20,points:1},
    {q:'מה הסמל הכימי של זהב?',answers:['Ag','Au','Go','Gd'],correct:[1],time:20,points:2},
    {type:'tf',q:'בשנה מעוברת יש 366 ימים.',answers:['נכון','לא נכון','',''],correct:[0],time:10,points:1},
    {q:'מהו היונק הגדול ביותר בעולם?',answers:['פיל אפריקני','לווייתן כחול','ג׳ירפה','כריש לווייתני'],correct:[1],time:20,points:1}
  ],updated:Date.now()};
}
function blankQ(){return {type:'quiz',q:'',answers:['','','',''],correct:[0],time:20,points:1,img:null}}

/* ---------- local storage (settings; old quizzes are offered once after first sign-in) ---------- */
let local;
try{local=JSON.parse(localStorage.getItem(LK))}catch(e){local=null}
if(!local||!Array.isArray(local.quizzes)) local={quizzes:[],settings:{}};
local.settings=Object.assign({music:'synth',vol:0.5,auto:true,sound:true,players:[],migrated:false,nick:'',pin:'145008',pinUsed:false},local.settings||{});
if(local.settings.pinUsed||!/^\d{6}$/.test(local.settings.pin)) local.settings.pin='';
const newPin=()=>String(Math.floor(100000+Math.random()*900000));
let setupPin='';
const S=local.settings;
let lsT;
function saveLocal(){clearTimeout(lsT);lsT=setTimeout(()=>{try{
  const out={settings:S,quizzes:local.quizzes};
  localStorage.setItem(LK,JSON.stringify(out))}catch(e){}},200)}

/* ---------- quiz store (Supabase when signed in) ---------- */
let quizzes=[];
let user=null;                 // signed-in host (Supabase user) or null
let authReady=false;           // first session check finished
let cloudState='connecting';   // connecting | ready | off
let touched=false;
const pend={}, inflight={};
let saveMsg='';

function setSave(m){saveMsg=m;const el=$('#savest');if(el)el.textContent=m}
function persist(z){
  z.updated=Date.now();
  if(!user){setSave('צריך להתחבר כדי לשמור');return}
  setSave('שומר…');
  clearTimeout(pend[z.id]);pend[z.id]=setTimeout(()=>flush(z.id),600);
}
async function flush(id){
  clearTimeout(pend[id]);
  if(inflight[id]){inflight[id]='again';return}
  const z=findQ(id);if(!z||!user) return;
  inflight[id]=true;
  try{await api.saveQuiz(z,user.id);setSave('נשמר בחשבון שלך ✓')}
  catch(e){setSave('השמירה נכשלה, בודקים שוב בעוד רגע…');setTimeout(()=>{if(findQ(id))flush(id)},4000)}
  const again=inflight[id]==='again';inflight[id]=false;if(again) flush(id);
}
// Save everything still waiting before the page closes or hides.
function flushAll(){Object.keys(pend).forEach(id=>{if(pend[id]){clearTimeout(pend[id]);pend[id]=0;flush(id)}})}
window.addEventListener('pagehide',flushAll);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushAll()});
function removeQuiz(id){
  const z=findQ(id);
  quizzes=quizzes.filter(q=>q.id!==id);
  clearTimeout(pend[id]);
  if(user) api.deleteQuiz(id).catch(()=>{});
  if(z){ if(z.cover) api.deleteFile(z.cover.id); (z.questions||[]).forEach(q=>q.img&&api.deleteFile(q.img.id)); }
}
function addQuiz(z,atEnd){if(atEnd)quizzes.push(z);else quizzes.unshift(z);persist(z)}
const findQ=id=>quizzes.find(q=>q.id===id);
const canUpload=()=>!!user;

async function loadAccount(){
  if(!user){quizzes=[];cloudState='off';songs=songs.filter(s=>s.local);return}
  cloudState='connecting';rerenderSoft();
  try{
    const list=await api.listQuizzes();
    // keep the quiz that is open in the editor as-is (it may have unsaved typing)
    const editing=view.name==='edit'?findQ(view.id):null;
    quizzes=list.map(q=>editing&&q.id===editing.id?editing:q);
    if(!list.length&&!S.seeded){
      S.seeded=true;saveLocal();
      const old=(local.quizzes||[]).filter(q=>q&&q.questions&&q.questions.length);
      (old.length?old:[sample()]).forEach(z=>{z.id=newId();quizzes.push(z);persist(z)});
    }
    cloudState='ready';
  }catch(e){cloudState='off'}
  try{
    const saved=await api.getSongs(user.id);
    songs=saved.filter(x=>x&&typeof x.url==='string').map(x=>({id:x.id,url:x.url,name:String(x.name||'שיר'),type:String(x.type||'audio/mpeg')})).concat(songs.filter(x=>x.local));
  }catch(e){}
  rerenderSoft();
  checkActiveGame();
}
let activeGame=null;
async function checkActiveGame(){
  activeGame=null;
  if(!user) return;
  try{const g=await api.myActiveGame(user.id);if(g&&g.state&&g.state.phase&&g.state.phase!=='final'&&findQ(g.quiz_id))activeGame=g}catch(e){}
  if(activeGame&&view.name==='home') render();
}

/* ---------- music ---------- */
let songs=[], musicMsg='', uploading=false;
const songURL={};
const M={kind:null,timer:0,step:0,next:0,gain:null,el:null,idx:-1,cur:null};
function mtof(m){return 440*Math.pow(2,(m-69)/12)}
function ensureAC(){try{AC=AC||new (window.AudioContext||window.webkitAudioContext)();if(AC.state==='suspended')AC.resume();return AC}catch(e){return null}}
function synthNote(t,f,d,type,vol){
  const o=AC.createOscillator(),g=AC.createGain();
  o.type=type;o.frequency.value=f;o.connect(g);g.connect(M.gain);
  g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+0.01);g.gain.exponentialRampToValueAtTime(0.0001,t+d);
  o.start(t);o.stop(t+d+0.02);
}
const PROGS={calm:[[57,60,64],[53,57,60],[48,52,55],[55,59,62]],tense:[[50,53,57],[50,53,57],[46,50,53],[48,52,55]],party:[[60,64,67],[57,60,64],[53,57,60],[55,59,62]]};
function schedule(){
  if(!AC||!M.kind) return;
  const k=M.kind,bpm=k==='tense'?152:k==='party'?126:100,sx=60/bpm/4,P=PROGS[k];
  while(M.next<AC.currentTime+0.2){
    const s=M.step,i=s%16,ch=P[Math.floor(s/16)%4];
    if(i===0||i===8||(k==='tense'&&i%4===0)) synthNote(M.next,mtof(ch[0]-24),sx*(k==='tense'?3.5:7),'triangle',.25);
    if(i%2===0){const pat=[0,1,2,1,0,2,1,2];synthNote(M.next,mtof(ch[pat[(i/2)%8]]+12),sx*1.6,'square',.045)}
    if(k!=='calm'&&i%4===2) synthNote(M.next,k==='tense'?2400:1800,.03,'sine',.03);
    if(k==='party'&&i%8===4) synthNote(M.next,mtof(ch[2]+24),sx*3,'triangle',.05);
    M.next+=sx;M.step++;
  }
}
function setVol(){
  if(M.gain&&AC) M.gain.gain.setTargetAtTime(S.vol*0.7,AC.currentTime,.05);
  if(M.el) M.el.volume=Math.min(1,S.vol);
}
async function songSrc(s){return songURL[s.id]||s.url}
function audioEl(){if(!M.el){M.el=new Audio();M.el.addEventListener('ended',()=>{if(M.kind)playSong(true)})}return M.el}
function unlockSongs(){if(S.music==='songs'&&songs.length){const a=audioEl();if(!a.src){a.src='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';a.play().catch(()=>{})}}}
async function playSong(nextOne){
  if(!songs.length) return false;
  audioEl();
  setVol();
  if(!nextOne&&M.cur&&M.el.src){M.el.play().catch(()=>{});return true}
  M.idx=(M.idx+1)%songs.length;const s=songs[M.idx];
  try{M.cur=s.id;M.el.src=await songSrc(s);if(M.kind)await M.el.play()}catch(e){if(songs.length>1&&nextOne!=='retry')return playSong('retry')}
  return true;
}
function musicPlay(kind){
  if(S.music==='off'){musicStop();return}
  if(S.music==='songs'&&songs.length){
    if(M.kind&&M.el&&!M.el.paused){M.kind=kind;return}
    M.kind=kind;playSong(false);return;
  }
  if(!ensureAC()) return;
  if(!M.gain){M.gain=AC.createGain();M.gain.connect(AC.destination)}
  setVol();
  if(M.kind===kind&&M.timer) return;
  M.kind=kind;
  if(!M.timer){M.step=0;M.next=AC.currentTime+0.05;M.timer=setInterval(schedule,50)}
}
function musicStop(){
  M.kind=null;
  if(M.timer){clearInterval(M.timer);M.timer=0}
  if(M.el) M.el.pause();
}
async function saveSongs(){
  if(!user) return;
  try{await api.saveSongs(user.id,songs.filter(s=>!s.local).map(s=>({id:s.id,url:s.url,name:s.name,type:s.type})))}catch(e){}
}
async function addSongs(files){
  uploading=true;musicMsg='מעלה…';render();
  let bad=0,big=0,localOnly=0,failed=0;
  for(const f of files){
    if(!/^audio\//.test(f.type)&&!/\.(mp3|m4a|wav|ogg|aac|flac)$/i.test(f.name)){bad++;continue}
    const name=cut(f.name.replace(/\.[^.]+$/,''),40),type=f.type||'audio/mpeg';
    if(user){
      try{
        const r=await api.uploadFile(user.id,f,'song');
        songs.push({id:r.id,url:r.url,name,type});
        songURL[r.id]=URL.createObjectURL(f);
        await saveSongs();continue;
      }catch(e){if(e&&e.code==='too_large'){big++;continue}failed++}
    }
    const id='local-'+uid();songURL[id]=URL.createObjectURL(f);
    songs.push({id,url:'',name,type,local:true});localOnly++;
  }
  uploading=false;
  musicMsg=[bad?`${bad} קבצים הם לא קובצי שמע.`:'',big?`${big} שירים גדולים מדי (עד 25 MB לשיר).`:'',failed?'חלק מהשירים לא הועלו.':'',localOnly?'השירים שלא הועלו יישמרו רק עד שתסגור את הדף.':'' ].filter(Boolean).join(' ')||'השירים נשמרו ✓';
  render();
}
function removeSong(i){
  const s=songs[i];if(!s) return;
  songs.splice(i,1);
  if(M.cur===s.id){musicStop();M.cur=null;if(M.el)M.el.removeAttribute('src')}
  if(!s.local) api.deleteFile(s.id);
  saveSongs();render();
}

function musicHTML(){
  const opt=(m,t)=>`<button class="segb ${S.music===m?'on':''}" data-act="mus" data-m="${m}" aria-pressed="${S.music===m}">${t}</button>`;
  return `<div class="field">
    <span class="label">מוזיקה במשחק</span>
    <div class="seg">${opt('off','בלי מוזיקה')}${opt('synth','מנגינה מובנית')}${opt('songs','השירים שלי')}</div>
    ${S.music==='songs'?`
      <div class="songs">${songs.length?songs.map((s,i)=>`<div class="song"><span class="sn">♪ ${esc(s.name)}</span>${s.local?'<span class="muted" style="font-size:12px">זמני</span>':''}<button class="btn sm ghost danger" data-act="srem" data-i="${i}" aria-label="הסרת ${esc(s.name)}">×</button></div>`).join(''):'<span class="muted">עוד לא הוספת שירים. השירים יתנגנו לפי הסדר במהלך השאלות.</span>'}</div>
      <label class="btn" style="align-self:flex-start" ${uploading?'aria-disabled="true"':''}>${uploading?'מעלה…':'+ הוספת שירים מהמכשיר'}<input type="file" id="musfile" accept="audio/*,.mp3,.m4a,.wav,.ogg" multiple hidden ${uploading?'disabled':''}></label>
      ${musicMsg?`<span class="muted" style="font-size:14px">${esc(musicMsg)}</span>`:''}`:''}
    ${S.music!=='off'?`<div class="volrow"><span class="muted">עוצמה</span><input type="range" id="musvol" min="0" max="1" step="0.05" value="${S.vol}" aria-label="עוצמת מוזיקה"><button class="btn sm" data-act="mprev">${M.kind==='preview'||(M.kind&&view.name==='setup')?'■ עצירה':'▶ השמעה לניסיון'}</button></div>`:''}
  </div>`;
}

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

/* ---------- views ---------- */
let view={name:'home'};
let confirmDel=null,titleSaved=false;
function go(v){view=v;confirmDel=null;render();window.scrollTo(0,0)}
function render(){
  const app=$('#app');
  if(view.name==='home') app.innerHTML=homeV();
  else if(view.name==='edit') app.innerHTML=editV();
  else if(view.name==='setup') app.innerHTML=setupV();
  else if(view.name==='game') renderGame();
  else if(view.name==='join') app.innerHTML=joinV();
  else if(view.name==='player') renderPlayer(true);
  else if(view.name==='quiz') app.innerHTML=quizV();
  else app.innerHTML=homeV();
}

function qProblems(q){
  const p=[];
  if(!q.q.trim()) p.push('חסר טקסט לשאלה.');
  if(q.type==='tf'){ if(!(q.correct.includes(0)||q.correct.includes(1))) p.push('סמן אם התשובה הנכונה היא "נכון" או "לא נכון".'); return p }
  if(q.answers.slice(0,4).some(a=>!a.trim())) p.push('צריך למלא את כל 4 התשובות.');
  if(!q.correct.some(i=>q.answers[i]&&q.answers[i].trim())) p.push('סמן תשובה נכונה.');
  return p;
}
function validQs(quiz){return quiz.questions.filter(q=>!qProblems(q).length)}
function problems(quiz){
  const p=[];
  if(!quiz.questions.length) p.push('אין עדיין שאלות בחידון.');
  quiz.questions.forEach((q,i)=>qProblems(q).forEach(x=>p.push(`שאלה ${i+1}: ${x}`)));
  return p;
}

/* ---------- quiz art: hand-drawn style scenes ---------- */
function hashStr(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
const ART_NAMES={auto:'אוטומטי לפי השם',pray:'בית כנסת',book:'חכם וספרים',science:'מעבדה',globe:'נוף הרים',sport:'שיט',history:'קרב היסטורי',music:'נגנית',nature:'קציר בשדה',math:'חשבון וגאומטריה',idea:'הגל הגדול'};
const ART_RULES=[['pray',/תפיל|תורה|יהדות|חג|פרש|תנ.?ך|שבת|כנסת|ברכ|תהיל|קודש/],['history',/היסטור|מלחמ|מלך|מלכ|עתיק|צלבנ|אביר|ממלכ/],['science',/מדע|כימ|פיזיק|ביולוג|גוף האדם|חלל|כוכב/],['globe',/גאוגרפ|גיאוגרפ|עולם|מדינ|בירות|טיול|יבש/],['sport',/ספורט|כדור|אולימפ|מונדיאל/],['music',/מוזיק|שיר|זמר|להק/],['nature',/חיות|טבע|בעלי חיים|צמח|עצים|ציפור/],['math',/מתמטיק|חשבון|מספר|גאומטר|הנדס/],['book',/ספר|קריא|ספרות|לשון|עברית|אנגלית|מילים|דקדוק/]];
function artKind(z){
  if(z.art&&ART_NAMES[z.art]&&z.art!=='auto') return z.art;
  const t=z.title||'';for(const [k,re] of ART_RULES) if(re.test(t)) return k;
  return 'idea';
}
const SKINS=['#f6d0b1','#e2a985','#b97c58','#7e5038'];
const HAIRS=['#3b2618','#1f1a17','#8a4b24','#d9a441'];
function face(cx,cy,r,skin,hair,o={}){
  let s='';
  if(o.longHair) s+=`<path d="M${cx-r-3} ${cy+r*1.4} Q${cx-r-6} ${cy-r*1.1} ${cx} ${cy-r-4} Q${cx+r+6} ${cy-r*1.1} ${cx+r+3} ${cy+r*1.4}Z" fill="${hair}"/>`;
  s+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${skin}"/>`;
  s+=`<circle cx="${cx+r*.3}" cy="${cy-r*.3}" r="${r*.9}" fill="#fff" opacity=".12"/><path d="M${cx-r} ${cy} A${r} ${r} 0 0 0 ${cx+r} ${cy}" fill="#000" opacity=".1"/>`;
  if(o.closed) s+=`<path d="M${cx-r*.55} ${cy-r*.05} q${r*.2} ${r*.18} ${r*.4} 0 M${cx+r*.15} ${cy-r*.05} q${r*.2} ${r*.18} ${r*.4} 0" stroke="#3a2418" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  else s+=`<ellipse cx="${cx-r*.36}" cy="${cy-r*.05}" rx="${r*.09}" ry="${r*.06}" fill="#2a1a12"/><ellipse cx="${cx+r*.36}" cy="${cy-r*.05}" rx="${r*.09}" ry="${r*.06}" fill="#2a1a12"/><path d="M${cx-r*.5} ${cy-r*.25} h${r*.28} M${cx+r*.22} ${cy-r*.25} h${r*.28}" stroke="#2a1a12" stroke-width="1.3" opacity=".6"/>`;
  s+=`<path d="M${cx} ${cy+r*.05} l-${r*.08} ${r*.2} h${r*.12}" stroke="#00000033" stroke-width="1.2" fill="none"/><path d="M${cx-r*.2} ${cy+r*.45} q${r*.2} ${r*.08} ${r*.4} 0" stroke="#5a2e22" stroke-width="1.4" fill="none" stroke-linecap="round" opacity=".7"/>`;
  if(o.kippah) s+=`<path d="M${cx-r*.7} ${cy-r*.7} A${r*.8} ${r*.55} 0 0 1 ${cx+r*.7} ${cy-r*.7}Z" fill="${o.kippah}"/>`;
  else if(!o.longHair) s+=`<path d="M${cx-r} ${cy-r*.1} Q${cx-r*.9} ${cy-r*1.25} ${cx} ${cy-r*1.08} Q${cx+r*.95} ${cy-r*1.2} ${cx+r} ${cy-r*.1} Q${cx+r*.4} ${cy-r*.75} ${cx-r} ${cy-r*.1}Z" fill="${hair}"/>`;
  else s+=`<path d="M${cx-r} ${cy-r*.05} Q${cx-r*.6} ${cy-r*1.3} ${cx+r*.2} ${cy-r*1.05} Q${cx+r} ${cy-r*.9} ${cx+r} ${cy} Q${cx+r*.2} ${cy-r*.75} ${cx-r} ${cy-r*.05}Z" fill="${hair}"/>`;
  return s;
}
function bgGrad(id,a,b){return `<defs><linearGradient id="${id}" x1="0" y1="0" x2=".3" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect x="-70" width="340" height="200" fill="url(#${id})"/>`}
const sparkle=(x,y,s,c)=>`<path d="M${x} ${y-s} Q${x} ${y} ${x+s} ${y} Q${x} ${y} ${x} ${y+s} Q${x} ${y} ${x-s} ${y} Q${x} ${y} ${x} ${y-s}Z" fill="${c||'#fff'}"/>`;
const SCENES={
  pray:(g,sk,hr)=>bgGrad(g,'#ffd9a0','#f49ac1')+
    `<path d="M118 165 V70 A27 27 0 0 1 172 70 V165Z" fill="#fff4d6" opacity=".85"/><path d="M145 43 V165 M118 100 H172" stroke="#f3b8a0" stroke-width="3"/>`+
    `<path d="M118 165 L60 200 H200 V190 L172 165Z" fill="#fff" opacity=".25"/><rect x="-70" y="165" width="340" height="35" fill="#c66f98" opacity=".45"/>`+
    `<defs><clipPath id="${g}c"><path d="M38 180 Q40 122 78 114 Q116 122 118 180Z"/></clipPath></defs>`+
    `<path d="M38 180 Q40 122 78 114 Q116 122 118 180Z" fill="#fdfdfd"/><g clip-path="url(#${g}c)"><rect x="30" y="146" width="100" height="6" fill="#3f63b8"/><rect x="30" y="156" width="100" height="3" fill="#3f63b8"/></g>`+
    `<path d="M66 118 L78 136 L90 118" fill="#e8eef9"/><rect x="72" y="104" width="12" height="14" fill="${sk}"/>`+face(78,90,18,sk,hr,{closed:true,kippah:'#3f63b8'})+
    `<path d="M71 146 Q78 118 85 146Z" fill="${sk}"/><path d="M78 146 V126" stroke="#00000022" stroke-width="1.5"/>`+
    sparkle(40,60,7)+sparkle(105,45,5)+sparkle(28,100,4),
  book:(g,sk,hr)=>bgGrad(g,'#b8ecff','#7a7bff')+
    `<rect x="148" y="120" width="34" height="10" rx="2" fill="#ffcf5c"/><rect x="144" y="130" width="40" height="11" rx="2" fill="#ff7a8a"/><rect x="150" y="141" width="32" height="10" rx="2" fill="#5fd38d"/>`+
    `<path d="M50 175 Q52 120 100 112 Q148 120 150 175Z" fill="#ff9f43"/><rect x="93" y="98" width="14" height="16" fill="${sk}"/>`+face(100,80,22,sk,hr,{longHair:true})+
    `<path d="M50 132 Q100 118 100 138 Q100 118 150 132 V170 Q100 156 100 174 Q100 156 50 170Z" fill="#fff"/><path d="M100 138 V174" stroke="#d6dcf5" stroke-width="2"/>`+
    `<path d="M60 142 Q78 136 92 142 M60 150 Q78 144 92 150 M108 142 Q122 136 140 142 M108 150 Q122 144 140 150" stroke="#c4cbe8" stroke-width="2" fill="none"/>`+
    `<circle cx="52" cy="152" r="7" fill="${sk}"/><circle cx="148" cy="152" r="7" fill="${sk}"/>`+sparkle(40,50,6)+sparkle(160,60,5),
  science:(g,sk,hr)=>bgGrad(g,'#c6f7e2','#2ea58c')+
    `<ellipse cx="55" cy="60" rx="30" ry="11" fill="none" stroke="#fff" stroke-width="3" opacity=".8"/><ellipse cx="55" cy="60" rx="30" ry="11" fill="none" stroke="#fff" stroke-width="3" opacity=".8" transform="rotate(60 55 60)"/><ellipse cx="55" cy="60" rx="30" ry="11" fill="none" stroke="#fff" stroke-width="3" opacity=".8" transform="rotate(-60 55 60)"/><circle cx="55" cy="60" r="6" fill="#ffd166"/>`+
    `<path d="M108 52 h24 v38 l34 66 a9 9 0 0 1 -8 13 h-76 a9 9 0 0 1 -8 -13 l34 -66z" fill="#fff" opacity=".92"/><path d="M90 128 h60 l16 28 a9 9 0 0 1 -8 13 h-76 a9 9 0 0 1 -8 -13z" fill="#ff6fc8"/><rect x="104" y="46" width="32" height="8" rx="3" fill="#e6f7f2"/>`+
    `<circle cx="112" cy="148" r="5" fill="#fff" opacity=".7"/><circle cx="130" cy="140" r="3.5" fill="#fff" opacity=".7"/><circle cx="122" cy="110" r="4" fill="#ff6fc8" opacity=".8"/><circle cx="132" cy="92" r="3" fill="#ff6fc8" opacity=".6"/>`+sparkle(165,55,7)+sparkle(30,140,5),
  globe:(g,sk,hr)=>bgGrad(g,'#ffe8a8','#ff9a6b')+
    `<path d="M30 60 q40 -30 80 -10" stroke="#fff" stroke-width="2.5" stroke-dasharray="6 6" fill="none"/><path d="M112 46 l18 -6 l-6 8 l6 8z M118 44 l10 -12 l4 2 l-6 12z" fill="#fff"/>`+
    `<path d="M100 172 V160 M70 182 h60" stroke="#8a4b24" stroke-width="7" stroke-linecap="round"/><path d="M48 110 A52 52 0 0 0 152 110" stroke="#c97a3a" stroke-width="5" fill="none"/>`+
    `<circle cx="100" cy="110" r="45" fill="#4fb3ff"/><path d="M72 88 q12 -10 24 -2 q6 10 -6 14 q-4 10 -14 6 q-10 -6 -4 -18z M108 100 q14 -6 22 4 q4 14 -8 20 q-8 10 -16 2 q-6 -12 2 -26z M84 128 q10 -2 14 6 q-2 10 -12 8z" fill="#5fd38d"/><circle cx="100" cy="110" r="45" fill="none" stroke="#fff" stroke-width="3" opacity=".5"/>`+sparkle(165,150,6)+sparkle(35,150,5),
  sport:(g,sk,hr)=>bgGrad(g,'#cff7a4','#38a35b')+
    `<rect x="-70" y="160" width="340" height="40" fill="#2f8f50" opacity=".5"/><path d="M20 70 H180 V140 H20Z" fill="none" stroke="#fff" stroke-width="4" opacity=".8"/><path d="M20 70 l20 -16 H160 l20 16 M40 54 V124 M160 54 V124" stroke="#fff" stroke-width="3" fill="none" opacity=".6"/>`+
    `<path d="M50 80 H150 M50 95 H150 M50 110 H150 M70 70 V140 M100 70 V140 M130 70 V140" stroke="#fff" stroke-width="1.5" opacity=".35"/><ellipse cx="100" cy="182" rx="40" ry="6" fill="#00000022"/>`+
    `<circle cx="100" cy="150" r="28" fill="#fff"/><path d="M100 138 l11 8 l-4 13 h-14 l-4 -13z" fill="#2a2a2a"/><path d="M100 138 V122 M111 146 l15 -5 M107 159 l9 13 M93 159 l-9 13 M89 146 l-15 -5" stroke="#2a2a2a" stroke-width="2"/>`+sparkle(40,40,6)+sparkle(165,170,5),
  history:(g,sk,hr)=>bgGrad(g,'#ffd8a6','#b16fd8')+
    `<circle cx="150" cy="50" r="18" fill="#fff4c4"/><path d="M-70 175 Q20 125 120 160 T270 145 V200 H-70Z" fill="#7a4fa8"/>`+
    `<path d="M58 160 V92 h10 v-10 h10 v10 h10 v-10 h10 v10 h10 v-10 h10 v10 h10 v68Z" fill="#f2e2c9"/><path d="M48 160 V72 h8 v-8 h8 v8 h8 v88Z M128 160 V72 h8 v-8 h8 v8 h8 v88Z" fill="#e6cfae"/>`+
    `<path d="M88 160 V135 a12 12 0 0 1 24 0 V160Z" fill="#8a5a3c"/><rect x="58" y="96" width="6" height="10" rx="3" fill="#8a5a3c"/><rect x="136" y="84" width="6" height="10" rx="3" fill="#8a5a3c"/>`+
    `<path d="M140 64 V38" stroke="#5a3a2a" stroke-width="2"/><path d="M140 38 h18 l-5 6 l5 6 h-18z" fill="#ff5e6c"/>`+sparkle(40,40,6),
  music:(g,sk,hr)=>bgGrad(g,'#ffc6e6','#8b5cf6')+
    `<path d="M55 50 V95 a10 8 0 1 1 -6 -7 V58 l30 -8 V85 a10 8 0 1 1 -6 -7 V50z" fill="#fff"/><path d="M150 60 V92 a9 7 0 1 1 -6 -6 V60z M150 60 l14 6 v6 l-14 -6z" fill="#fff" opacity=".85"/>`+
    `<path d="M50 175 Q52 128 100 120 Q148 128 150 175Z" fill="#22c3a6"/><rect x="93" y="106" width="14" height="16" fill="${sk}"/>`+face(100,88,22,sk,hr,{closed:true})+
    `<path d="M76 88 A24 24 0 0 1 124 88" stroke="#2a2a3a" stroke-width="5" fill="none"/><rect x="70" y="82" width="10" height="18" rx="5" fill="#ff5e8a"/><rect x="120" y="82" width="10" height="18" rx="5" fill="#ff5e8a"/>`+sparkle(35,130,6)+sparkle(170,130,5),
  nature:(g,sk,hr)=>bgGrad(g,'#d9f8c8','#46b46b')+
    `<circle cx="160" cy="44" r="16" fill="#fff3b0"/><path d="M-70 172 Q100 132 270 172 V200 H-70Z" fill="#2f8f50"/>`+
    `<rect x="72" y="110" width="16" height="60" rx="5" fill="#8a5a3c"/><circle cx="80" cy="90" r="34" fill="#2fa35b"/><circle cx="58" cy="104" r="22" fill="#38b866"/><circle cx="104" cy="104" r="22" fill="#38b866"/>`+
    `<circle cx="70" cy="86" r="4" fill="#ff6b6b"/><circle cx="94" cy="96" r="4" fill="#ff6b6b"/><circle cx="80" cy="112" r="4" fill="#ff6b6b"/>`+
    `<path d="M130 70 q8 -8 16 0 q8 -8 16 0" stroke="#2a2a2a" stroke-width="2.5" fill="none"/><path d="M118 168 q4 -14 8 0 M150 172 q4 -12 8 0" stroke="#5fd38d" stroke-width="3" fill="none"/>`,
  math:(g,sk,hr)=>bgGrad(g,'#ffe0f2','#6d8cff')+
    `<rect x="30" y="40" width="140" height="92" rx="8" fill="#2d6a4f"/><rect x="30" y="40" width="140" height="92" rx="8" fill="none" stroke="#c48a52" stroke-width="7"/>`+
    `<text x="100" y="98" text-anchor="middle" font-family="Secular One,Assistant,sans-serif" font-size="34" fill="#fff" direction="ltr">2+3=?</text>`+
    `<path d="M120 150 l40 30 l-6 6 l-40 -30z" fill="#ffcf5c"/><path d="M114 150 l6 -2 l-2 6z" fill="#3a2a1a"/><rect x="50" y="150" width="24" height="24" rx="4" fill="#ff7a8a" transform="rotate(-12 62 162)"/><circle cx="92" cy="170" r="10" fill="#5fd38d"/>`,
  idea:(g,sk,hr)=>bgGrad(g,'#fff0a6','#ff8fb3')+
    `<g opacity=".9"><path d="M100 22 v10 M70 32 l6 8 M130 32 l-6 8 M60 56 h10 M130 56 h10" stroke="#fff" stroke-width="3" stroke-linecap="round"/></g>`+
    `<path d="M100 36 a20 20 0 0 1 12 36 v8 h-24 v-8 a20 20 0 0 1 12 -36z" fill="#fff6b8"/><rect x="90" y="80" width="20" height="8" rx="2" fill="#b8b8c8"/>`+
    `<path d="M48 190 Q50 140 100 132 Q150 140 152 190Z" fill="#7b5cff"/><rect x="93" y="116" width="14" height="18" fill="${sk}"/>`+face(100,108,20,sk,hr)+
    `<text x="40" y="130" font-family="Secular One,sans-serif" font-size="30" fill="#fff" opacity=".85">?</text><text x="150" y="120" font-family="Secular One,sans-serif" font-size="22" fill="#fff" opacity=".85">?</text>`
};
window.__artSvg=id=>{const z=findQ(id);return z?svgArt(z):''};
const PHOTOS=Object.fromEntries(['pray','science','math','book','history','globe','nature','idea','sport','music'].map(k=>[k,'/art/'+k+'.jpg']));
function photoFor(z){
  const list=quizzes.some(q=>q.id===z.id)?quizzes:quizzes.concat([z]);
  const ids=list.slice().sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),used={},res={};
  const take=(q,k)=>{res[q.id]=k;used[k]=(used[k]||0)+1};
  ids.forEach(q=>{if(!(q.cover&&q.cover.url)&&q.art&&q.art!=='auto'&&PHOTOS[q.art]) take(q,q.art)});
  ids.forEach(q=>{
    if((q.cover&&q.cover.url)||res[q.id]) return;
    let k=artKind(q);
    if(!PHOTOS[k]||(used[k]||0)>=2){const free=Object.keys(PHOTOS).filter(x=>(used[x]||0)<2).sort((a,b)=>(used[a]||0)-(used[b]||0));k=free[0]||null}
    if(k) take(q,k); else res[q.id]=null;
  });
  return res[z.id];
}
function quizArt(z){
  if(z.cover&&z.cover.url) return `<img class="art-img" src="${esc(z.cover.url)}" alt="">`;
  const pk=photoFor(z);
  if(pk&&PHOTOS[pk]) return `<img class="art-img" src="${PHOTOS[pk]}" alt="" onerror="this.replaceWith(document.createRange().createContextualFragment(window.__artSvg(this.dataset.z)))" data-z="${z.id}">`;
  return svgArt(z);
}
function svgArt(z){
  const h=hashStr(z.id),k=artKind(z),sk=SKINS[h%4],hr=HAIRS[(h>>3)%4];
  const side=sparkle(-40,40,6)+sparkle(-25,150,4)+sparkle(235,60,5)+sparkle(245,160,7)+`<circle cx="-45" cy="100" r="3" fill="#fff" opacity=".6"/><circle cx="240" cy="110" r="3" fill="#fff" opacity=".6"/>`;
  const f='f'+z.id;
  const finish=`<defs><filter id="${f}n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="3" seed="${h%97}"/><feColorMatrix type="matrix" values="0 0 0 0 .5  0 0 0 0 .4  0 0 0 0 .3  0 0 0 .9 0"/></filter><filter id="${f}p"><feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="2" seed="${h%53}" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="2.2"/></filter><radialGradient id="${f}v" cx=".5" cy=".45" r=".75"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#1a0b2e" stop-opacity=".55"/></radialGradient><radialGradient id="${f}l" cx=".25" cy=".1" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>`;
  return `<svg viewBox="-60 4 320 196" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${finish}<g filter="url(#${f}p)">${SCENES[k]('g'+z.id+k,sk,hr)}</g><rect x="-70" width="340" height="200" fill="url(#${f}l)"/><rect x="-70" width="340" height="200" filter="url(#${f}n)" opacity=".16"/><rect x="-70" width="340" height="200" fill="url(#${f}v)"/></svg>`;
}

let providers={google:false,autoconfirm:false};
let authMode='signin', authMsg='', authBusy=false, pwRecovery=false;
function brandHTML(sub){return `<div class="brand"><div class="logo">מ</div><div><h1>חידוני מתניה</h1><small>${sub||'חידונים חיים'}</small></div></div>`}
function authV(){
  if(pwRecovery) return `<div class="panel authp">
      <h2 style="font-size:26px">סיסמה חדשה</h2>
      <form id="pwform" class="aform"><label class="field"><span class="label">סיסמה חדשה</span><input class="in" id="newpw" type="password" minlength="6" autocomplete="new-password" required></label>
      ${authMsg?`<div class="warn">${esc(authMsg)}</div>`:''}
      <button class="btn primary big" type="submit" ${authBusy?'disabled':''}>שמירת סיסמה</button></form></div>`;
  const up=authMode==='signup',reset=authMode==='reset';
  return `<div class="panel authp">
    <div class="label">למנחים</div>
    <h2 style="font-size:26px">${reset?'שחזור סיסמה':up?'פתיחת חשבון':'כניסה לחשבון'}</h2>
    <p class="muted" style="margin:0">${reset?'נשלח לך קישור לבחירת סיסמה חדשה.':'כדי ליצור חידונים ולהפעיל משחק. משתתפים לא צריכים חשבון.'}</p>
    ${providers.google&&!reset?`<button class="btn big gbtn" data-act="google">המשך עם Google</button><div class="or"><span>או</span></div>`:''}
    <form id="authform" class="aform">
      <label class="field"><span class="label">אימייל</span><input class="in" id="aemail" type="email" autocomplete="email" dir="ltr" required></label>
      ${reset?'':`<label class="field"><span class="label">סיסמה</span><input class="in" id="apw" type="password" minlength="6" autocomplete="${up?'new-password':'current-password'}" dir="ltr" required></label>`}
      ${authMsg?`<div class="warn">${esc(authMsg)}</div>`:''}
      <button class="btn primary big" type="submit" ${authBusy?'disabled':''}>${authBusy?'רגע…':reset?'שליחת קישור':up?'פתיחת חשבון':'כניסה'}</button>
    </form>
    <div class="alinks">
      ${up||reset?`<button class="linkb" data-act="amode" data-m="signin">כבר יש לי חשבון</button>`:`<button class="linkb" data-act="amode" data-m="signup">אין לי חשבון, לפתוח חשבון</button><button class="linkb" data-act="amode" data-m="reset">שכחתי סיסמה</button>`}
    </div>
  </div>`;
}
function homeV(){
  if(!authReady) return `<div class="wrap"><div class="empty">טוען…</div></div>`;
  if(!user) return `<div class="wrap">
    <div class="top">${brandHTML()}</div>
    <div class="landing">
      <div class="panel joinp">
        <div class="label">משתתפים</div>
        <h2 style="font-size:30px">הצטרפות למשחק</h2>
        <p class="muted" style="margin:0">הקלידו את הקוד שמופיע על המסך של המנחה, או סרקו את קוד ה-QR.</p>
        <button class="btn primary big" data-act="tojoin">יש לי קוד משחק</button>
      </div>
      ${authV()}
    </div>
  </div>`;
  const cards=quizzes.map(z=>`
    <div class="kcard" role="button" tabindex="0" data-act="open" data-id="${z.id}">
      <span class="kart">${quizArt(z)}<span class="kcount">${z.questions.length} שאלות</span>
        <button class="sqdel${confirmDel===z.id?' ask':''}" data-act="delhome" data-id="${z.id}" title="מחיקת החידון" aria-label="מחיקת החידון">${confirmDel===z.id?'למחוק?':'✕'}</button>
        <span class="kover"><button class="kb kedit" data-act="open" data-id="${z.id}">להיכנס</button><span class="kmid"><button class="kb kin" data-act="edit" data-id="${z.id}">לערוך</button></span></span>
      </span>
      <span class="ktitle">${esc(z.title||'חידון ללא שם')}</span>
    </div>`).join('');
  const loading=cloudState==='connecting'&&!quizzes.length;
  return `<div class="wrap wide">
    <div class="top">
      ${brandHTML()}
      <div class="lacts"><button class="btn ghost" data-act="tojoin">הצטרפות עם קוד</button><button class="btn primary createbtn" data-act="new">+ צור</button></div>
    </div>
    ${activeGame?`<div class="resume"><span>יש לך משחק פעיל (קוד <b dir="ltr">${esc(activeGame.pin)}</b>). רוצה לחזור אליו?</span><button class="btn primary sm" data-act="resume">חזרה למשחק</button><button class="btn ghost sm" data-act="resume-no">לא, לסגור אותו</button></div>`:''}
    <div class="top"><span class="label">החידונים שלי</span><span class="acct">${cloudBadge()}<span class="muted email" dir="ltr">${esc(user.email||'')}</span><button class="btn sm ghost" data-act="logout">יציאה</button></span></div>
    ${loading?'<div class="empty">טוען את החידונים שלך…</div>':quizzes.length?`<div class="kgrid">${cards}</div>`:`<div class="empty">אין עדיין חידונים.<br>לחץ על "+ צור" כדי לבנות את הראשון, או <button class="btn sm" data-act="sample">הוסף חידון דוגמה</button></div>`}
  </div>`;
}
async function doAuth(email,pw){
  authBusy=true;authMsg='';render();
  try{
    if(authMode==='reset'){await api.resetPassword(email);authMsg='שלחנו קישור לאימייל שלך.';authMode='signin'}
    else if(authMode==='signup'){
      const r=await api.signUp(email,pw);
      if(!r.session){authMsg='שלחנו לך אימייל לאישור החשבון. אחרי האישור אפשר להיכנס.';authMode='signin'}
    } else await api.signIn(email,pw);
  }catch(e){
    const m=String(e&&e.message||'');
    authMsg=/Invalid login/i.test(m)?'האימייל או הסיסמה לא נכונים.':/already registered|already exists/i.test(m)?'כבר יש חשבון עם האימייל הזה. אפשר להיכנס.':/Email not confirmed/i.test(m)?'צריך לאשר את החשבון מהאימייל ששלחנו.':/Password should/i.test(m)?'הסיסמה צריכה להיות לפחות 6 תווים.':/rate limit|too many/i.test(m)?'יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.':'משהו השתבש. בדקו את האינטרנט ונסו שוב.';
  }
  authBusy=false;render();
}

function quizV(){
  const z=findQ(view.id);
  const qs=z.questions.map((q,i)=>`<li><span class="qi">${i+1}</span><span class="qq">${esc(q.q||'שאלה בלי טקסט')}</span><span class="muted qa">${esc(q.correct.map(j=>q.answers[j]).filter(Boolean).join(' / '))}</span></li>`).join('');
  return `<div class="wrap wide">
    <div class="top">${cloudBadge()}<button class="xbtn" data-act="home" aria-label="סגירה וחזרה למסך הבית">✕</button></div>
    <div class="qdetail">
      <div class="kart big">${quizArt(z)}</div>
      <div class="qinfo">
        <h2>${esc(z.title||'חידון ללא שם')}</h2>
        ${view.err?`<div class="warn">${esc(view.err)}</div>`:''}
        <span class="muted">${z.questions.length} שאלות · ${Math.round(z.questions.reduce((s,q)=>s+q.time,0)/60*10)/10} דק׳ משחק</span>
        <button class="btn primary hostbtn" data-act="play" data-id="${z.id}">Host live ▶</button>
        <div class="lacts">
          <button class="btn" data-act="edit" data-id="${z.id}">עריכה</button>
          ${canUpload()?`<label class="btn">📷 ${z.cover?'החלפת תמונה':'העלאת תמונה אמיתית'}<input type="file" id="coverfile" accept="image/png,image/jpeg,image/gif,image/webp" hidden></label>`:''}
          <button class="btn ghost" data-act="one" data-id="${z.id}">משחק על מסך אחד</button>
          <button class="btn ghost" data-act="setupq" data-id="${z.id}">הגדרות משחק</button>
          <button class="btn ghost" data-act="dup" data-id="${z.id}">שכפול</button>
        </div>
        ${confirmDel===z.id?`<div class="confirm">למחוק את החידון לתמיד? <button class="btn sm danger" data-act="del-yes" data-id="${z.id}">מחיקה</button><button class="btn sm ghost" data-act="del-no">ביטול</button></div>`:''}
      </div>
    </div>
    ${qs?`<div class="label">השאלות</div><ol class="qlist">${qs}</ol>`:''}
  </div>`;
}

function editV(){
  const z=findQ(view.id);
  if(view.qi==null||view.qi>=z.questions.length) view.qi=Math.max(0,z.questions.length-1);
  const qi=view.qi,q=z.questions[qi];
  const probs=view.showProbs?problems(z):[];
  const side=z.questions.map((x,i)=>`<button class="slide ${i===qi?'on':''}" data-act="qsel" data-i="${i}" draggable="true" title="גרור כדי להזיז" aria-label="שאלה ${i+1}">
      <span class="sn">${i+1}</span><span class="st">${esc(x.q||'שאלה חדשה')}</span>
      <span class="sd">${[0,1,2,3].map(j=>`<i class="c${j} ${x.answers[j]&&x.answers[j].trim()?'':'off'}">${(x.correct||[]).includes(j)?'✓':''}</i>`).join('')}</span></button>`).join('');
  return `<div class="editor">
    <div class="etop">
      <button class="btn ghost" data-act="open" data-id="${z.id}">→ חזרה</button>
      <span class="titlewrap"><input class="in etitle" id="ztitle" data-f="title" value="${esc(z.title)}" placeholder="שם החידון"><button class="tsave${titleSaved?' done':''}" id="tsave" data-act="savenow" data-id="${z.id}">שמור</button></span>
      <span class="muted savest" id="savest">${esc(saveMsg||'נשמר בחשבון שלך')}</span>
      <button class="btn primary" data-act="play" data-id="${z.id}">Host live ▶</button>
    </div>
    ${probs.length?`<div class="warn"><b>צריך לתקן לפני שמתחילים:</b><ul>${probs.map(p=>`<li>${esc(p)}</li>`).join('')}</ul></div>`:''}
    <div class="ebody">
      <aside class="slides">${side}<div class="addwrap"><button class="slide add" data-act="qaddmenu" aria-expanded="${!!view.addMenu}">+ שאלה</button>${view.addMenu?`<div class="addmenu"><button class="btn" data-act="qadd" data-t="quiz">חידון · 4 תשובות</button><button class="btn" data-act="qadd" data-t="tf">נכון / לא נכון</button></div>`:''}</div></aside>
      ${q?`<section class="ecanvas">
        <div class="eopts">
          <span class="qnum">שאלה ${qi+1}</span>
          <select class="in sm" id="tm-${qi}" data-f="time" data-i="${qi}" aria-label="זמן לשאלה">${[5,10,20,30,60,90].map(t=>`<option value="${t}" ${q.time===t?'selected':''}>⏱ ${t} שניות</option>`).join('')}</select>
          <span class="grow"></span>
          <button class="btn sm ghost" data-act="up" data-i="${qi}" ${qi===0?'disabled':''} aria-label="הזזה אחורה">↑</button>
          <button class="btn sm ghost danger" data-act="qdel" data-i="${qi}">מחיקה</button>
        </div>
        <textarea class="qbox" id="qt-${qi}" data-f="q" data-i="${qi}" placeholder="כתוב כאן את השאלה" rows="2">${esc(q.q)}</textarea>
        <div class="media" id="media-${qi}" data-i="${qi}">
          ${q.img&&q.img.url?`<img src="${esc(q.img.url)}" alt=""><div class="mtools">${canUpload()?`<label class="btn sm">החלפת תמונה<input type="file" class="qimgfile" data-i="${qi}" accept="image/png,image/jpeg,image/gif,image/webp" hidden></label>`:''}<button class="btn sm danger" data-act="qimgrm" data-i="${qi}">הסרה</button></div>`
          :canUpload()?`<label class="mdrop"><span class="mplus">+</span><b>הוספת תמונה לשאלה</b><span class="muted">לחץ כאן או גרור תמונה לתוך המלבן</span><input type="file" class="qimgfile" data-i="${qi}" accept="image/png,image/jpeg,image/gif,image/webp" hidden></label>`
          :`<div class="mdrop"><b>תמונה לשאלה</b><span class="muted">צריך להיות מחוברים כדי להוסיף תמונה</span></div>`}
          ${mediaMsg?`<span class="mmsg">${esc(mediaMsg)}</span>`:''}
        </div>
        <div class="agrid ${q.type==='tf'?'tf':''}">${(q.type==='tf'?[0,1]:[0,1,2,3]).map(j=>`
          <div class="acard k${j} ${q.type==='tf'||q.answers[j].trim()?'filled':''} ${q.correct.includes(j)?'is-correct':''}">
            <span class="astrip c${j}">${q.type==='tf'?(j===0?'✓':'✗'):LET[j]}</span>
            ${view.showProbs&&q.type!=='tf'&&!q.answers[j].trim()?`<span class="amiss">עוד לא הוספת את תשובה ${j+1}</span>`:''}
            ${q.type==='tf'?`<span class="afixed">${j===0?'נכון':'לא נכון'}</span>`:`<input id="a-${qi}-${j}" data-f="a" data-i="${qi}" data-j="${j}" value="${esc(q.answers[j])}" placeholder="תשובה ${j+1}" aria-label="תשובה ${j+1}">`}
            <button class="okdot" data-act="corr" data-i="${qi}" data-j="${j}" aria-pressed="${q.correct.includes(j)}" aria-label="סימון כתשובה נכונה">✓</button>
          </div>`).join('')}</div>
        <p class="muted" style="margin:0;font-size:14px">${q.type==='tf'?'לחץ על ✓ ליד התשובה הנכונה.':'כל 4 התשובות חובה. לחץ על ✓ כדי לסמן את התשובה הנכונה, אפשר יותר מאחת.'}</p>
      </section>`:`<section class="ecanvas"><div class="empty">אין שאלות. לחץ "+ שאלה".</div></section>`}
    </div>
  </div>`;
}

function setupV(){
  const z=findQ(view.id);
  const n=validQs(z).length;
  if(!setupPin) setupPin=S.pin||newPin();
  return `<div class="wrap" style="max-width:680px">
    <div class="top"><button class="btn ghost" data-act="home">→ לכל החידונים</button></div>
    <div class="panel">
      <div class="label">מתחילים</div>
      <h2 style="font-size:32px">${esc(z.title||'חידון ללא שם')}</h2>
      <p class="muted" style="margin:0">${n} שאלות במשחק</p>
      ${view.err?`<div class="warn">${esc(view.err)}</div>`:''}
      <div class="modes">
        <button class="mode" data-act="live"><b>📱 משחק חי עם טלפונים</b><span class="muted">המסך הזה מציג את השאלות וכל משתתף עונה מהטלפון שלו: סורקים QR או מקלידים קוד.</span></button>
        <button class="mode" data-act="start"><b>🖥 משחק על מסך אחד</b><span class="muted">כולם עונים על אותו מסך, כל אחד בתורו. בלי טלפונים.</span></button>
      </div>
      <label class="field"><span class="label">קוד למשחק החי הזה</span>
        <input class="in pin-in" id="livepin" inputmode="numeric" maxlength="6" autocomplete="off" value="${esc(setupPin)}">
        <span class="muted" style="font-size:14px">מי שמקליד את הקוד הזה בטלפון מצטרף למשחק. במשחקים הבאים יופיע קוד חדש, ואפשר לשנות אותו כאן.</span></label>
      <div class="field">
        <span class="label">משתתפים למשחק על מסך אחד</span>
        <div class="chips">${S.players.length?S.players.map((p,i)=>`<span class="chip">${esc(p)}<button data-act="prem" data-i="${i}" aria-label="הסרת ${esc(p)}">×</button></span>`).join(''):'<span class="muted">בלי משתתפים משחקים לבד, בתור "אני".</span>'}</div>
        <form class="addrow" id="padd"><input class="in" id="pname" placeholder="שם משתתף או קבוצה" maxlength="24" autocomplete="off"><button class="btn" type="submit">הוספה</button></form>
      </div>
      ${musicHTML()}
      <div class="toggle"><div><b>מעבר אוטומטי</b><div class="muted" style="font-size:14px">אחרי כל שאלה עוברים לבד לתוצאות ולשאלה הבאה</div></div><button class="switch" role="switch" aria-checked="${S.auto}" data-act="t-auto" aria-label="מעבר אוטומטי"></button></div>
      <div class="toggle"><div><b>צלילים</b><div class="muted" style="font-size:14px">תקתוק בשניות האחרונות וצליל בחשיפת התשובה</div></div><button class="switch" role="switch" aria-checked="${S.sound}" data-act="t-sound" aria-label="צלילים"></button></div>
    </div>
  </div>`;
}

/* ---------- sound ---------- */
let AC=null;
function beep(f,d,type,vol){
  if(!S.sound) return;
  try{
    AC=AC||new (window.AudioContext||window.webkitAudioContext)();
    const o=AC.createOscillator(),g=AC.createGain();
    o.type=type||'sine';o.frequency.value=f;
    o.connect(g);g.connect(AC.destination);
    const t=AC.currentTime;g.gain.setValueAtTime(vol||.08,t);g.gain.exponentialRampToValueAtTime(.0001,t+d);
    o.start(t);o.stop(t+d);
  }catch(e){}
}
const chime=()=>{beep(660,.15,'triangle',.1);setTimeout(()=>beep(880,.25,'triangle',.1),120)};

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

function drawLobby(){
  const cv=$('#lcanvas');if(!cv) return;
  const ctx=cv.getContext('2d');
  const css=getComputedStyle(document.documentElement);
  const cols=['--a0','--a1','--a2','--a3'].map(v=>css.getPropertyValue(v).trim());
  const still=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W=0,H=0,dpr=Math.min(2,window.devicePixelRatio||1);
  const shapes=Array.from({length:26},(_,k)=>({k:k%4,x:Math.random(),y:Math.random(),s:14+Math.random()*34,v:.00025+Math.random()*.0006,r:Math.random()*6,vr:(Math.random()-.5)*.01,a:.35+Math.random()*.45}));
  const t0=performance.now();
  function size(){const r=cv.getBoundingClientRect();W=r.width;H=r.height;cv.width=W*dpr;cv.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0)}
  function shape(sh){
    ctx.save();ctx.translate(sh.x*W,sh.y*H);ctx.rotate(sh.r);ctx.globalAlpha=sh.a;ctx.fillStyle=cols[sh.k];
    const s=sh.s;ctx.beginPath();
    if(sh.k===0){for(let i=0;i<5;i++){const a=i*Math.PI*2/5-Math.PI/2,b=a+Math.PI/5;ctx.lineTo(Math.cos(a)*s,Math.sin(a)*s);ctx.lineTo(Math.cos(b)*s*.45,Math.sin(b)*s*.45)}}
    else if(sh.k===1){ctx.arc(0,0,s*.7,0,Math.PI*2)}
    else if(sh.k===2){ctx.moveTo(0,-s*.8);ctx.lineTo(s*.8,0);ctx.lineTo(0,s*.8);ctx.lineTo(-s*.8,0)}
    else{const r=s*.25,w=s*1.2;ctx.roundRect?ctx.roundRect(-w/2,-w/2,w,w,r):ctx.rect(-w/2,-w/2,w,w)}
    ctx.closePath();ctx.fill();ctx.restore();
  }
  function frame(now){
    if(!cv.isConnected) return;
    const t=(now-t0)/1000;
    if(cv.getBoundingClientRect().width!==W) size();
    ctx.clearRect(0,0,W,H);
    // spotlights
    [[.22,0],[.78,1]].forEach(([x,ph])=>{
      const sw=Math.sin(t*.5+ph*2)*.12;
      const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'rgba(255,214,120,.22)');g.addColorStop(1,'rgba(255,214,120,0)');
      ctx.fillStyle=g;ctx.beginPath();ctx.moveTo(x*W-10,0);ctx.lineTo(x*W+10,0);ctx.lineTo((x+sw)*W+W*.16,H);ctx.lineTo((x+sw)*W-W*.16,H);ctx.closePath();ctx.fill();
    });
    // stage floor
    const fy=H*.72;const g2=ctx.createLinearGradient(0,fy,0,H);g2.addColorStop(0,'rgba(47,111,224,.18)');g2.addColorStop(1,'rgba(47,111,224,0)');
    ctx.fillStyle=g2;ctx.beginPath();ctx.ellipse(W/2,fy+20,W*.42,H*.1,0,0,Math.PI*2);ctx.fill();
    shapes.forEach(sh=>{if(!still){sh.y-=sh.v;sh.r+=sh.vr;if(sh.y<-.08){sh.y=1.08;sh.x=Math.random()}}shape(sh)});
    if(!still) requestAnimationFrame(frame);
  }
  size();requestAnimationFrame(frame);
}
function stageTop(){
  const q=G.qs[G.i];
  return `<div class="hconn" id="hconn" hidden></div><div class="sbar">
    <span class="pill">שאלה ${G.i+1} / ${G.qs.length}</span>
    <span class="pill">${G.live?`קוד: <span dir="ltr">${G.pin}</span>`:q.points===2?'ניקוד כפול':q.points===0?'בלי ניקוד':esc(G.quiz.title)}</span>
    <div class="controls">
      ${S.music!=='off'?`<button class="btn sm ghost mutebtn" data-act="mute" aria-label="${M.kind?'השתקת מוזיקה':'הפעלת מוזיקה'}">${M.kind?'🔊':'🔇'}</button>`:''}
      ${G.phase==='question'?`<button class="btn sm" data-act="pause">${G.paused?'המשך':'השהיה'}</button>`:''}
      ${G.phase==='reveal'||G.phase==='board'?`<button class="btn primary" data-act="next">הבא ←</button>`:G.phase!=='final'&&G.phase!=='lobby'?`<button class="btn sm ghost" data-act="next">דלג ←</button>`:''}
    </div>
  </div>`;
}
function whoHTML(){
  if(G.live||G.players.length<2) return '';
  return `<div class="who" id="who"><div class="hint">עכשיו עונה: <b>${esc(G.players[G.cur].name)}</b> · אפשר ללחוץ על שם כדי להחליף</div>
  <div class="chips">${G.players.map((p,k)=>`<button class="pchip ${k===G.cur?'cur':''} ${p.key in G.ans?'done':''}" data-act="pick" data-i="${k}">${esc(p.name)}</button>`).join('')}</div></div>`;
}
function renderWho(){
  const w=$('#who');if(w) w.outerHTML=whoHTML();
  const c=$('#acount');if(c) c.textContent=Object.keys(G.ans).length;
}
function avHTML(i,cls){i=((+i)||0)%AVS.length;return `<span class="av ${cls||''}" style="background:hsl(${i*30+10} 75% 88%)">${AVS[i]}</span>`}
function tilesHTML(reveal){
  const q=G.qs[G.i];
  const view=G.live&&!reveal;
  return `<div class="tiles">${q.answers.map((a,j)=>a.trim()?`
    <button class="tile c${j} ${reveal&&!q.correct.includes(j)?'dim':''}" data-act="ans" data-j="${j}" ${reveal||view?'disabled':''}>
      ${reveal?`<span class="tmark">${q.correct.includes(j)?'✓':'✕'}</span>`:`<span class="L">${LET[j]}</span>`}
      <span class="t">${esc(a)}</span>
      ${reveal?`<span class="L small">${LET[j]}</span>`:''}
    </button>`:'').join('')}</div>`;
}
function barsHTML(){
  const q=G.qs[G.i];
  const idx=q.answers.map((a,j)=>j).filter(j=>q.answers[j]&&q.answers[j].trim());
  const counts=idx.map(j=>G.players.filter(p=>p.choice===j).length);
  const mx=Math.max(1,...counts);
  return `<div class="bars">${idx.map((j,k)=>`<div class="bcol"><div class="bar c${j}" style="height:${Math.max(3,Math.round(counts[k]/mx*100))}%"></div><div class="blab c${j}"><b>${LET[j]}</b> ${counts[k]} ${q.correct.includes(j)?'✓':''}</div></div>`).join('')}</div>`;
}
function boardRows(list,from){return list.map((p,i)=>`<div class="brow ${i===0&&!from?'first':''}" style="animation-delay:${i*.08}s"><span class="r">${i+1+(from||0)}</span>${avHTML(p.av,'sm')}<span class="nm">${esc(p.name)}</span><span class="sc">${fmt(p.score)}${p.gain&&G.phase==='board'?`<span class="d" dir="ltr">+${p.gain}</span>`:''}</span></div>`).join('')}
function ranked(){return G.players.filter(p=>!p.left||p.score>0).sort((a,b)=>b.score-a.score)}
function renderGame(){
  if(!G) return;
  const app=$('#app');
  const q=G.qs[G.i];
  let h='';
  if(G.phase==='lobby'){
    h=`<div class="lobby"><canvas id="lcanvas" aria-hidden="true"></canvas>
      <div class="joinband"><div class="jinfo"><div class="jtxt">סרקו את הקוד עם המצלמה, או היכנסו ל־<b dir="ltr">${esc(location.host)}</b> והקלידו:</div><div class="label" style="color:#6b6080">קוד המשחק</div><div class="pin">${G.pin}</div></div><div class="qr" id="qrbox" aria-label="קוד QR להצטרפות">${G.qr||''}</div></div>
      <div class="hconn" id="hconn" hidden></div>
      <div class="ltop">
        <span class="lcount" id="lcount"></span>
        <div class="lacts">
          ${S.music!=='off'?`<button class="btn sm ghost mutebtn" data-act="mute" aria-label="${M.kind?'השתקת מוזיקה':'הפעלת מוזיקה'}">${M.kind?'🔊':'🔇'}</button>`:''}
          <button class="btn sm ghost" data-act="settings">הגדרות</button>
          <button class="btn primary startbtn" id="startbtn" data-act="next">התחל ▶</button>
        </div>
      </div>
      <div class="lmid"><h2>${esc(G.quiz.title||'חידון')}</h2></div>
      <div class="lnames" id="lnames"></div>
    </div>`;
  } else if(G.phase==='intro'){
    h=`<div class="stage">${stageTop()}<div class="center">
      <div class="label">שאלה ${G.i+1} מתוך ${G.qs.length}</div>
      <div class="intro-card"><div class="intro-q">${esc(q.q)}</div></div>
      <div class="introbar"><i style="animation-duration:${INTRO_MS/1000}s"></i></div>
    </div></div>`;
  } else if(G.phase==='question'){
    const r=remaining(),sec=Math.ceil(r/1000);
    const total=G.live?activePlayers().filter(isHere).length:G.players.length;
    h=`<div class="stage">${stageTop()}
      <div class="qtext">${esc(q.q)}</div>
      <div class="tbar"><i id="tbar" style="transform:scaleX(${r/(q.time*1000)})"></i></div>
      <div class="qmid">
        <div class="answered"><span class="cnt-circle" id="acount">${Object.keys(G.ans).length}</span><span class="muted">${G.live?`ענו מתוך <span id="atotal">${total}</span>`:'ענו'}</span></div>
        <div class="qcenter">${q.img&&q.img.url?`<img class="qimg" src="${esc(q.img.url)}" alt="">`:(whoHTML()||'')}</div>
        <div class="ring ${sec<=5?'hot':''}" id="ring"><svg width="110" height="110" viewBox="0 0 110 110"><circle cx="55" cy="55" r="48" fill="none" stroke="var(--surface)" stroke-width="9"/><circle id="tarc" cx="55" cy="55" r="48" fill="none" stroke="var(--spot)" stroke-width="9" stroke-linecap="round" stroke-dasharray="302" stroke-dashoffset="${302*(1-r/(q.time*1000))}"/></svg><span class="n" id="tn">${sec}</span></div>
      </div>
      ${q.img&&q.img.url?whoHTML():''}
      ${tilesHTML(false)}
    </div>
    ${G.paused?`<div class="paused"><div class="box"><h2 style="font-size:36px">מושהה</h2><p class="muted" style="margin:0">הטיימר עצר. נשארו ${sec} שניות.</p><button class="btn primary big" data-act="pause">המשך</button></div></div>`:''}`;
  } else if(G.phase==='reveal'){
    const solo=G.players.length===1&&!G.live,p0=G.players[0];
    h=`<div class="stage">${stageTop()}
      <div class="qtext">${esc(q.q)}</div>
      ${solo?`<div class="center" style="flex:none;gap:6px"><h2 style="font-size:40px;color:${q.correct.includes(p0.choice)?'var(--ok)':'var(--bad)'}">${p0.choice===null?'הזמן נגמר':q.correct.includes(p0.choice)?'נכון!':'לא הפעם'}</h2><span class="muted">+${p0.gain} נקודות · סה״כ ${fmt(p0.score)}</span></div>`
        :(G.showImg&&q.img&&q.img.url?`<img class="qimg" src="${esc(q.img.url)}" alt="">`:barsHTML())}
      ${q.img&&q.img.url&&!solo?`<div class="controls"><button class="btn sm" data-act="toggleimg">${G.showImg?'הצג תוצאות':'🖼 הצג תמונה'}</button></div>`:''}
      ${tilesHTML(true)}
      ${S.auto?'<div class="hint">ממשיכים אוטומטית בעוד רגע</div>':''}
    </div>`;
  } else if(G.phase==='board'){
    const rk=ranked(),r=rk.slice(0,5);
    const best=rk.slice().sort((a,b)=>(b.streak||0)-(a.streak||0))[0];
    h=`<div class="stage">${stageTop()}<div class="center">
      <h2 style="font-size:40px">טבלת הניקוד</h2>
      <div class="board">${boardRows(r)}</div>
      ${best&&best.streak>=3?`<div class="streak"><span style="font-size:28px">🔥</span><span><b>${esc(best.name)}</b> עם רצף התשובות הנכונות הארוך ביותר: ${best.streak}!</span>${avHTML(best.av,'sm')}</div>`:''}
    </div></div>`;
  } else if(G.phase==='final'){
    const r=ranked();
    const solo=G.players.length===1&&!G.live;
    const max=G.qs.reduce((s,q)=>s+1000*q.points,0);
    const pod=[r[1],r[0],r[2]];
    h=`<div class="stage"><div class="center">
      <div class="label">סוף המשחק</div>
      <h2 style="font-size:clamp(34px,6vw,56px)">${esc(G.quiz.title)}</h2>
      ${solo?`<div class="intro-n">${fmt(r[0].score)}</div><p class="muted" style="margin:0">נקודות מתוך ${fmt(max)} אפשריות</p>`
      :`<div class="podium">${pod.map((p,i)=>p?`<div class="pod p${[2,1,3][i]}">${avHTML(p.av,'big2')}<span class="nm">${esc(p.name)}</span><div class="blk"><b>${[2,1,3][i]}</b><span>${fmt(p.score)}</span></div></div>`:'<div class="pod"></div>').join('')}</div>
        ${r.length>3?`<div class="board">${boardRows(r.slice(3,8),3)}</div>`:''}`}
      <div class="controls"><button class="btn primary big" data-act="again">משחק חוזר</button><button class="btn big" data-act="home">לכל החידונים</button></div>
    </div></div>`;
  }
  app.innerHTML=h;
  if(G.phase==='lobby'){updateLobby();drawLobby();drawQR()}
  connBadge();
}

function joinURL(){return location.origin+'/?pin='+(G&&G.pin)}
function drawQR(){
  if(!G||!G.live) return;
  if(G.qr){const b=$('#qrbox');if(b&&!b.innerHTML)b.innerHTML=G.qr;return}
  const pin=G.pin;
  QRCode.toString(joinURL(),{type:'svg',margin:1,errorCorrectionLevel:'M',color:{dark:'#1b0b3a',light:'#ffffff'}}).then(svg=>{if(G&&G.pin===pin){G.qr=svg;const b=$('#qrbox');if(b)b.innerHTML=svg}}).catch(()=>{});
}
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

/* ---------- events ---------- */
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-act]');if(!b) return;
  touched=true;
  const a=b.dataset.act,id=b.dataset.id,i=+b.dataset.i,j=+b.dataset.j;
  const z=view.id&&findQ(view.id);
  switch(a){
    case 'home': musicStop();stopGame();leavePlayer();setupPin='';go({name:'home'});break;
    case 'logout': flushAll();api.signOut();quizzes=[];user=null;activeGame=null;go({name:'home'});break;
    case 'amode': authMode=b.dataset.m;authMsg='';render();break;
    case 'google': api.signInGoogle().catch(()=>{authMsg='הכניסה עם Google לא הצליחה.';render()});break;
    case 'resume': {const g=activeGame;activeGame=null;if(g){musicStop();ensureAC();unlockSongs();startLive(g.quiz_id,g)}break}
    case 'resume-no': {const g=activeGame;activeGame=null;if(g)api.endGame(g.pin);render();break}
    case 'tojoin': go({name:'join'});break;
    case 'new': {const nz={id:newId(),title:'',questions:[blankQ()]};addQuiz(nz);go({name:'edit',id:nz.id,qi:0});setTimeout(()=>{const t=$('#ztitle');t&&t.focus()},0);break}
    case 'sample': addQuiz(sample());render();break;
    case 'edit': saveMsg='';go({name:'edit',id,qi:0});break;
    case 'open': saveMsg='';go({name:'quiz',id});break;
    case 'setupq': go({name:'setup',id});break;
    case 'one': {const pz=findQ(id);if(problems(pz).length){go({name:'edit',id,qi:0,showProbs:true});break}musicStop();ensureAC();unlockSongs();startLocal(id);break}
    case 'qsel': view.qi=i;render();setTimeout(()=>{const t=$('#qt-'+i);t&&t.focus()},0);break;
    case 'coverrm': {const cz=findQ(view.id);if(cz.cover){const old=cz.cover.id;cz.cover=null;persist(cz);api.deleteFile(old)}render();break}
    case 'dup': {const s=findQ(id),c=JSON.parse(JSON.stringify(s));c.id=newId();if(c.cover)c.cover=null;c.title=(s.title||'חידון')+' (עותק)';addQuiz(c);render();break}
    case 'delhome': if(confirmDel===id){removeQuiz(id);confirmDel=null}else confirmDel=id;render();break;
    case 'del': confirmDel=id;render();break;
    case 'del-no': confirmDel=null;render();break;
    case 'del-yes': removeQuiz(id);confirmDel=null;go({name:'home'});break;
    case 'play': {const pz=findQ(id);if(problems(pz).length){go({name:'edit',id,qi:0,showProbs:true});break}musicStop();ensureAC();unlockSongs();startLive(id);break}
    case 'settings': {const qid=G.quiz.id;if(G.live)setupPin=G.pin||'';stopGame(false);go({name:'setup',id:qid});break}
    case 'qaddmenu': view.addMenu=!view.addMenu;render();break;
    case 'qadd': {const nq=blankQ();if(b.dataset.t==='tf'){nq.type='tf';nq.answers=['נכון','לא נכון','',''];nq.correct=[0]}z.questions.push(nq);view.addMenu=false;view.qi=z.questions.length-1;persist(z);render();setTimeout(()=>{const t=$('#qt-'+view.qi);t&&t.focus()},0);break}
    case 'qdel': z.questions.splice(i,1);view.qi=Math.max(0,i-1);persist(z);render();break;
    case 'qdup': z.questions.splice(i+1,0,JSON.parse(JSON.stringify(z.questions[i])));persist(z);render();break;
    case 'up': [z.questions[i-1],z.questions[i]]=[z.questions[i],z.questions[i-1]];view.qi=i-1;persist(z);render();break;
    case 'down': [z.questions[i+1],z.questions[i]]=[z.questions[i],z.questions[i+1]];view.qi=i+1;persist(z);render();break;
    case 'corr': {const q=z.questions[i];if(q.type==='tf')q.correct=[j];else q.correct=q.correct.includes(j)?q.correct.filter(x=>x!==j):[...q.correct,j];persist(z);render();break}
    case 'qimgrm': {const q=z.questions[i];if(q.img){const old=q.img.id;q.img=null;persist(z);api.deleteFile(old)}render();break}
    case 'prem': S.players.splice(i,1);saveLocal();render();break;
    case 't-auto': S.auto=!S.auto;saveLocal();render();break;
    case 't-sound': S.sound=!S.sound;saveLocal();render();break;
    case 'start': musicStop();ensureAC();unlockSongs();beep(440,.01,'sine',.001);startLocal(view.id);break;
    case 'mus': S.music=b.dataset.m;musicStop();musicMsg='';saveLocal();render();break;
    case 'srem': removeSong(i);break;
    case 'mprev': if(M.kind){musicStop()}else{musicPlay(S.music==='songs'&&songs.length?'calm':'party');if(S.music==='songs'&&!songs.length){musicStop();musicMsg='הוסף קודם שיר אחד לפחות.'}}render();break;
    case 'mute': if(M.kind){musicStop()}else{musicPlay(G&&G.phase==='question'?'tense':'calm')}renderGame();break;
    case 'live': musicStop();ensureAC();unlockSongs();beep(440,.01,'sine',.001);startLive(view.id);break;
    case 'ans': answerLocal(j);break;
    case 'pick': G.cur=i;renderWho();break;
    case 'next': next();break;
    case 'pause': togglePause();break;
    case 'quit': {const qid=G.quiz.id;stopGame();go({name:'quiz',id:qid});break}
    case 'again': {const qid=G.quiz.id,live=G.live,pin=G.pin;stopGame(false);if(live){setupPin=pin;startLive(qid)}else startLocal(qid);break}
    case 'pans': pickAnswer(j);break;
    case 'xclose': {
      if(view.name==='game'&&G){if($('#leaveask'))break;const o=document.createElement('div');o.id='leaveask';o.innerHTML='<div class="lbox"><h3>לעזוב?</h3><div class="lrow"><button class="lyes" data-act="leave-yes">כן</button><button class="lno" data-act="leave-no">לא</button></div></div>';document.body.appendChild(o)}
      else if(view.name==='player'){leavePlayer();go({name:'home'})}
      else if(view.name==='join'){go({name:'home'})}
      else if(view.name==='setup'&&view.id&&findQ(view.id)) go({name:'quiz',id:view.id});
      else {musicStop();stopGame();leavePlayer();go({name:'home'})}
      break}
    case 'savenow': {const q=findQ(id);if(q){q.updated=Date.now();flush(id)}titleSaved=true;b.classList.add('done');b.textContent='נשמר';break}
    case 'leave-no': {const o=$('#leaveask');o&&o.remove();break}
    case 'leave-yes': {const o=$('#leaveask');o&&o.remove();if(G){const qid=G.quiz.id;stopGame();go({name:'quiz',id:qid})}break}
    case 'pmenu': G.menu=G.menu===b.dataset.k?null:b.dataset.k;G.renaming=null;updateLobby();break;
    case 'pdel': kickPlayer(b.dataset.k);break;
    case 'pren': G.renaming=b.dataset.k;G.menu=null;updateLobby();setTimeout(()=>{const r=$('#rname');if(r){r.focus();r.select()}},0);break;
    case 'prsave': commitRename();break;
    case 'toggleimg': G.showImg=!G.showImg;renderGame();break;
    case 'avopen': PL.avOpen=!PL.avOpen;renderPlayer(true);break;
    case 'avpick': PL.av=i;S.avIdx=i;saveLocal();saveLastGame();api.setAvatar(PL.pin,i);renderPlayer(true);break;
    case 'pleave': leavePlayer();go({name:user?'home':'join'});break;
  }
});
let mediaMsg='';
function uploadQImg(i,f){
  const z=findQ(view.id);if(!z||!user||!f) return;
  mediaMsg='מעלה תמונה…';render();
  api.uploadFile(user.id,f,'image').then(r=>{const q=z.questions[i];const old=q.img&&q.img.id;q.img={id:r.id,url:r.url};persist(z);if(old)api.deleteFile(old);mediaMsg='';render()})
    .catch(err=>{mediaMsg=err&&err.code==='too_large'?'התמונה גדולה מדי (עד 10MB).':err&&err.code==='unsupported_type'?'אפשר להעלות רק PNG, JPG, GIF או WEBP.':'העלאת התמונה נכשלה, נסה שוב.';render()});
}
document.addEventListener('dragover',e=>{const m=e.target.closest&&e.target.closest('.media');if(m){e.preventDefault();m.classList.add('drag')}});
document.addEventListener('dragleave',e=>{const m=e.target.closest&&e.target.closest('.media');if(m)m.classList.remove('drag')});
document.addEventListener('drop',e=>{const m=e.target.closest&&e.target.closest('.media');if(!m)return;e.preventDefault();m.classList.remove('drag');const f=e.dataTransfer&&e.dataTransfer.files[0];if(f&&canUpload())uploadQImg(+m.dataset.i,f)});
(()=>{let from=null;
document.addEventListener('dragstart',e=>{const b=e.target.closest&&e.target.closest('.slide[data-i]');if(!b)return;from=+b.dataset.i;b.classList.add('dragging');try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(from))}catch(_){}});
document.addEventListener('dragover',e=>{const b=e.target.closest&&e.target.closest('.slide[data-i]');if(from===null||!b)return;e.preventDefault();document.querySelectorAll('.slide.over').forEach(x=>x.classList.remove('over'));b.classList.add('over')});
document.addEventListener('dragend',()=>{from=null;document.querySelectorAll('.slide.over,.slide.dragging').forEach(x=>x.classList.remove('over','dragging'))});
document.addEventListener('drop',e=>{const b=e.target.closest&&e.target.closest('.slide[data-i]');if(from===null||!b)return;e.preventDefault();const to=+b.dataset.i,z=view.id&&findQ(view.id);if(z&&to!==from){const[m]=z.questions.splice(from,1);z.questions.splice(to,0,m);view.qi=to;persist(z);}from=null;render()});
})();
document.addEventListener('input',e=>{if(e.target&&e.target.id==='ztitle'&&titleSaved){titleSaved=false;const t=$('#tsave');if(t){t.classList.remove('done');t.textContent='שמור'}}});
document.addEventListener('change',e=>{
  if(e.target.classList.contains('qimgfile')&&e.target.files[0]){uploadQImg(+e.target.dataset.i,e.target.files[0]);return}
  if(e.target.dataset.qtype!==undefined){
    const z=findQ(view.id),q=z.questions[+e.target.dataset.qtype],t=e.target.value;
    if(t==='tf'){q.prevAnswers=q.answers.slice();q.answers=['נכון','לא נכון','',''];q.correct=[q.correct.includes(1)&&!q.correct.includes(0)?1:0]}
    else{q.answers=(q.prevAnswers&&q.prevAnswers.length===4)?q.prevAnswers:['','','',''];q.correct=[0];delete q.prevAnswers}
    q.type=t;persist(z);render();return;
  }
  if(e.target.id==='artsel'){const az=findQ(view.id);az.art=e.target.value;persist(az);render();return}
  if(e.target.id==='coverfile'&&e.target.files&&e.target.files[0]&&user){
    const f=e.target.files[0],cz=findQ(view.id);setSave('מעלה תמונה…');
    api.uploadFile(user.id,f,'image').then(r=>{const old=cz.cover&&cz.cover.id;cz.cover={id:r.id,url:r.url};persist(cz);if(old)api.deleteFile(old);render()})
      .catch(err=>setSave(err&&err.code==='too_large'?'התמונה גדולה מדי (עד 10MB)':err&&err.code==='unsupported_type'?'אפשר להעלות רק PNG, JPG, GIF או WEBP':'העלאת התמונה נכשלה'));
    return;
  }
  if(e.target.id==='musfile'&&e.target.files&&e.target.files.length){touched=true;addSongs(Array.from(e.target.files))}
});
document.addEventListener('input',e=>{
  if(e.target.id==='musvol'){S.vol=+e.target.value;setVol();saveLocal();return}
  if(e.target.id==='livepin'){const v=e.target.value.replace(/\D/g,'').slice(0,6);if(v!==e.target.value)e.target.value=v;if(v.length===6)setupPin=v;return}
  const t=e.target,f=t.dataset.f;if(!f||view.name!=='edit') return;
  const z=findQ(view.id),i=+t.dataset.i;
  if(f==='title') z.title=t.value;
  else if(f==='q') z.questions[i].q=t.value;
  else if(f==='a'){z.questions[i].answers[+t.dataset.j]=t.value;const c=t.closest('.acard');if(c)c.classList.toggle('filled',!!t.value.trim())}
  else if(f==='time') z.questions[i].time=+t.value;
  else if(f==='points') z.questions[i].points=+t.value;
  persist(z);
});
document.addEventListener('submit',e=>{
  e.preventDefault();
  touched=true;
  if(e.target.id==='padd'){
    const v=$('#pname').value.trim();if(!v) return;
    S.players.push(v);saveLocal();render();setTimeout(()=>{const p=$('#pname');p&&p.focus()},0);
  } else if(e.target.id==='authform'){
    const em=$('#aemail').value.trim(),pw=$('#apw')?$('#apw').value:'';
    if(!em) return; doAuth(em,pw);
  } else if(e.target.id==='pwform'){
    const pw=$('#newpw').value;if(pw.length<6){authMsg='הסיסמה צריכה להיות לפחות 6 תווים.';render();return}
    authBusy=true;render();
    api.updatePassword(pw).then(()=>{pwRecovery=false;authMsg='';history.replaceState(null,'',location.pathname)}).catch(()=>{authMsg='לא הצלחנו לשמור את הסיסמה. נסו שוב.'}).finally(()=>{authBusy=false;render()});
  } else if(e.target.id==='jform'){
    const pin=$('#jpin').value.replace(/\D/g,''),nick=$('#jnick').value.trim();
    if(pin.length!==6){view={name:'join',err:'קוד המשחק הוא 6 ספרות.',pin};render();return}
    if(!nick){view={name:'join',err:'כתבו שם כדי שיראו אתכם על המסך.',pin};render();return}
    joinGame(pin,nick);
  }
});
document.addEventListener('keydown',e=>{
  if(view.name!=='game'||!G) return;
  if(e.target.matches('input,textarea,select')) return;
  if(['1','2','3','4'].includes(e.key)) answerLocal(+e.key-1);
  else if(e.key===' '||e.key==='Enter'){if(G.phase!=='question'&&G.phase!=='final'){e.preventDefault();next()}}
  else if(e.key==='p'||e.key==='P'||e.key==='פ') togglePause();
});

function syncX(){
  const x=$('#xclose');if(!x) return;
  const on=view.name!=='home';
  x.hidden=!on;document.documentElement.classList.toggle('hasx',on);
}
new MutationObserver(syncX).observe($('#app'),{childList:true});
syncX();
render();
boot();
})();
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

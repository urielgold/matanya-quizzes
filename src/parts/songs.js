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

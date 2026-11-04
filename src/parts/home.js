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

const {chromium}=require('playwright');
const BASE=process.env.BASE_URL||'http://localhost:5173';
(async()=>{const b=await chromium.launch({proxy:{server:process.env.HTTPS_PROXY,bypass:'localhost,127.0.0.1'}});
const h=await (await b.newContext({viewport:{width:1366,height:820}})).newPage();
await h.goto(BASE+'/');await h.waitForSelector('#aemail,.kgrid',{timeout:30000});
if(await h.$('#aemail')){await h.fill('#aemail','test-host@matanya.test');await h.fill('#apw','TestHost!2026');await h.click('#authform button[type=submit]');}
await h.waitForSelector('.kgrid',{timeout:30000});
await h.locator('.kcard',{hasText:'טריוויה כללית (דוגמה)'}).first().locator('.ktitle').click();
await h.click('.hostbtn');await h.waitForSelector('.joinband .pin',{timeout:20000});
const pin=(await h.textContent('.joinband .pin')).trim();
const N=+process.env.N||5;const rows=[];
const ctxs=await Promise.all(Array.from({length:N},()=>b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})));
await Promise.all(ctxs.map(async(c,k)=>{
  const p=await c.newPage();
  const t0=Date.now();await p.goto(`${BASE}/?pin=${pin}`);await p.waitForSelector('#jnick',{timeout:30000});
  const tForm=Date.now()-t0;
  const nick='T'+k+Date.now().toString(36).slice(-3);
  await p.fill('#jnick',nick);
  const t1=Date.now();await p.click('#jform button[type=submit]');
  await p.waitForFunction(()=>/הצטרפת|מחכים|ממתינים|המשחק יתחיל/.test(document.body.innerText),null,{timeout:30000}).catch(()=>{});
  const tPhone=Date.now()-t1;
  await h.waitForFunction(n=>document.body.innerText.includes(n),nick,{timeout:15000}).catch(async()=>{console.log('MISSING',nick,'| phone:',(await p.textContent('body')).slice(0,160).replace(/\s+/g,' '),'| host lobby:',(await h.locator('#lnames').textContent().catch(()=>'-')).slice(0,160));throw new Error('host missed '+nick)});
  rows.push({k,formReady:tForm,phoneConfirm:tPhone,hostSees:Date.now()-t1});
}));
console.log(JSON.stringify(rows));
const avg=f=>Math.round(rows.reduce((a,r)=>a+r[f],0)/rows.length);
console.log('avg form ready',avg('formReady'),'ms | avg phone confirm',avg('phoneConfirm'),'ms | avg host sees',avg('hostSees'),'ms');
await b.close();})().catch(e=>{console.error('FAIL',e.message.slice(0,300));process.exit(1)});

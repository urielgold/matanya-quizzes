const {chromium}=require('playwright');const {PNG}=require('pngjs');const jsQR=require('jsqr');
const BASE='http://localhost:5173';
function decode(buf){const png=PNG.sync.read(buf);const r=jsQR(new Uint8ClampedArray(png.data),png.width,png.height);return r?r.data:null}
(async()=>{
 const b=await chromium.launch({proxy:{server:process.env.HTTPS_PROXY,bypass:'localhost,127.0.0.1'}});
 const h=await b.newContext({viewport:{width:1366,height:820},deviceScaleFactor:2});const host=await h.newPage();
 await host.goto(BASE+'/');await host.waitForSelector('#aemail,.kgrid',{timeout:20000});
 if(await host.$('#aemail')){await host.fill('#aemail','test-host@matanya.test');await host.fill('#apw','TestHost!2026');await host.click('#authform button[type=submit]');}
 await host.waitForSelector('.kgrid',{timeout:20000});
 await host.locator('.kcard',{hasText:'טריוויה כללית (דוגמה)'}).first().locator('.ktitle').click();
 await host.click('.hostbtn');await host.waitForSelector('#qrbox svg',{timeout:10000});
 await host.waitForTimeout(500);
 const pin=(await host.textContent('.joinband .pin')).trim();
 const lobbyQR=decode(await host.locator('#qrbox').screenshot());
 console.log('lobby QR decodes to:',lobbyQR,'| expected suffix ?pin='+pin, lobbyQR&&lobbyQR.endsWith('?pin='+pin)?'OK':'MISMATCH');
 // phone joins by scanning the decoded link
 const pc=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const ph=await pc.newPage();
 await ph.goto(lobbyQR.replace(/^https?:\/\/[^/]+/,BASE));await ph.waitForSelector('#jnick');
 await ph.fill('#jnick','בודק QR');await ph.click('#jform button[type=submit]');
 await host.waitForFunction(()=>document.body.innerText.includes('בודק QR'),null,{timeout:15000});
 console.log('phone joined via decoded QR link: OK');
 await host.click('[data-act=start]').catch(async()=>{await host.click('text=התחל')});
 await host.waitForSelector('#qrbox2 svg',{timeout:20000});
 await host.waitForTimeout(800);
 const gameQR=decode(await host.locator('#qrbox2').screenshot());
 console.log('in-game QR decodes to:',gameQR,gameQR===lobbyQR?'OK (same link)':'MISMATCH');
 // a late phone scans the in-game code
 const lc=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const lp=await lc.newPage();
 await lp.goto(gameQR.replace(/^https?:\/\/[^/]+/,BASE));await lp.waitForSelector('#jnick');
 await lp.fill('#jnick','מאחר QR');await lp.click('#jform button[type=submit]');
 await lp.waitForFunction(()=>/באמצע המשחק|הקוד שלך|שאלה/.test(document.body.innerText),null,{timeout:15000});
 console.log('late phone joined via in-game QR: OK');
 await b.close();
})().catch(e=>{console.error('FAIL',e.message.slice(0,300));process.exit(1)});

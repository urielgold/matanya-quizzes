// End-to-end test: 1 host screen + N phones play a full live game against the real Supabase project.
// Usage: BASE_URL=http://localhost:5173 HOST_EMAIL=... HOST_PASSWORD=... PLAYERS=20 node tests/live-game.cjs
// Requires the `playwright` package (npm i -D playwright && npx playwright install chromium).
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const N = +(process.env.PLAYERS || 20);
const EMAIL = process.env.HOST_EMAIL || 'test-host@matanya.test';
const PASS = process.env.HOST_PASSWORD || 'TestHost!2026';
const QUIZ_TITLE = process.env.QUIZ_TITLE || 'טריוויה כללית (דוגמה)';
const CORRECT = [1, 1, 2, 1, 0, 1]; // sample quiz answers
const sleep = ms => new Promise(r => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const problems = [];
const fail = m => { problems.push(m); console.log('  ✗', m); };

function launchOpts() {
  return process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } } : {};
}
async function text(page, sel) { try { return (await page.textContent(sel, { timeout: 1000 })) || ''; } catch (e) { return ''; } }
async function waitText(page, re, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (re.test(t)) return t;
    await sleep(150);
  }
  throw new Error('timeout waiting for ' + re);
}

(async () => {
  const browser = await chromium.launch(launchOpts());
  const errors = [];
  const watch = (page, who) => {
    page.on('pageerror', e => errors.push(`${who}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_INTERNET_DISCONNECTED|net::ERR|WebSocket|Failed to fetch|Load failed/.test(m.text())) errors.push(`${who} console: ${m.text().slice(0, 200)}`); });
  };

  /* ---------- host ---------- */
  const hostCtx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  const host = await hostCtx.newPage(); watch(host, 'host');
  await host.goto(BASE + '/');
  await host.waitForSelector('#aemail, .kgrid', { timeout: 20000 });
  if (await host.$('#aemail')) {
    await host.fill('#aemail', EMAIL); await host.fill('#apw', PASS);
    await host.click('#authform button[type=submit]');
  }
  await host.waitForSelector('.kgrid', { timeout: 20000 });
  log('host signed in');
  if ((await host.locator('.kcard', { hasText: QUIZ_TITLE }).count()) === 0) {
    // the sample quiz is missing from the test account: import the fixture quiz
    await host.setInputFiles('#impfile', require('path').join(__dirname, 'fixtures', 'sample-quiz.json'));
    await host.waitForTimeout(2500);
    await host.goto(BASE + '/');
    await host.waitForSelector('.kgrid', { timeout: 20000 });
  }
  const card = host.locator('.kcard', { hasText: QUIZ_TITLE }).first();
  await card.locator('.ktitle').click();
  await host.click('.hostbtn');
  await host.waitForSelector('.joinband .pin', { timeout: 20000 });
  const pin = (await text(host, '.joinband .pin')).trim();
  await host.waitForSelector('#qrbox svg', { timeout: 10000 });
  log('lobby open, pin', pin, '(QR shown)');

  /* ---------- phones ---------- */
  const phones = [];
  const joinOne = async k => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage(); watch(page, 'p' + k);
    const name = 'שחקן ' + (k + 1);
    if (k % 2 === 0) await page.goto(`${BASE}/?pin=${pin}`); // via QR link
    else { await page.goto(BASE + '/'); await page.click('[data-act=tojoin]'); await page.fill('#jpin', pin); }
    await page.waitForSelector('#jnick');
    await page.fill('#jnick', name);
    await page.click('#jform button[type=submit]');
    await waitText(page, /נכנסת!/, 25000);
    phones.push({ k, ctx, page, name, answers: {} });
  };
  const tj = Date.now();
  for (let k = 0; k < N; k += 5) await Promise.all(Array.from({ length: Math.min(5, N - k) }, (_, d) => joinOne(k + d)));
  phones.sort((a, b) => a.k - b.k);
  log(`${N} phones joined in ${((Date.now() - tj) / 1000).toFixed(1)}s`);
  // host sees everyone
  try { await waitText(host, new RegExp(`\\b${N}\\s*משתתפים`), 15000); log('host lobby shows', N, 'players'); }
  catch (e) { fail('host lobby count: ' + (await text(host, '#lcount'))); }

  /* ---------- kick + rename ---------- */
  const victim = phones[N - 1], renamed = phones[N - 2];
  const nmOf = p => host.locator('#lnames .nm', { hasText: p.name }).first();
  await nmOf(victim).locator('.dots').click();
  await host.click('#lnames .pop .red');
  try { await waitText(victim.page, /הוציא אותך/, 10000); log('kicked player sees the message'); } catch (e) { fail('kicked phone did not get message'); }
  await nmOf(renamed).locator('.dots').click();
  await host.click('#lnames .pop button:not(.red)');
  await host.fill('#rname', 'שם חדש');
  await host.keyboard.press('Enter');
  try { await waitText(renamed.page, /שם חדש/, 10000); log('renamed player sees new name'); } catch (e) { fail('rename not shown on phone'); }
  const active = phones.slice(0, N - 1);

  /* ---------- play ---------- */
  await host.click('#startbtn');
  log('game started');
  const expectCorrect = {};
  for (let qi = 0; qi < CORRECT.length; qi++) {
    // Q4 (index 3): host refreshes the page mid-question and resumes.
    if (qi === 1) {
      const seen = await active[0].page.waitForFunction(() => { const e = document.querySelector('#pcd'); return e && /^[123]$/.test(e.textContent.trim()); }, null, { timeout: 8000 }).then(() => true).catch(() => false);
      seen ? log('  phone shows the 3-2-1 countdown') : fail('phone countdown not shown');
    }
    await Promise.all(active.map(p => p.page.waitForSelector('[data-act=pans]', { timeout: 30000 }).catch(() => fail(`p${p.k} no answer buttons q${qi + 1}`))));
    log(`q${qi + 1}: answer buttons on all phones`);
    if (qi === 3) {
      log('  host reloads page…');
      await host.reload();
      await host.waitForSelector('[data-act=resume]', { timeout: 20000 });
      await host.click('[data-act=resume]');
      log('  host resumed; waiting for question to restart');
      await sleep(1500);
      await Promise.all(active.map(p => p.page.waitForSelector('[data-act=pans]', { timeout: 30000 }).catch(() => fail(`p${p.k} no buttons after host resume`))));
    }
    const tasks = active.map(async (p, idx) => {
      if (qi === 1 && idx < 2) return; // two players don't answer
      if (qi === 2 && idx === 3) { // reload mid-question, then answer
        await p.page.reload();
        await p.page.waitForSelector('[data-act=pans]', { timeout: 30000 }).catch(() => fail('reloaded phone lost the question'));
      }
      if (qi === 2 && idx === 4) { // short network loss
        await p.ctx.setOffline(true); await sleep(4000); await p.ctx.setOffline(false);
      }
      const right = (idx + qi) % 3 !== 0;
      const nAns = qi === 4 ? 2 : 4;
      const choice = right ? CORRECT[qi] : (CORRECT[qi] + 1) % nAns;
      await sleep(200 + Math.random() * 2500);
      const t = Date.now();
      await p.page.click(`[data-act=pans][data-j="${choice}"]`, { timeout: 8000 }).catch(() => fail(`p${p.k} could not click q${qi + 1}`));
      await waitText(p.page, /התשובה נקלטה|הזמן נגמר/, 12000).catch(() => fail(`p${p.k} no confirmation q${qi + 1}`));
      p.answers[qi] = { choice, right, ms: Date.now() - t };
      if (right) expectCorrect[p.k] = (expectCorrect[p.k] || 0) + 1;
    });
    await Promise.all(tasks);
    const lat = active.map(p => p.answers[qi] && p.answers[qi].ms).filter(Boolean);
    log(`q${qi + 1}: ${lat.length} answers, confirm latency avg ${Math.round(lat.reduce((a, b) => a + b, 0) / Math.max(1, lat.length))}ms max ${Math.max(0, ...lat)}ms`);
    // everyone answered (except the two skippers on q2) → reveal should come early
    await Promise.all(active.map(async (p, idx) => {
      const t = await waitText(p.page, /נכון!|לא הפעם|לא ענית בזמן/, 30000).catch(() => '');
      if (!t) return fail(`p${p.k} no reveal q${qi + 1}`);
      const a = p.answers[qi];
      const want = !a ? /לא ענית בזמן/ : a.right ? /נכון!/ : /לא הפעם/;
      if (!want.test(t)) fail(`p${p.k} q${qi + 1} reveal mismatch (expected ${want})`);
    }));
    log(`q${qi + 1}: reveal correct on all phones`);
    // standings after every question: host moves on manually
    await host.click('[data-act=next]');
    await Promise.all([host.waitForSelector('.board .brow', { timeout: 10000 }).catch(() => fail(`q${qi + 1} host standings missing`)),
      ...active.map(p => p.page.waitForSelector('.board .brow', { timeout: 10000 }).catch(() => fail(`p${p.k} q${qi + 1} standings missing`)))]);
    log(`q${qi + 1}: standings shown on host and all phones`);
    await host.click('[data-act=next]'); // → next question (or final after the last one)
    if (qi === 0) { // a phone joins in the middle of the game
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await ctx.newPage(); watch(page, 'late');
      await page.goto(`${BASE}/?pin=${pin}`); await page.waitForSelector('#jnick');
      await page.fill('#jnick', 'מאחר'); await page.click('#jform button[type=submit]');
      try { await waitText(page, /באמצע המשחק/, 15000); log('late joiner sees the "joined mid-game" note'); } catch (e) { fail('late joiner note missing'); }
      active.push({ k: 900, ctx, page, name: 'מאחר', answers: {} });
    }
  }
  /* ---------- final ---------- */
  await waitText(host, /סוף המשחק/, 40000).catch(() => fail('host never reached final'));
  await Promise.all(active.map(p => waitText(p.page, /סוף המשחק/, 30000).catch(() => fail(`p${p.k} no final screen`))));
  log('final screen on host and all phones');
  const finals = await Promise.all(active.map(async p => {
    const t = await p.page.evaluate(() => document.body.innerText);
    const m = t.match(/([\d,]+)\s*נקודות/); return { k: p.k, pts: m ? +m[1].replace(/,/g, '') : -1, c: expectCorrect[p.k] || 0 };
  }));
  // more correct answers should never mean fewer points than someone with 2+ fewer correct answers
  finals.forEach(a => finals.forEach(b => { if (a.c >= b.c + 2 && a.pts < b.pts) fail(`score order: p${a.k}(${a.c} right, ${a.pts}) < p${b.k}(${b.c} right, ${b.pts})`); }));
  finals.forEach(f => { if (f.c > 0 && f.pts <= 0) fail(`p${f.k} has ${f.c} correct but ${f.pts} points`); });
  log('scores:', finals.map(f => `p${f.k}:${f.c}/${f.pts}`).join(' '));

  // results download
  try {
    const [dl] = await Promise.all([host.waitForEvent('download', { timeout: 10000 }), host.click('[data-act=dlres]')]);
    const csv = require('fs').readFileSync(await dl.path(), 'utf8');
    const lines = csv.trim().split(/\r?\n/);
    if (lines.length - 1 < N - 1) fail(`results csv has ${lines.length - 1} rows`); else log(`results CSV downloaded (${lines.length - 1} players): ${dl.suggestedFilename()}`);
  } catch (e) { fail('results download failed: ' + e.message.slice(0, 80)); }
  // play again on the same code: phones should follow automatically
  await host.click('[data-act=again]');
  await Promise.all(active.slice(0, 5).map(p => waitText(p.page, /נכנסת!/, 20000).catch(() => fail(`p${p.k} did not follow "play again"`))));
  log('"play again": phones back in lobby');
  await host.click('#xclose'); await host.click('[data-act=leave-yes]');
  await Promise.all(active.slice(0, 3).map(p => waitText(p.page, /המשחק הסתיים/, 20000).catch(() => fail(`p${p.k} did not see game ended`))));
  log('host closed game → phones see "game ended"');

  if (errors.length) { console.log('\nPage errors:'); [...new Set(errors)].slice(0, 30).forEach(e => console.log('  ' + e)); }
  console.log(`\n${problems.length ? '❌ ' + problems.length + ' problem(s)' : '✅ all checks passed'} — ${N} phones, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await browser.close();
  process.exit(problems.length || errors.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });

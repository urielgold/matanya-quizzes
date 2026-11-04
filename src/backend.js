// Everything that talks to Supabase lives here.
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 20 }, heartbeatIntervalMs: 15000 },
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Retry transient failures (network blips) a few times with backoff.
async function retry(fn, tries = 4) {
  let last;
  for (let k = 0; k < tries; k++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      if (e && e.permanent) throw e;
      await sleep(300 * Math.pow(2, k));
    }
  }
  throw last;
}
function check({ data, error }) {
  if (error) {
    const e = new Error(error.message || 'error');
    e.code = error.code; e.details = error.details;
    // Raised exceptions from our SQL functions are permanent, not network errors.
    if (error.code === 'P0001' || error.code === '42501' || /not_allowed|no_game|kicked|bad_secret|name_required|game_full|not_your_game/.test(error.message || '')) e.permanent = true;
    throw e;
  }
  return data;
}

/* ---------------- auth (hosts only; players never sign in) ---------------- */
export async function currentUser() {
  const { data } = await sb.auth.getSession();
  const u = data && data.session && data.session.user;
  return u && !u.is_anonymous ? u : null;
}
export function onAuth(cb) {
  return sb.auth.onAuthStateChange((_ev, session) => {
    const u = session && session.user;
    cb(u && !u.is_anonymous ? u : null);
  });
}
export async function signIn(email, password) {
  return check(await sb.auth.signInWithPassword({ email, password }));
}
export async function signUp(email, password) {
  return check(await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } }));
}
export async function signOut() { await sb.auth.signOut(); }
export async function resetPassword(email) {
  return check(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin }));
}
export async function updatePassword(password) {
  return check(await sb.auth.updateUser({ password }));
}
export async function signInGoogle() {
  return check(await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin } }));
}
let providers = null;
export async function authProviders() {
  if (providers) return providers;
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/settings', { headers: { apikey: SUPABASE_ANON_KEY } });
    const j = await r.json();
    providers = { google: !!(j.external && j.external.google), autoconfirm: !!j.mailer_autoconfirm };
  } catch (e) { providers = { google: false, autoconfirm: false }; }
  return providers;
}

/* ---------------- quizzes ---------------- */
export async function listQuizzes() {
  const rows = await retry(async () => check(await sb.from('quizzes').select('id,title,questions,cover,art,updated').order('updated', { ascending: false })));
  return rows.map(r => ({
    id: r.id, title: r.title || '', questions: Array.isArray(r.questions) ? r.questions : [],
    updated: Number(r.updated) || 0, art: r.art || 'auto',
    cover: r.cover && typeof r.cover.url === 'string' ? { id: r.cover.id, url: r.cover.url } : null,
  }));
}
export async function saveQuiz(z, owner) {
  return retry(async () => check(await sb.from('quizzes').upsert({
    id: z.id, owner, title: z.title || '', questions: z.questions || [], cover: z.cover || null,
    art: z.art || 'auto', updated: z.updated || Date.now(),
  })));
}
export async function deleteQuiz(id) {
  return retry(async () => check(await sb.from('quizzes').delete().eq('id', id)));
}
export async function getSongs(uid) {
  const r = check(await sb.from('profiles').select('songs').eq('id', uid).maybeSingle());
  return r && Array.isArray(r.songs) ? r.songs : [];
}
export async function saveSongs(uid, songs) {
  return retry(async () => check(await sb.from('profiles').upsert({ id: uid, songs, updated_at: new Date().toISOString() })));
}

/* ---------------- storage ---------------- */
const IMG_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export async function uploadFile(uid, file, kind) {
  if (kind === 'image' && !IMG_TYPES.includes(file.type)) { const e = new Error('type'); e.code = 'unsupported_type'; throw e; }
  const limit = kind === 'image' ? 10 : 25;
  if (file.size > limit * 1024 * 1024) { const e = new Error('big'); e.code = 'too_large'; throw e; }
  const ext = ((file.name || '').match(/\.([a-z0-9]{1,5})$/i) || [, kind === 'image' ? 'jpg' : 'mp3'])[1].toLowerCase();
  const path = `${uid}/${kind}s/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  check(await sb.storage.from('media').upload(path, file, { contentType: file.type || undefined, cacheControl: '31536000', upsert: false }));
  const { data } = sb.storage.from('media').getPublicUrl(path);
  return { id: path, url: data.publicUrl };
}
export async function deleteFile(path) {
  if (!path || typeof path !== 'string' || !path.includes('/')) return;
  try { await sb.storage.from('media').remove([path]); } catch (e) { }
}

/* ---------------- host: live game ---------------- */
export async function createGame(quizId, state, pin) {
  return retry(async () => check(await sb.rpc('create_game', { p_quiz: quizId, p_state: state, p_pin: pin || null })));
}
export async function hostUpdate(pin, o) {
  return check(await sb.rpc('host_update', {
    p_pin: pin, p_state: o.state, p_status: o.status, p_round: o.round, p_accepting: !!o.accepting,
    p_time: o.time || 20, p_elapsed_ms: Math.round(o.elapsed || 0),
  }));
}
export async function endGame(pin) {
  try { await sb.from('games').update({ status: 'ended', accepting: false, updated_at: new Date().toISOString() }).eq('pin', pin); } catch (e) { }
}
export async function fetchPlayers(pin) {
  return retry(async () => check(await sb.from('players').select('pid,name,av,joined_at').eq('pin', pin).order('joined_at')));
}
export async function fetchAnswers(pin, round) {
  return retry(async () => check(await sb.from('answers').select('pid,choice,elapsed_ms,round').eq('pin', pin).eq('round', round)));
}
export async function kickPlayer(pin, pid) {
  try { await sb.from('players').delete().eq('pin', pin).eq('pid', pid); } catch (e) { }
}
export async function myActiveGame(uid) {
  const since = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const { data } = await sb.from('games').select('pin,quiz_id,state,status,round,updated_at')
    .eq('host', uid).neq('status', 'ended').gt('updated_at', since).order('updated_at', { ascending: false }).limit(1);
  return data && data[0] || null;
}

// Host channel: presence (who is connected) + new players + answers.
export function hostChannel(pin, h) {
  const ch = sb.channel('room-' + pin, { config: { presence: { key: 'host' } } });
  ch.on('presence', { event: 'sync' }, () => h.onPresence && h.onPresence(ch.presenceState()))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: 'pin=eq.' + pin }, p => h.onPlayers && h.onPlayers(p))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'answers', filter: 'pin=eq.' + pin }, p => h.onAnswer && h.onAnswer(p.new))
    .subscribe(status => {
      h.onStatus && h.onStatus(status);
      if (status === 'SUBSCRIBED') ch.track({ role: 'host', t: Date.now() }).catch(() => { });
    });
  return { unsub: () => { try { sb.removeChannel(ch); } catch (e) { } } };
}

/* ---------------- player ---------------- */
const IDK = 'matanya.player.v1';
function rnd(n) {
  const a = new Uint8Array(n); (crypto || window.crypto).getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const h = rnd(16); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function playerIdentity() {
  let v = null;
  try { v = JSON.parse(localStorage.getItem(IDK)); } catch (e) { }
  if (!v || !v.pid || !v.secret) {
    v = { pid: uuid(), secret: rnd(24) };
    try { localStorage.setItem(IDK, JSON.stringify(v)); } catch (e) { }
  }
  return v;
}
export async function getGame(pin) {
  const { data, error } = await sb.from('games').select('pin,state,status,round,accepting').eq('pin', pin).maybeSingle();
  if (error) throw error;
  return data;
}
export async function joinGame(pin, name, av) {
  const me = playerIdentity();
  return retry(async () => check(await sb.rpc('join_game', { p_pin: pin, p_pid: me.pid, p_secret: me.secret, p_name: name, p_av: av })));
}
export async function setAvatar(pin, av) {
  const me = playerIdentity();
  try { await sb.rpc('set_avatar', { p_pin: pin, p_pid: me.pid, p_secret: me.secret, p_av: av }); } catch (e) { }
}
export async function leaveGame(pin) {
  const me = playerIdentity();
  try { await sb.rpc('leave_game', { p_pin: pin, p_pid: me.pid, p_secret: me.secret }); } catch (e) { }
}
export async function submitAnswer(pin, round, choice) {
  const me = playerIdentity();
  return retry(async () => check(await sb.rpc('submit_answer', { p_pin: pin, p_pid: me.pid, p_secret: me.secret, p_round: round, p_choice: choice })), 5);
}
export async function myAnswer(pin, round) {
  const me = playerIdentity();
  try { return check(await sb.rpc('my_answer', { p_pin: pin, p_pid: me.pid, p_secret: me.secret, p_round: round })); }
  catch (e) { return null; }
}
// Player channel: follow the game row + announce presence.
export function playerChannel(pin, h) {
  const me = playerIdentity();
  const ch = sb.channel('room-' + pin, { config: { presence: { key: me.pid } } });
  ch.on('presence', { event: 'sync' }, () => h.onPresence && h.onPresence(ch.presenceState()))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: 'pin=eq.' + pin }, p => h.onGame && h.onGame(p.new))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'games' }, p => { if (p.old && p.old.pin === pin) h.onGone && h.onGone(); })
    .subscribe(status => {
      h.onStatus && h.onStatus(status);
      if (status === 'SUBSCRIBED') ch.track({ role: 'player', pid: me.pid, t: Date.now() }).catch(() => { });
    });
  return { unsub: () => { try { sb.removeChannel(ch); } catch (e) { } } };
}

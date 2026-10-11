/* Kokoro · Cloudflare Worker: serves the pages in /public and the sync API at /api/*
   Needs:  a D1 database bound as  DB   and a Runtime secret  PIN  (4 to 8 digits).
   Tables are created automatically on first use.

   GET  /api/ping                     -> { ok:true }                       (checks the PIN)
   GET  /api/slot/<name>?since=<rev>  -> { rev, same:true } | { rev, at, data }
   PUT  /api/slot/<name>  {base,data} -> { rev, at }  |  409 { rev, at, data }  (someone saved first)

   Daily reminder (web push, no message content is sent; the phone shows a fixed line):
   GET    /api/push/key                         -> { key }   public VAPID key, made on first use
   PUT    /api/push/sub {endpoint,time,tz,slot} -> { ok }    save or update this phone's reminder
   DELETE /api/push/sub {endpoint}              -> { ok }    turn it off
   POST   /api/push/test {endpoint}             -> { ok, status }  send one now
   A cron trigger (every 5 minutes, see wrangler.jsonc) sends due reminders.
*/
const HOME = '/kokoro.html';     // the page the site's address opens
const CHUNK = 500000;            // characters per stored piece (D1 rows max 2 MB)
const MAX_BODY = 12e6;           // largest upload accepted
const IP_TRIES = 5, IP_LOCK = 15 * 60e3;          // 5 wrong PINs from one place -> 15 min pause
const PUSH_WINDOW = 180;         // minutes after the set time a missed reminder may still go out
const PUSH_TTL = 4 * 3600;       // seconds the push service keeps a reminder for a phone that's offline
const ALL_TRIES = 40, ALL_WIN = 60 * 60e3, ALL_LOCK = 60 * 60e3; // 40 wrong in an hour from anywhere -> 1 h pause

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Pin',
  'Access-Control-Max-Age': '86400'
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS }
});

let ready = false;
async function setup(db) {
  if (ready) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS slots (name TEXT PRIMARY KEY, rev INTEGER NOT NULL, wid TEXT NOT NULL, n INTEGER NOT NULL, at INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS chunks (name TEXT NOT NULL, wid TEXT NOT NULL, i INTEGER NOT NULL, part TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (name, wid, i))'),
    db.prepare('CREATE TABLE IF NOT EXISTS guard (k TEXT PRIMARY KEY, fails INTEGER NOT NULL, since INTEGER NOT NULL, until INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, mins INTEGER NOT NULL, tz TEXT NOT NULL, slot TEXT NOT NULL, last_day TEXT NOT NULL, created INTEGER NOT NULL, sent INTEGER NOT NULL DEFAULT 0, fails INTEGER NOT NULL DEFAULT 0)')
  ]);
  ready = true;
}

function sameText(a, b) {          // compare without leaking timing
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
async function getGuard(db, k) { return (await db.prepare('SELECT fails, since, until FROM guard WHERE k=?').bind(k).first()) || { fails: 0, since: 0, until: 0 }; }
async function putGuard(db, k, g) { await db.prepare('INSERT INTO guard (k,fails,since,until) VALUES (?,?,?,?) ON CONFLICT(k) DO UPDATE SET fails=excluded.fails, since=excluded.since, until=excluded.until').bind(k, g.fails, g.since, g.until).run(); }

async function checkPin(request, env) {
  const db = env.DB, now = Date.now();
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const kIp = 'ip:' + ip.slice(0, 64);
  const [gIp, gAll] = await Promise.all([getGuard(db, kIp), getGuard(db, 'all')]);
  const until = Math.max(gIp.until, gAll.until);
  if (until > now) return json({ error: 'locked', retryIn: Math.ceil((until - now) / 1000) }, 429);
  const pin = request.headers.get('X-Pin') || '';
  if (sameText(pin, String(env.PIN).trim())) {
    if (gIp.fails) await putGuard(db, kIp, { fails: 0, since: now, until: 0 });
    return null;
  }
  gIp.fails++; if (gIp.fails >= IP_TRIES) { gIp.until = now + IP_LOCK; gIp.fails = 0; }
  if (now - gAll.since > ALL_WIN) { gAll.fails = 0; gAll.since = now; }
  gAll.fails++; if (gAll.fails >= ALL_TRIES) { gAll.until = now + ALL_LOCK; gAll.fails = 0; gAll.since = now; }
  await Promise.all([putGuard(db, kIp, gIp), putGuard(db, 'all', gAll)]);
  if (gIp.until > now) return json({ error: 'locked', retryIn: Math.ceil(IP_LOCK / 1000) }, 429);
  return json({ error: 'pin', triesLeft: IP_TRIES - gIp.fails }, 401);
}

async function readSlot(db, name) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const s = await db.prepare('SELECT rev, wid, n, at FROM slots WHERE name=?').bind(name).first();
    if (!s) return { rev: 0, at: 0, data: null };
    const { results } = await db.prepare('SELECT part FROM chunks WHERE name=? AND wid=? ORDER BY i').bind(name, s.wid).all();
    if (results.length === s.n) return { rev: s.rev, at: s.at, data: results.map(r => r.part).join('') };
  }
  throw new Error('busy');
}

async function writeSlot(db, name, base, data) {
  const now = Date.now(), wid = crypto.randomUUID(), parts = [];
  for (let i = 0; i < data.length; i += CHUNK) parts.push(data.slice(i, i + CHUNK));
  if (!parts.length) parts.push('');
  const ins = db.prepare('INSERT INTO chunks (name, wid, i, part, at) VALUES (?,?,?,?,?)');
  for (let i = 0; i < parts.length; i += 20) await db.batch(parts.slice(i, i + 20).map((p, j) => ins.bind(name, wid, i + j, p, now)));
  const rev = base + 1;
  const r = base === 0
    ? await db.prepare('INSERT INTO slots (name, rev, wid, n, at) VALUES (?,?,?,?,?) ON CONFLICT(name) DO NOTHING').bind(name, rev, wid, parts.length, now).run()
    : await db.prepare('UPDATE slots SET rev=?, wid=?, n=?, at=? WHERE name=? AND rev=?').bind(rev, wid, parts.length, now, name, base).run();
  if (!r.meta || r.meta.changes !== 1) {
    await db.prepare('DELETE FROM chunks WHERE name=? AND wid=?').bind(name, wid).run();
    return null;
  }
  await db.prepare('DELETE FROM chunks WHERE name=? AND wid<>? AND at<?').bind(name, wid, now - 60e3).run();
  return { rev, at: now };
}

async function onRequest(ctx) {
  const spare = ctx.request.method === 'PUT' ? ctx.request.clone() : ctx.request;
  const r = await handle(ctx);
  if (r.status === 500) {
    const body = await r.clone().text();
    if (/no such table/i.test(body)) { ready = false; return handle({ ...ctx, request: spare }); }
  }
  return r;
}
async function handle({ request, env, params }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    if (!env.DB) return json({ error: 'setup', detail: 'No D1 database is linked as DB.' }, 500);
    if (!env.PIN || !/^\d{4,8}$/.test(String(env.PIN).trim())) return json({ error: 'setup', detail: 'PIN is not set (4 to 8 digits).' }, 500);
    await setup(env.DB);
    const denied = await checkPin(request, env);
    if (denied) return denied;

    const path = Array.isArray(params.path) ? params.path : String(params.path || '').split('/').filter(Boolean);
    if (path[0] === 'ping' && path.length === 1 && request.method === 'GET') return json({ ok: true, time: Date.now() });

    if (path[0] === 'slot' && path.length === 2) {
      const name = path[1];
      if (!/^[a-z0-9-]{1,40}$/.test(name)) return json({ error: 'name' }, 400);
      if (request.method === 'GET') {
        const since = Number(new URL(request.url).searchParams.get('since'));
        if (Number.isInteger(since) && since > 0) {
          const s = await env.DB.prepare('SELECT rev FROM slots WHERE name=?').bind(name).first();
          if (s && s.rev === since) return json({ rev: since, same: true });
        }
        return json(await readSlot(env.DB, name));
      }
      if (request.method === 'PUT') {
        const len = Number(request.headers.get('Content-Length') || 0);
        if (len > MAX_BODY) return json({ error: 'size' }, 413);
        const text = await request.text();
        if (text.length > MAX_BODY) return json({ error: 'size' }, 413);
        let body; try { body = JSON.parse(text); } catch (e) { return json({ error: 'json' }, 400); }
        const base = Number(body && body.base);
        if (!Number.isInteger(base) || base < 0 || typeof body.data !== 'string') return json({ error: 'body' }, 400);
        const ok = await writeSlot(env.DB, name, base, body.data);
        if (ok) return json(ok);
        return json(await readSlot(env.DB, name), 409);
      }
    }
    if (path[0] === 'push') return pushRoute(request, env, path);
    return json({ error: 'not found' }, 404);
  } catch (e) {
    return json({ error: 'server', detail: String(e && e.message || e).slice(0, 200) }, 500);
  }
}

/* ===================== Daily reminder (web push) ===================== */
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uStr = str => b64u(new TextEncoder().encode(str));

async function vapidKeys(db) {
  const row = await db.prepare("SELECT v FROM kv WHERE k='vapid'").first();
  if (row) { const o = JSON.parse(row.v); return { pub: o.pub, priv: await crypto.subtle.importKey('jwk', o.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']) }; }
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  await db.prepare("INSERT INTO kv (k, v) VALUES ('vapid', ?) ON CONFLICT(k) DO NOTHING").bind(JSON.stringify({ pub, jwk })).run();
  return vapidKeys(db);           // read back, so two first calls at once agree on one key
}

async function sendPush(env, endpoint) {
  const { pub, priv } = await vapidKeys(env.DB);
  const aud = new URL(endpoint).origin;
  const head = b64uStr(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64uStr(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://alicecabinet.com' }));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, new TextEncoder().encode(head + '.' + body));
  const jwt = head + '.' + body + '.' + b64u(sig);
  const r = await fetch(endpoint, { method: 'POST', headers: { Authorization: `vapid t=${jwt}, k=${pub}`, TTL: String(PUSH_TTL), Urgency: 'normal', 'Content-Length': '0' } });
  return r.status;
}

const validTz = tz => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; } };
function localNow(tz, now) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now)).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, mins: (+p.hour % 24) * 60 + (+p.minute) };
}
function validEndpoint(e) {
  try { const u = new URL(e); return e.length <= 1000 && (u.protocol === 'https:' || (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))); } catch (x) { return false; }
}

async function pushRoute(request, env, path) {
  const db = env.DB, m = request.method;
  if (path[1] === 'key' && m === 'GET') return json({ key: (await vapidKeys(db)).pub });
  let body = {};
  if (m !== 'GET') { try { body = await request.json(); } catch (e) { return json({ error: 'json' }, 400); } }
  const endpoint = String(body.endpoint || '');
  if (!validEndpoint(endpoint)) return json({ error: 'endpoint' }, 400);
  if (path[1] === 'sub' && m === 'PUT') {
    const t = /^(\d{1,2}):(\d{2})$/.exec(String(body.time || ''));
    if (!t || +t[1] > 23 || +t[2] > 59) return json({ error: 'time' }, 400);
    const tz = String(body.tz || 'UTC');
    if (!validTz(tz)) return json({ error: 'tz' }, 400);
    const slot = typeof body.slot === 'string' && /^[a-z0-9-]{1,40}$/.test(body.slot) ? body.slot : 'kokoro';
    const mins = +t[1] * 60 + +t[2], now = localNow(tz, Date.now());
    const old = await db.prepare('SELECT mins, tz, last_day FROM push_subs WHERE endpoint=?').bind(endpoint).first();
    /* already reminded today (or today's time has passed): the next one is tomorrow */
    const last = (old && old.last_day === now.day) || now.mins >= mins ? now.day : '';
    await db.prepare('INSERT INTO push_subs (endpoint, mins, tz, slot, last_day, created) VALUES (?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET mins=excluded.mins, tz=excluded.tz, slot=excluded.slot, last_day=excluded.last_day, fails=0')
      .bind(endpoint, mins, tz, slot, last, Date.now()).run();
    return json({ ok: true, next: last === now.day ? 'tomorrow' : 'today' });
  }
  if (path[1] === 'sub' && m === 'DELETE') {
    await db.prepare('DELETE FROM push_subs WHERE endpoint=?').bind(endpoint).run();
    return json({ ok: true });
  }
  if (path[1] === 'test' && m === 'POST') {
    let status = 0;
    try { status = await sendPush(env, endpoint); } catch (e) { return json({ ok: false, error: String(e.message || e).slice(0, 120) }); }
    if (status === 404 || status === 410) await db.prepare('DELETE FROM push_subs WHERE endpoint=?').bind(endpoint).run();
    return json({ ok: status >= 200 && status < 300, status });
  }
  return json({ error: 'not found' }, 404);
}

/* Did the person write a thought today (in their time zone)? Read from the synced data. */
async function wroteToday(db, slot, tz, day, cache) {
  if (!(slot in cache)) {
    cache[slot] = null;
    try { const s = await readSlot(db, slot); if (s.data) cache[slot] = JSON.parse(s.data); } catch (e) { /* no data: never skip */ }
  }
  const d = cache[slot];
  if (!d || !Array.isArray(d.thoughts)) return false;
  return d.thoughts.some(t => t && Number(t.date) > 0 && localNow(tz, Number(t.date)).day === day);
}

export async function runReminders(env, now = Date.now()) {
  const db = env.DB; await setup(db);
  let results;
  try { ({ results } = await db.prepare('SELECT endpoint, mins, tz, slot, last_day, fails FROM push_subs').all()); }
  catch (e) { if (!/no such table/i.test(String(e && e.message))) throw e; ready = false; await setup(db); ({ results } = await db.prepare('SELECT endpoint, mins, tz, slot, last_day, fails FROM push_subs').all()); }
  const cache = {}, out = { sent: 0, skipped: 0, removed: 0, failed: 0 };
  for (const s of results) {
    if (!validTz(s.tz)) continue;
    const ln = localNow(s.tz, now);
    if (s.last_day === ln.day || ln.mins < s.mins || ln.mins - s.mins > PUSH_WINDOW) continue;
    await db.prepare('UPDATE push_subs SET last_day=? WHERE endpoint=?').bind(ln.day, s.endpoint).run();
    if (await wroteToday(db, s.slot, s.tz, ln.day, cache)) { out.skipped++; continue; }
    let status = 0;
    try { status = await sendPush(env, s.endpoint); } catch (e) { status = 0; }
    if (status === 404 || status === 410) { await db.prepare('DELETE FROM push_subs WHERE endpoint=?').bind(s.endpoint).run(); out.removed++; }
    else if (status >= 200 && status < 300) { await db.prepare('UPDATE push_subs SET sent=sent+1, fails=0 WHERE endpoint=?').bind(s.endpoint).run(); out.sent++; }
    else {
      out.failed++;
      /* a phone whose reminders keep failing for 30 days is dropped */
      if (s.fails + 1 >= 30) await db.prepare('DELETE FROM push_subs WHERE endpoint=?').bind(s.endpoint).run();
      else await db.prepare('UPDATE push_subs SET fails=fails+1 WHERE endpoint=?').bind(s.endpoint).run();
    }
  }
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const path = url.pathname.slice(5).split('/').filter(Boolean);
      return onRequest({ request, env, params: { path } });
    }
    if (url.pathname === '/' || url.pathname === '/index.html') return Response.redirect(url.origin + HOME, 302);
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env, event.scheduledTime || Date.now()));
  }
};

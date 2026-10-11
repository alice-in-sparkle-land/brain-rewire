// Local test server: runs the real worker.js with a fake D1 (node:sqlite) and serves /public.
// Knobs: POST /__knob {delay, down, pin, reset}
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker, { runReminders } from '../worker.js';
import { webcrypto } from 'node:crypto';

const PORT = +process.env.PORT || 8787;
const PUB = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../public');
let sql = new DatabaseSync(':memory:');
const K = { delay: 0, down: false, pin: '2468', access: false };
const PUSHES = []; const PUSH_STATUS = {};
const b64d = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
async function verifyVapid(auth) {
  try {
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(auth || ''); if (!m) return false;
    const [h, b, sig] = m[1].split('.');
    const key = await webcrypto.subtle.importKey('raw', b64d(m[2]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64d(sig), Buffer.from(h + '.' + b));
    const claims = JSON.parse(b64d(b).toString());
    return ok && claims.aud === 'http://localhost:' + PORT && claims.exp > Date.now() / 1000 && /^https:/.test(claims.sub);
  } catch (e) { return false; }
}

function stmt(q, args = []) {
  const o = {
    bind(...a) { return stmt(q, a); },
    async first() { return sql.prepare(q).get(...args) || null; },
    async all() { return { results: sql.prepare(q).all(...args) }; },
    async run() { const r = sql.prepare(q).run(...args); return { meta: { changes: r.changes } }; },
    _run() { const r = sql.prepare(q).run(...args); return { meta: { changes: r.changes } }; }
  };
  return o;
}
const DB = {
  prepare: q => stmt(q),
  async batch(list) { sql.exec('BEGIN'); try { const out = list.map(s => s._run()); sql.exec('COMMIT'); return out; } catch (e) { sql.exec('ROLLBACK'); throw e; } }
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json' };
const ASSETS = {
  async fetch(req) {
    const u = new URL(req.url); const f = path.join(PUB, decodeURIComponent(u.pathname));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return new Response('not found', { status: 404 });
    return new Response(fs.readFileSync(f), { headers: { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' } });
  }
};

http.createServer(async (rq, rs) => {
  const chunks = []; for await (const c of rq) chunks.push(c);
  const body = Buffer.concat(chunks);
  if (rq.url.startsWith('/__push/')) {
    const id = rq.url.slice(8);
    PUSHES.push({ id, t: Date.now(), ttl: rq.headers['ttl'], len: body.length, vapid: await verifyVapid(rq.headers['authorization']) });
    rs.writeHead(PUSH_STATUS[id] || 201); rs.end(); return;
  }
  if (rq.url.startsWith('/__pushlog')) { rs.end(JSON.stringify(PUSHES)); return; }
  if (rq.url.startsWith('/__cron')) {
    const now = Number(new URL('http://x' + rq.url).searchParams.get('now')) || Date.now();
    const out = await runReminders({ DB, PIN: K.pin, ASSETS }, now);
    rs.end(JSON.stringify(out)); return;
  }
  if (rq.url === '/__knob') {
    const o = JSON.parse(body.toString() || '{}');
    if ('access' in o) K.access = o.access; if ('delay' in o) K.delay = o.delay; if ('down' in o) K.down = o.down; if ('pin' in o) K.pin = o.pin;
    if (o.reset) { sql = new DatabaseSync(':memory:'); }
    if (o.pushStatus) Object.assign(PUSH_STATUS, o.pushStatus);
    if (o.clearPushes) PUSHES.length = 0;
    if (o.subs) { try { rs.end(JSON.stringify(sql.prepare('SELECT * FROM push_subs').all())); } catch (e) { rs.end('[]'); } return; }
    if (o.clearGuard) { try { sql.exec('DELETE FROM guard'); } catch (e) { /* no table yet */ } }
    if (o.raw) { try { rs.end(JSON.stringify(sql.prepare("SELECT name, rev FROM slots").all())); } catch (e) { rs.end('[]'); } return; }
    rs.end('ok'); return;
  }
  if (K.down && rq.url.startsWith('/api/')) { rq.socket.destroy(); return; }
  if (K.access && rq.url.startsWith('/api/')) { rs.writeHead(302, { Location: 'https://alice.cloudflareaccess.com/cdn-cgi/access/login' }); rs.end(); return; }
  if (K.delay && rq.url.startsWith('/api/')) await new Promise(r => setTimeout(r, K.delay));
  const headers = new Headers(); for (const [k, v] of Object.entries(rq.headers)) if (typeof v === 'string') headers.set(k, v);
  const req = new Request('http://localhost:' + PORT + rq.url, { method: rq.method, headers, body: ['GET', 'HEAD'].includes(rq.method) ? undefined : body });
  try {
    const r = await worker.fetch(req, { DB, PIN: K.pin, ASSETS }, {});
    const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
    rs.writeHead(r.status, h); rs.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) { rs.writeHead(500); rs.end(String(e)); }
}).listen(PORT, () => console.log('listening ' + PORT));

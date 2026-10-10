// Local test server: runs the real worker.js with a fake D1 (node:sqlite) and serves /public.
// Knobs: POST /__knob {delay, down, pin, reset}
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker.js';

const PORT = +process.env.PORT || 8787;
const PUB = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../public');
let sql = new DatabaseSync(':memory:');
const K = { delay: 0, down: false, pin: '2468' };

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
  if (rq.url === '/__knob') {
    const o = JSON.parse(body.toString() || '{}');
    if ('delay' in o) K.delay = o.delay; if ('down' in o) K.down = o.down; if ('pin' in o) K.pin = o.pin;
    if (o.reset) { sql = new DatabaseSync(':memory:'); }
    if (o.clearGuard) { try { sql.exec('DELETE FROM guard'); } catch (e) { /* no table yet */ } }
    if (o.raw) { try { rs.end(JSON.stringify(sql.prepare("SELECT name, rev FROM slots").all())); } catch (e) { rs.end('[]'); } return; }
    rs.end('ok'); return;
  }
  if (K.down && rq.url.startsWith('/api/')) { rq.socket.destroy(); return; }
  if (K.delay && rq.url.startsWith('/api/')) await new Promise(r => setTimeout(r, K.delay));
  const headers = new Headers(); for (const [k, v] of Object.entries(rq.headers)) if (typeof v === 'string') headers.set(k, v);
  const req = new Request('http://localhost:' + PORT + rq.url, { method: rq.method, headers, body: ['GET', 'HEAD'].includes(rq.method) ? undefined : body });
  try {
    const r = await worker.fetch(req, { DB, PIN: K.pin, ASSETS }, {});
    const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
    rs.writeHead(r.status, h); rs.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) { rs.writeHead(500); rs.end(String(e)); }
}).listen(PORT, () => console.log('listening ' + PORT));

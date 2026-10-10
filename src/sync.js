'use strict';
/* ===== sync.js — change stamps, merging and cloud sync (from the synced-tool blueprint) =====
   Every item carries u (last change time). Deleted ids go into S.del with the delete time.
   Theme, Lite mode, preview and backup counters stay on each device and are never sent. */
const SYNC_COLS = ['people', 'actions', 'thoughts', 'sessions'];

function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
function hashStr(s) {
  let h = 0x811c9dc5, h2 = 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h ^= c; h = Math.imul(h, 0x01000193); h2 = (h2 * 31 + c) | 0; }
  return (h >>> 0).toString(36) + '.' + (h2 >>> 0).toString(36) + '.' + s.length.toString(36);
}
function itemKey(x) { const c = {}; for (const k in x) if (k !== 'u') c[k] = x[k]; return canon(c); }
const labKey = l => canon({ zones: l.zones, levels: l.levels });

/* ---------- change stamps ---------- */
let SNAP = null;
function takeSnap() {
  const cols = {};
  for (const col of SYNC_COLS) { const m = new Map(); for (const x of S[col]) m.set(x.id, { k: itemKey(x), u: x.u || 0 }); cols[col] = m; }
  SNAP = { cols, lab: labKey(S.labels) };
}
/* Compares S with the last snapshot: changed items get u = now, removed ones become delete markers.
   Returns the number of changed things (0 = nothing that syncs changed). */
function stampChanges() {
  if (!SNAP) { takeSnap(); return 0; }
  const now = Date.now(); let ch = 0;
  if (!isObj(S.del)) S.del = {};
  const cols = {};
  for (const col of SYNC_COLS) {
    const old = SNAP.cols[col], m = new Map();
    for (const x of S[col]) {
      const o = old.get(x.id), k = itemKey(x);
      if (o && o.k === k) x.u = o.u; else { x.u = now; ch++; if (S.del[x.id]) delete S.del[x.id]; }
      m.set(x.id, { k, u: x.u });
    }
    for (const id of old.keys()) if (!m.has(id)) { S.del[id] = now; ch++; }
    cols[col] = m;
  }
  const lk = labKey(S.labels);
  if (lk !== SNAP.lab) { S.labels.u = now; ch++; }
  SNAP = { cols, lab: lk };
  return ch;
}
/* Marks everything as changed now (Import · Replace), so the backup wins on every device. */
function touchAll(oldIds) {
  const now = Date.now();
  for (const col of SYNC_COLS) {
    const have = new Set(S[col].map(x => x.id));
    for (const id of (oldIds[col] || [])) if (!have.has(id)) S.del[id] = now;
    for (const x of S[col]) { x.u = now; delete S.del[x.id]; }
  }
  S.labels.u = now;
  takeSnap();
}
const idsOf = st => Object.fromEntries(SYNC_COLS.map(c => [c, st[c].map(x => x.id)]));

/* ---------- cloud payload ---------- */
function syncData(st) {
  const c = sanitizeState({ people: st.people, actions: st.actions, thoughts: st.thoughts, sessions: st.sessions, labels: st.labels, del: st.del });
  return { app: APP_ID, v: 1, people: c.people, actions: c.actions, thoughts: c.thoughts, sessions: c.sessions, labels: c.labels, del: c.del };
}
const payloadStr = () => JSON.stringify(syncData(S));
function parseRemote(str) {
  let o; try { o = JSON.parse(str); } catch (e) { throw { kind: 'bad', msg: 'Cloud data could not be read.' }; }
  if (!isObj(o) || o.app !== APP_ID) throw { kind: 'foreign' };
  const c = sanitizeState(o);
  return { people: c.people, actions: c.actions, thoughts: c.thoughts, sessions: c.sessions, labels: c.labels, del: c.del };
}

/* ---------- merge (same answer whichever device runs it) ---------- */
function newer(a, b) {
  if (!a) return b; if (!b) return a;
  if ((a.u || 0) !== (b.u || 0)) return (a.u || 0) > (b.u || 0) ? a : b;
  return canon(a) >= canon(b) ? a : b;
}
function mergeIn(R) {
  const del = { ...R.del };
  for (const [k, t] of Object.entries(S.del || {})) if (!(k in del) || t > del[k]) del[k] = t;
  for (const col of SYNC_COLS) {
    const L = new Map(S[col].map(x => [x.id, x])), used = new Set(), out = [];
    for (const r of R[col]) { used.add(r.id); out.push(newer(L.get(r.id), r)); }
    for (const l of S[col]) if (!used.has(l.id)) out.push(l);
    S[col] = out.filter(x => !(x.id in del) || (x.u || 0) > del[x.id]);
  }
  S.del = sDel(del);
  const w = newer({ zones: S.labels.zones, levels: S.labels.levels, u: S.labels.u || 0 }, R.labels);
  if (w === R.labels) S.labels = sLabels(R.labels);
  fixAfterMerge();
  takeSnap();
}
/* keeps links valid and only one session open after a merge */
function fixAfterMerge() {
  const c = sanitizeState(S); S.people = c.people; S.actions = c.actions; S.thoughts = c.thoughts; S.sessions = c.sessions;
}
function replaceWithRemote(R) {
  for (const col of SYNC_COLS) S[col] = R[col].map(x => ({ ...x }));
  S.del = { ...R.del }; S.labels = sLabels(R.labels);
  S.meta.welcomed = true;
  fixAfterMerge();
  takeSnap();
}
const hasOwnData = () => SYNC_COLS.some(k => S[k].length > 0);

/* ---------- sync settings on this device ---------- */
const SC = { on: false, pin: '', server: '', slot: 'kokoro', rev: 0, hash: '', last: 0 };
function loadSC() {
  try {
    const o = JSON.parse(lsGet(LS_SYNC) || 'null'); if (!isObj(o)) return;
    SC.on = sBool(o.on); SC.pin = /^\d{4,8}$/.test(o.pin) ? o.pin : '';
    SC.server = /^https?:\/\/[^\s"'<>]+$/.test(o.server || '') ? sStr(o.server, 200) : '';
    SC.slot = /^[a-z0-9-]{1,40}$/.test(o.slot) ? o.slot : 'kokoro';
    SC.rev = Math.round(sNum(o.rev, 0, 1e12, 0)); SC.hash = sStr(o.hash, 60); SC.last = sTs(o.last);
    if (!SC.pin) SC.on = false;
  } catch (e) { /* ignore */ }
}
function saveSC() { lsSet(LS_SYNC, JSON.stringify(SC)); }
const pageServer = () => /^https?:$/.test(location.protocol) ? location.origin : '';
const apiBase = () => (SC.server || pageServer()).replace(/\/+$/, '');

/* ---------- sync engine ---------- */
const SY = { st: 'off', msg: '', busy: false, again: false, timer: 0, until: 0, gen: 1, clean: 0 };
function markDirty() { SY.gen++; }

async function api(method, path, body, pin, server) {
  const base = (server || apiBase()).replace(/\/+$/, '');
  if (!base) throw { kind: 'noserver' };
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const tm = setTimeout(() => { if (ctl) ctl.abort(); }, 20000);
  const headers = { 'X-Pin': pin == null ? SC.pin : pin };
  if (body) headers['Content-Type'] = 'application/json';
  let r;
  try { r = await fetch(base + '/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', signal: ctl ? ctl.signal : undefined }); }
  catch (e) { throw { kind: 'net', msg: e && e.message }; }
  finally { clearTimeout(tm); }
  let j = null; try { j = await r.json(); } catch (e) { /* not json */ }
  if (r.status === 401) throw { kind: 'pin', left: j && j.triesLeft };
  if (r.status === 429) throw { kind: 'locked', wait: (j && j.retryIn) || 900 };
  if (r.status === 409 && j) return { conflict: true, ...j };
  if (!r.ok || !j) throw { kind: j && j.error === 'setup' ? 'setup' : 'server', msg: (j && (j.detail || j.error)) || ('HTTP ' + r.status) };
  return j;
}
function syncErrText(e) {
  if (!e || typeof e !== 'object') return 'Sync failed.';
  return {
    net: 'Can’t reach the sync site. Changes are kept on this phone.',
    pin: 'The PIN was not accepted.' + (e.left > 0 ? ` ${e.left} tr${e.left === 1 ? 'y' : 'ies'} left before a 15-minute pause.` : ''),
    locked: `Too many wrong PINs. Sync is paused for ${Math.ceil((e.wait || 900) / 60)} min.`,
    setup: 'The sync site isn’t set up yet: ' + (e.msg || ''),
    noserver: 'Add the address of your sync site first.',
    foreign: 'That cloud space holds data from another tool.',
    bad: e.msg || 'Cloud data could not be read.',
    server: 'The sync site had a problem (' + (e.msg || 'unknown') + '). It will try again.'
  }[e.kind] || 'Sync failed.';
}
function setSync(st, msg = '') {
  SY.st = st; SY.msg = msg;
  const d = document.getElementById('sdot');
  if (d) { d.className = 'sdot s-' + st + (SC.on ? '' : ' hidden'); d.title = syncLine(); }
  const b = document.getElementById('syncBox'), a = document.activeElement; if (b && !(b.contains(a) && a.tagName === 'INPUT')) b.innerHTML = syncInner();
}
function ago(t) {
  if (!t) return 'never';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 50) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return fmtDay(t);
}
function syncLine() {
  if (!SC.on) return 'Sync is off';
  if (SY.st === 'busy') return 'Syncing…';
  if (SY.st === 'ok') return 'Synced · ' + ago(SC.last);
  if (SY.st === 'offline') return 'Offline · changes wait on this phone';
  return SY.msg || 'Not synced yet';
}
function schedSync(ms = 1500) { if (!SC.on) return; clearTimeout(SY.timer); SY.timer = setTimeout(() => syncNow(false), ms); }

function applyRemote(g) {
  if (g.data == null) { SC.rev = 0; SC.hash = ''; saveSC(); markDirty(); return; }
  const R = parseRemote(g.data);
  mergeIn(R);
  SC.rev = g.rev; SC.hash = hashStr(g.data); saveSC();
  markDirty();
  persist();
  afterRemote();
}
let renderWaiting = false;
function afterRemote() {
  if (isTyping()) { renderWaiting = true; return; }
  softRender();
}
async function syncNow(manual) {
  if (!SC.on) return setSync('off');
  if (SY.busy) { SY.again = true; return; }
  if (!manual && SY.st === 'pin') return;
  if (!manual && SY.st === 'locked' && Date.now() < SY.until) return;
  if (navigator.onLine === false) return setSync('offline');
  SY.busy = true; setSync('busy');
  try {
    const g = await api('GET', '/slot/' + SC.slot + '?since=' + SC.rev);
    if (!g.same) applyRemote(g);
    for (let i = 0; i < 5 && SY.gen !== SY.clean; i++) {
      const gen = SY.gen, str = payloadStr(), h = hashStr(str);
      if (h === SC.hash) { SY.clean = gen; break; }
      const r = await api('PUT', '/slot/' + SC.slot, { base: SC.rev, data: str });
      if (r.conflict) { applyRemote(r); continue; }
      SC.rev = r.rev; SC.hash = h; SY.clean = gen; saveSC();
    }
    SC.last = Date.now(); saveSC();
    setSync('ok');
  } catch (e) {
    if (e && e.kind === 'locked') SY.until = Date.now() + (e.wait || 900) * 1000;
    if (e && e.kind !== 'net') logDiag('sync: ' + (e.kind || '') + ' ' + (e.msg || e.message || ''));
    setSync(e && e.kind === 'net' ? 'offline' : (e && e.kind) || 'error', syncErrText(e));
  } finally {
    SY.busy = false;
    if (SY.again) { SY.again = false; schedSync(300); }
  }
}
/* When the page is hidden, try one last quick save (small data only). */
function flushOnHide() {
  if (!SC.on || SY.busy || SY.gen === SY.clean || SY.st === 'pin' || SY.st === 'locked') return;
  try {
    const str = payloadStr(); if (hashStr(str) === SC.hash) return;
    const body = JSON.stringify({ base: SC.rev, data: str });
    if (body.length > 60000 || !apiBase()) return;
    fetch(apiBase() + '/api/slot/' + SC.slot, { method: 'PUT', keepalive: true, headers: { 'X-Pin': SC.pin, 'Content-Type': 'application/json' }, body }).catch(() => {});
  } catch (e) { /* ignore */ }
}

/* ---------- connect / disconnect ---------- */
let pendingCloud = null;
async function connectSync(pin, server) {
  await api('GET', '/ping', null, pin, server);
  const g = await api('GET', '/slot/' + SC.slot, null, pin, server);
  const R = g.data == null ? null : parseRemote(g.data);
  SC.pin = pin; SC.server = server; SC.on = true; SC.rev = 0; SC.hash = ''; SY.clean = 0; markDirty();
  if (!R) { saveSC(); return 'empty'; }
  if (!hasOwnData()) { replaceWithRemote(R); SC.rev = g.rev; SC.hash = hashStr(g.data); SY.clean = SY.gen; saveSC(); persist(); return 'took'; }
  pendingCloud = { R, g }; SC.on = false; // stays off until the person chooses
  return 'ask';
}
function finishConnect(choice) {
  const p = pendingCloud; pendingCloud = null; if (!p) return;
  if (choice === 'cloud') replaceWithRemote(p.R); else mergeIn(p.R);
  SC.on = true; SC.rev = p.g.rev; SC.hash = hashStr(p.g.data); markDirty(); saveSC();
  persist();
}
function disconnectSync() {
  Object.assign(SC, { on: false, pin: '', rev: 0, hash: '', last: 0 }); saveSC();
  clearTimeout(SY.timer); setSync('off');
}

/* ---------- settings panel ---------- */
function syncInner() {
  const host = pageServer() ? location.host : '';
  if (!SC.on) {
    return `<div class="lbl">Cloud sync</div>
      <p class="sm" style="margin:6px 0 0">Keep this phone and your other devices in step through your own sync site. The site needs to be set up once (see the setup guide).</p>
      <div class="fld"><label for="spin">Sync PIN</label><input class="in" id="spin" name="spin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off" placeholder="4 to 8 digits"></div>
      ${host ? `<div class="hint">Sync site: ${esc(host)} · <button type="button" class="link" data-act="syncSrvShow">use another</button></div>` : ''}
      <div class="fld${host && !SC.server ? ' hidden' : ''}" id="srvFld"><label for="ssrv">Sync site address</label><input class="in" id="ssrv" name="ssrv" inputmode="url" autocomplete="off" value="${esc(SC.server)}" placeholder="https://brain-rewire.your-name.workers.dev"></div>
      <div class="err" id="syncErr"></div>
      <div class="btns"><button class="btn" data-act="syncConnect">Connect</button></div>`;
  }
  const bad = SY.st === 'pin';
  return `<div class="lbl">Cloud sync</div>
    <div class="row0" style="margin-top:8px"><span class="sdot s-${SY.st}" style="position:static"></span><div style="font-size:14px;flex:1">${esc(syncLine())}</div></div>
    ${SY.st !== 'ok' && SY.st !== 'busy' && SY.msg && SY.msg !== syncLine() ? `<p class="sm" style="margin:6px 0 0">${esc(SY.msg)}</p>` : ''}
    <p class="sm" style="margin:6px 0 0">Site: ${esc((apiBase() || '').replace(/^https?:\/\//, ''))} · last synced ${esc(ago(SC.last))}</p>
    ${bad ? `<div class="row0" style="margin-top:8px"><input class="in" id="spin2" name="spin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off" placeholder="PIN" style="flex:1"><button class="btn" data-act="syncPin">Try PIN</button></div>` : ''}
    <div class="btns"><button class="btn" data-act="syncNowBtn">Sync now</button><button class="btn g" data-act="syncOff">Disconnect</button></div>`;
}

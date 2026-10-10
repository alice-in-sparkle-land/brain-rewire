'use strict';
/* ===== data.js — constants, sanitizers, storage, backup and old-file import ===== */
const APP_ID = 'kokoro';
const APP_VER = '1.0.0';
const LS_KEY = 'kkr.v1', LS_DEV = 'kkr.dev', LS_SYNC = 'kkr.sync', LS_VIS = 'kkr.vis', LS_DIAG = 'kkr.diag';

/* Map zones: 3 rings (how close) and 4 outer corners (clear boundaries). */
const ZONES = ['ring1', 'ring2', 'ring3', 'q_tr', 'q_tl', 'q_bl', 'q_br'];
const ZONE_DEF = {
  ring1: 'Closest', ring2: 'Close', ring3: 'Known',
  q_br: 'Negative · set a boundary', q_bl: 'Negative · let go',
  q_tl: 'Not negative · accept', q_tr: 'Fine, but I keep distance'
};
const ZONE_COL = { ring1: '#C9635B', ring2: '#C99A4A', ring3: '#7FA37A', q_tr: '#8A7CA8', q_br: '#B5573F', q_bl: '#8B7F6E', q_tl: '#5E7A96', none: '#A6A196' };
/* The old map's own (Vietnamese) default names: if the backup still has these, English defaults are used. */
const ZONE_VI_DEF = {
  ring1: 'Thân thiết nhất', ring2: 'Thân thiết vừa', ring3: 'Quen biết',
  q_br: 'Tiêu cực — cần đặt ranh giới', q_bl: 'Tiêu cực — buông bỏ',
  q_tl: 'Không tiêu cực — chấp nhận', q_tr: 'Ổn, nhưng mình chọn giữ khoảng cách'
};
/* Action levels: what someone did, one action at a time. */
const LEVELS = [0, 1, 2, 3, 4];
const LEVEL_DEF = ['Toxic', 'Hurtful', 'Neutral', 'Good', 'Inspiring'];
const LEVEL_COL = ['#7A2E3A', '#C8613E', '#A39E92', '#5E9A5A', '#D9A532'];
const LEVEL_BG = ['#F3E1E4', '#F8E4DA', '#EFEDE8', '#E3EFE0', '#F8EDD2'];
const LEVEL_INK = ['#6A2230', '#9A3B1E', '#5F5B52', '#2F6B2C', '#8A6411'];
/* Thought types (from Stress Test) */
const TYPES = ['spiral', 'hope', 'fact'];
const TYPE_NAME = { spiral: 'Spiral', hope: 'Hope', fact: 'Fact' };
const TYPE_LONG = { spiral: 'Spiral thought', hope: 'Hope', fact: 'Fact' };
const TYPE_COL = { spiral: '#C8613E', hope: '#1D9E75', fact: '#7F77DD' };
const TYPE_BG = { spiral: '#F6DFD6', hope: '#DDF0E8', fact: '#E6E4F7' };
const TYPE_INK = { spiral: '#9A3B1E', hope: '#156A50', fact: '#4A42A0' };

const BRIGHT = ['Loyal', 'Kind', 'Generous', 'Honest', 'Curious', 'Patient', 'Funny', 'Brave', 'Thoughtful', 'Enthusiastic', 'Reliable', 'Gentle'];
const TENDER = ['Insecure', 'Anxious', 'Stubborn', 'Impatient', 'Guarded', 'Proud', 'Sensitive', 'Restless', 'Self-critical', 'Distracted'];

const LIM = { people: 2000, actions: 20000, thoughts: 20000, sessions: 5000, traits: 40, sessThoughts: 60, notes: 400, linked: 60 };

/* ---------- small helpers ---------- */
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
function sStr(v, n) { if (typeof v === 'number') v = String(v); if (typeof v !== 'string') return ''; v = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ''); return v.length > n ? v.slice(0, n) : v; }
function sLine(v, n) { return sStr(v, n * 2).replace(/[\r\n\t]+/g, ' ').trim().slice(0, n); }
function sNum(v, a, b, d) { v = Number(v); return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d; }
function sTs(v) { if (typeof v === 'string' && v && !/^\d+$/.test(v)) v = Date.parse(v); v = Number(v); return Number.isFinite(v) && v > 0 && v < 4102444800000 ? Math.round(v) : 0; }
const sBool = v => v === true || v === 1 || v === 'true';
function sId(v) { if (typeof v === 'number') v = String(v); return typeof v === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(v) ? v : ''; }
function sDate(v) { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return ''; const d = new Date(v + 'T00:00:00'); return isNaN(d) ? '' : v; }
function keyOf(d) { d = new Date(d); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const todayKey = () => keyOf(Date.now());
function sIds(v, max) { const out = [], seen = new Set(); if (Array.isArray(v)) for (const x of v) { const id = sId(x); if (id && !seen.has(id)) { seen.add(id); out.push(id); if (out.length >= max) break; } } return out; }
function cleanList(v, fn, max) { const out = [], seen = new Set(); if (!Array.isArray(v)) return out; for (const x of v) { let y = null; try { y = fn(x); } catch (e) { y = null; } if (y && !seen.has(y.id)) { seen.add(y.id); out.push(y); if (out.length >= max) break; } } return out; }

/* ---------- item sanitizers ---------- */
function sPlace(p) {
  if (!isObj(p)) return null;
  const x = Number(p.x), y = Number(p.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.round(Math.min(100, Math.max(0, x)) * 10) / 10, y: Math.round(Math.min(100, Math.max(0, y)) * 10) / 10 };
}
function sPerson(p) {
  if (!isObj(p)) return null;
  const id = sId(p.id); const name = sLine(p.name, 60);
  if (!id || !name) return null;
  const refl = isObj(p.refl) ? p.refl : {};
  return {
    id, name, rel: sLine(p.rel, 60), note: sStr(p.note, 4000), place: sPlace(p.place),
    traits: cleanList(p.traits, t => { const tid = sId(t && t.id), tx = sLine(t && t.text, 48); return tid && tx ? { id: tid, text: tx } : null; }, LIM.traits),
    refl: { feel: sStr(refl.feel, 4000), appreciate: sStr(refl.appreciate, 4000), wish: sStr(refl.wish, 4000) },
    created: sTs(p.created) || sTs(p.u) || Date.now(), u: sTs(p.u)
  };
}
function sAction(a) {
  if (!isObj(a)) return null;
  const id = sId(a.id), pid = sId(a.pid), title = sLine(a.title, 120);
  if (!id || !pid || !title) return null;
  const lv = Math.round(sNum(a.level, 0, 4, 2));
  return { id, pid, title, detail: sStr(a.detail, 4000), date: sDate(a.date) || keyOf(sTs(a.created) || Date.now()), level: lv, created: sTs(a.created) || Date.now(), u: sTs(a.u) };
}
function sThought(t) {
  if (!isObj(t)) return null;
  const id = sId(t.id), text = sStr(t.text, 2000).trim();
  if (!id || !text) return null;
  return { id, text, type: TYPES.includes(t.type) ? t.type : 'spiral', pid: sId(t.pid), date: sTs(t.date) || Date.now(), u: sTs(t.u) };
}
function sNote(n) {
  if (!isObj(n)) return null;
  const id = sId(n.id), tid = sId(n.tid), phrase = sLine(n.phrase, 300);
  if (!id || !tid || !phrase) return null;
  return { id, tid, phrase, comment: sStr(n.comment, 4000) };
}
function sSession(s) {
  if (!isObj(s)) return null;
  const id = sId(s.id); if (!id) return null;
  return {
    id, date: sTs(s.date) || Date.now(), thoughtIds: sIds(s.thoughtIds, LIM.sessThoughts),
    notes: cleanList(s.notes, sNote, LIM.notes), conclusion: sStr(s.conclusion, 4000),
    linked: sIds(s.linked, LIM.linked), open: sBool(s.open), u: sTs(s.u)
  };
}
function sLabels(l) {
  l = isObj(l) ? l : {};
  const out = { zones: {}, levels: [], u: sTs(l.u) };
  const z = isObj(l.zones) ? l.zones : {};
  for (const k of ZONES) { const v = sLine(z[k], 60); out.zones[k] = v || ZONE_DEF[k]; }
  const lv = Array.isArray(l.levels) ? l.levels : [];
  for (const i of LEVELS) { const v = sLine(lv[i], 30); out.levels[i] = v || LEVEL_DEF[i]; }
  return out;
}
function sDel(d) {
  const out = {}, cut = Date.now() - 400 * 864e5;
  if (isObj(d)) for (const k of Object.keys(d)) { const id = sId(k), t = sTs(d[k]); if (id && t && t > cut) out[id] = t; }
  return out;
}
function sMeta(m) {
  m = isObj(m) ? m : {};
  return { lastExport: sTs(m.lastExport), changes: Math.round(sNum(m.changes, 0, 1e7, 0)), welcomed: sBool(m.welcomed) };
}
function sanitizeState(o) {
  o = isObj(o) ? o : {};
  const st = {
    v: 1,
    people: cleanList(o.people, sPerson, LIM.people),
    actions: cleanList(o.actions, sAction, LIM.actions),
    thoughts: cleanList(o.thoughts, sThought, LIM.thoughts),
    sessions: cleanList(o.sessions, sSession, LIM.sessions),
    labels: sLabels(o.labels), del: sDel(o.del), meta: sMeta(o.meta)
  };
  const pids = new Set(st.people.map(p => p.id));
  st.actions = st.actions.filter(a => pids.has(a.pid));
  for (const t of st.thoughts) if (t.pid && !pids.has(t.pid)) t.pid = '';
  /* only one session can be open: keep the most recently changed one */
  const open = st.sessions.filter(s => s.open).sort((a, b) => (b.u || b.date) - (a.u || a.date));
  open.slice(1).forEach(s => { s.open = false; });
  return st;
}
const emptyState = () => sanitizeState({});

/* ---------- device-only preferences (never synced, never in backups) ---------- */
function sDev(o) {
  o = isObj(o) ? o : {};
  return {
    theme: ['earth', 'forest', 'sea', 'wind'].includes(o.theme) ? o.theme : '',
    random: o.random === undefined ? true : sBool(o.random),
    lite: sBool(o.lite), autoLite: sBool(o.autoLite), lastTheme: sLine(o.lastTheme, 10), preview: sTs(o.preview) ? sTs(o.preview) : 0
  };
}

/* ---------- storage (every call guarded) ---------- */
let STORAGE_OK = true;
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { STORAGE_OK = false; return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { STORAGE_OK = false; if (typeof storageBanner === 'function') storageBanner(); return false; } }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
function loadState() {
  const raw = lsGet(LS_KEY);
  if (!raw) return emptyState();
  try { return sanitizeState(JSON.parse(raw)); } catch (e) { return emptyState(); }
}

/* ---------- backup file ---------- */
function stamp(d) { d = new Date(d); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()); }
function backupJSON(st) {
  const c = sanitizeState(st);
  const data = { people: c.people, actions: c.actions, thoughts: c.thoughts, sessions: c.sessions, labels: c.labels, del: c.del };
  return JSON.stringify({ app: APP_ID, v: 1, exported: new Date().toISOString(), data }, null, 1);
}
const backupName = () => 'kokoro-backup-' + stamp(Date.now()) + '.json';

/* ---------- reading any supported file: Kokoro backups and the three old tools ---------- */
function oldScoreToLevel(score) { const z = Math.min(3, Math.max(0, Math.round((Number(score) || 0) / (100 / 3)))); return [1, 2, 3, 4][z]; }
function convOldKokoro(d) {
  const out = { people: [], actions: [] };
  if (!isObj(d) || !Array.isArray(d.people)) return out;
  for (const p of d.people) {
    if (!isObj(p)) continue;
    const id = sId(p.id); if (!id) continue;
    const u = sTs(p.updated) || sTs(p.created) || 1;
    out.people.push({ id, name: p.name, rel: p.relation, traits: p.traits, refl: p.reflections, created: sTs(p.created) || u, u });
    if (Array.isArray(p.actions)) for (const a of p.actions) {
      if (!isObj(a)) continue;
      out.actions.push({ id: sId(a.id), pid: id, title: a.title, detail: a.detail, date: a.date, level: oldScoreToLevel(a.score), created: sTs(a.created) || u, u: sTs(a.created) || u });
    }
  }
  return out;
}
function convOldMap(d) {
  const out = { people: [], zones: null };
  if (!isObj(d)) return out;
  const t0 = Date.now();
  if (Array.isArray(d.items)) for (const it of d.items) {
    if (!isObj(it)) continue;
    const name = sLine(it.name, 60), placed = it.xPct != null && it.yPct != null && Number.isFinite(Number(it.xPct));
    if (!name && !placed && !sStr(it.note, 10)) continue;   // the old map's empty starter dots
    out.people.push({ id: 'map' + sId(it.id || uid()), name: name || 'Unnamed', note: it.note, place: placed ? { x: it.xPct, y: it.yPct } : null, created: t0, u: 1 });
  }
  if (isObj(d.labels)) {
    const z = {}; let custom = false;
    for (const k of ZONES) { const v = sLine(d.labels[k], 60); if (v && v !== ZONE_VI_DEF[k]) { z[k] = v; custom = true; } }
    if (custom) out.zones = z;
  }
  return out;
}
function convOldStress(d) {
  const out = { thoughts: [], sessions: [] };
  if (!isObj(d)) return out;
  if (Array.isArray(d.thoughts)) for (const t of d.thoughts) if (isObj(t)) {
    const dt = sTs(t.date) || 1;
    out.thoughts.push({ id: t.id, text: t.text, type: t.type, date: dt, u: dt });
  }
  if (Array.isArray(d.sessions)) for (const s of d.sessions) if (isObj(s)) {
    const dt = sTs(s.date) || 1;
    out.sessions.push({
      id: s.id, date: dt, thoughtIds: s.thoughtIds, conclusion: s.conclusion, linked: s.linkedThoughtIds,
      notes: Array.isArray(s.annotations) ? s.annotations.map(a => isObj(a) ? { id: a.id, tid: a.thoughtId, phrase: a.phrase, comment: a.comment } : null) : [],
      open: s.id === d.currentSessionId, u: dt
    });
  }
  return out;
}
/* Turns any supported file into {state, summary}. Throws {msg} for files it can't use. */
function parseImport(text) {
  let o;
  try { o = JSON.parse(text); } catch (e) { throw { msg: 'That file isn’t valid JSON, so it can’t be imported.' }; }
  if (!isObj(o)) throw { msg: 'That file isn’t a Kokoro backup.' };
  let parts = { people: [], actions: [], thoughts: [], sessions: [] }, zones = null, labels = null, kind = '';
  const notes = [];
  if (o.app === APP_ID && isObj(o.data)) { kind = 'backup'; const c = sanitizeState(o.data); parts = c; labels = c.labels; }
  else if (o.app === 'kokoro-legacy' || o.app === APP_ID && Array.isArray(o.people) || Array.isArray(o.items) || (Array.isArray(o.thoughts) && Array.isArray(o.sessions))) {
    kind = 'old';
    const ko = o.app === 'kokoro-legacy' ? o.kokoro : (Array.isArray(o.people) ? o : null);
    const mp = o.app === 'kokoro-legacy' ? o.map : (Array.isArray(o.items) ? o : null);
    const stz = o.app === 'kokoro-legacy' ? o.stress : (Array.isArray(o.thoughts) ? o : null);
    const k = convOldKokoro(ko), m = convOldMap(mp), s = convOldStress(stz);
    /* a map dot with the same name as a Kokoro person becomes that person's place on the map */
    const byName = new Map(k.people.map(p => [String(p.name || '').trim().toLowerCase(), p]));
    let joined = 0;
    for (const mpp of m.people) {
      const twin = byName.get(String(mpp.name).trim().toLowerCase());
      if (twin && mpp.name !== 'Unnamed') {
        if (!twin.place && mpp.place) twin.place = mpp.place;
        const n = sStr(mpp.note, 4000); if (n) twin.note = (twin.note ? twin.note + '\n' : '') + n;
        joined++;
      } else k.people.push(mpp);
    }
    if (joined) notes.push(joined + ' map ' + (joined === 1 ? 'dot was' : 'dots were') + ' matched to Kokoro people by name');
    parts = sanitizeState({ people: k.people, actions: k.actions, thoughts: s.thoughts, sessions: s.sessions });
    zones = m.zones;
    if (ko) notes.push('Kokoro: ' + (ko.people || []).length + ' people');
    if (mp) notes.push('Boundary map: ' + m.people.length + ' dots');
    if (stz) notes.push('Stress test: ' + s.thoughts.length + ' thoughts, ' + s.sessions.length + ' sessions');
    if (!ko && !mp && !stz) throw { msg: 'No data was found in that file.' };
  } else if (o.app && o.app !== APP_ID) throw { msg: 'That backup belongs to another tool (' + sLine(o.app, 30) + ').' };
  else throw { msg: 'That file isn’t a Kokoro backup.' };
  const st = { people: parts.people, actions: parts.actions, thoughts: parts.thoughts, sessions: parts.sessions, labels, zones, del: kind === 'backup' ? parts.del : {} };
  const summary = { kind, people: st.people.length, actions: st.actions.length, thoughts: st.thoughts.length, sessions: st.sessions.length, notes };
  return { st, summary };
}

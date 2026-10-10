'use strict';
/* ===== app.js — state, saving, navigation layers, sheets, header, stability ===== */
let S = loadState();
let D = sDev((() => { try { return JSON.parse(lsGet(LS_DEV) || 'null'); } catch (e) { return null; } })());
let TAB = 'becoming';
let THEME = 'forest';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const trunc = (s, n) => s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
function fmtDay(t) { const d = new Date(t); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }); }
function fmtWhen(t) {
  const d = new Date(t), now = new Date();
  const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (keyOf(d) === keyOf(now)) return 'Today ' + hm;
  if (keyOf(d) === keyOf(Date.now() - 864e5)) return 'Yesterday ' + hm;
  if (now - d < 6 * 864e5) return d.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' + hm;
  return fmtDay(t) + ' · ' + hm;
}
function fmtDateKey(k) { const d = new Date(k + 'T00:00:00'); return isNaN(d) ? k : fmtDay(d); }
const plural = (n, a, b) => n + ' ' + (n === 1 ? a : (b || a + 's'));
const getP = id => S.people.find(p => p.id === id);
const getT = id => S.thoughts.find(t => t.id === id);
const getS = id => S.sessions.find(s => s.id === id);
const openSession = () => S.sessions.find(s => s.open) || null;
const zoneName = k => k === 'none' ? 'Not on the map' : S.labels.zones[k] || ZONE_DEF[k];
const levelName = i => S.labels.levels[i] || LEVEL_DEF[i];
function zoneOf(place) {
  if (!place) return 'none';
  const dx = place.x - 50, dy = place.y - 50, dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= 13.6) return 'ring1'; if (dist <= 26.8) return 'ring2'; if (dist <= 40) return 'ring3';
  if (dx >= 0 && dy < 0) return 'q_tr'; if (dx >= 0) return 'q_br'; if (dy >= 0) return 'q_bl'; return 'q_tl';
}
const initial = name => esc((Array.from(String(name).trim())[0] || '?').toUpperCase());
const actsOf = pid => S.actions.filter(a => a.pid === pid).sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);

/* ---------- saving ---------- */
function persist() { return lsSet(LS_KEY, JSON.stringify(S)); }
function saveDev() { lsSet(LS_DEV, JSON.stringify(D)); }
function commit() {
  const n = stampChanges();
  if (n) { S.meta.changes += n; markDirty(); schedSync(); }
  persist();
}

/* ---------- diagnostics ---------- */
let DIAG = (() => { try { const a = JSON.parse(lsGet(LS_DIAG) || '[]'); return Array.isArray(a) ? a.slice(-40).map(x => sStr(x, 300)) : []; } catch (e) { return []; } })();
function logDiag(msg) {
  DIAG.push(new Date().toISOString().slice(0, 19).replace('T', ' ') + ' ' + sStr(String(msg), 280));
  DIAG = DIAG.slice(-40); lsSet(LS_DIAG, JSON.stringify(DIAG));
}
window.addEventListener('error', e => logDiag('error: ' + (e.message || '') + ' @' + (e.lineno || '')));
window.addEventListener('unhandledrejection', e => logDiag('promise: ' + (e.reason && (e.reason.message || e.reason.msg || e.reason.kind) || '')));

/* ---------- toast ---------- */
let toastT = 0;
function toast(msg, ms = 2400) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms); }
function storageBanner() {
  const b = $('#banner'); if (!b || !b.classList.contains('hidden')) return;
  b.innerHTML = '<span style="flex:1">Saving is blocked on this phone, so changes may be lost. Export a backup.</span><button data-act="exportNow">Export</button>';
  b.classList.remove('hidden');
}

/* ---------- typing guard ---------- */
function isTyping() { const a = document.activeElement; return !!a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'file'].includes(a.type)) || a.tagName === 'SELECT'); }

/* ---------- navigation layers (pages and sheets) with the Back-gesture guard ----------
   Every page or sheet pushes one history entry, so Android's Back closes it.
   On the main screen, the first Back shows a hint; a second Back within 2.5 s leaves. */
const LAY = [];
let HIST = true, expectPop = 0, queued = [], lastBack = 0;
function initHistory() {
  try { history.replaceState({ kk: 'root' }, ''); history.pushState({ kk: 'guard' }, ''); }
  catch (e) { HIST = false; logDiag('history blocked'); }
}
function pushLayer(entry) {
  if (expectPop > 0) { queued.push(entry); return; }
  LAY.push(entry);
  if (HIST) { try { history.pushState({ kk: 'L', n: LAY.length }, ''); } catch (e) { HIST = false; } }
  applyLayers();
}
function popLayerUI() {
  if (!LAY.length) return;
  LAY.pop();
  applyLayers();
  if (HIST) {
    let ours = false; try { ours = !!(history.state && history.state.kk === 'L'); } catch (e) { ours = false; }
    if (ours) { expectPop++; history.back(); }
  }
}
window.addEventListener('popstate', () => {
  if (expectPop > 0) {
    expectPop--;
    if (!expectPop && queued.length) { const q = queued; queued = []; q.forEach(pushLayer); }
    return;
  }
  if (LAY.length) { LAY.pop(); applyLayers(); return; }
  const now = Date.now();
  if (now - lastBack < 2500) { try { history.back(); } catch (e) { /* ignore */ } return; }
  lastBack = now;
  toast('Swipe back again to leave');
  try { history.pushState({ kk: 'guard' }, ''); } catch (e) { HIST = false; }
});
const topView = () => { for (let i = LAY.length - 1; i >= 0; i--) if (LAY[i].kind === 'view') return LAY[i]; return null; };
const topSheet = () => { const t = LAY[LAY.length - 1]; return t && t.kind === 'sheet' ? t : null; };
let shownViewKey = '';
function applyLayers() {
  const v = topView(), key = v ? v.type + ':' + v.id : 'tab:' + TAB;
  if (key !== shownViewKey) { shownViewKey = key; render(); window.scrollTo(0, v && v.scroll ? v.scroll : 0); }
  const sh = topSheet();
  const ov = $('#ov');
  if (!sh) { if (ov) ov.remove(); return; }
  drawSheet(sh);
}
function openView(type, id) {
  const cur = topView(); if (cur) cur.scroll = window.scrollY; else TABSCROLL[TAB] = window.scrollY;
  /* opening a page from inside a sheet: close the sheet first */
  if (topSheet()) popLayerUI();
  pushLayer({ kind: 'view', type, id });
}
const TABSCROLL = {};
function popAllUI() {
  const n = LAY.length; if (!n) return;
  LAY.length = 0; applyLayers();
  if (HIST) {
    let ours = false; try { ours = !!(history.state && history.state.kk === 'L'); } catch (e) { ours = false; }
    if (ours) { expectPop++; history.go(-n); }
  }
}
function goTab(t) {
  popAllUI();
  if (TAB !== t) { TABSCROLL[TAB] = window.scrollY; TAB = t; }
  shownViewKey = ''; render(); window.scrollTo(0, 0);
}

/* ---------- sheets ---------- */
function openSheet(build, opts = {}) {
  const top = topSheet();
  if (top) { top.build = build; top.opts = opts; drawSheet(top, true); return; }
  pushLayer({ kind: 'sheet', build, opts });
}
function closeSheet() { if (topSheet()) popLayerUI(); }
function drawSheet(sh, fresh) {
  let ov = $('#ov');
  if (ov && ov._sh === sh && !fresh) return;
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'ov'; ov.className = 'ov';
    ov.innerHTML = '<div class="sheet" role="dialog" aria-modal="true"></div>';
    ov.addEventListener('click', e => { if (e.target === ov) closeSheet(); });
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('open'));
  }
  ov._sh = sh;
  const box = $('.sheet', ov);
  try { box.innerHTML = '<div class="grab"></div>' + sh.build(); box.scrollTop = 0; if (sh.opts.after) sh.opts.after(box); }
  catch (e) { logDiag('sheet: ' + e.message); box.innerHTML = '<div class="grab"></div><p>Something went wrong here. Your data is safe.</p><button class="btn w" data-act="closeSheet">Close</button>'; }
  if (sh.opts.focus) setTimeout(() => { const f = $(sh.opts.focus, box); if (f) f.focus(); }, 280);
}
function refreshSheet() { const sh = topSheet(); if (sh && sh.opts.live && !isTyping()) drawSheet(sh, true); }
const sheetHead = (title, close = 'Close') => `<div class="shd"><h2 class="h2">${title}</h2><button class="x" data-act="closeSheet">${close}</button></div>`;

/* two taps for anything destructive */
function armed(btn, label) {
  if (btn.dataset.armed === '1') return true;
  const orig = btn.textContent; btn.dataset.armed = '1'; btn.textContent = label || 'Tap again to confirm'; btn.classList.add('armed');
  setTimeout(() => { if (btn.isConnected) { btn.dataset.armed = ''; btn.textContent = orig; btn.classList.remove('armed'); } }, 3000);
  return false;
}

/* ---------- theme ---------- */
function pickTheme() {
  const keys = Object.keys(THEMES);
  if (!D.random && D.theme) return D.theme;
  const pool = keys.filter(k => k !== D.lastTheme);
  const t = pool[Math.floor(Math.random() * pool.length)];
  D.lastTheme = t; saveDev();
  return t;
}
function applyTheme(t) {
  THEME = THEMES[t] ? t : 'forest';
  const T = THEMES[THEME], r = document.documentElement.style;
  r.setProperty('--ac', T.ac); r.setProperty('--ac2', T.ac2); r.setProperty('--bg', T.bg);
  const m = $('meta[name=theme-color]'); if (m) m.content = T.sky[0];
}

/* ---------- header ---------- */
let PHASE = '';
function headerHTML(v) {
  const now = new Date(); PHASE = phaseOf(now);
  const dark = PHASE === 'dusk' || PHASE === 'night';
  const hm = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  let left;
  if (v) {
    const title = v.type === 'person' ? (getP(v.id) || {}).name || '' : 'Session';
    left = `<button class="backb" data-act="back" aria-label="Back">‹</button><div class="grow"><div class="hdt one">${esc(title)}</div><div class="hsub">${esc(date)}</div></div>`;
  } else {
    left = `<div class="stamp" aria-hidden="true">心</div><div class="grow"><div class="hdt">Kokoro</div><div class="hsub">${esc(date)}</div></div>`;
  }
  return `<div class="hd${v ? ' sub' : ''}${dark ? ' dark' : ''}" id="hd"><img alt="" src="${sceneURL(THEME, PHASE)}"><div class="hdin">${left}<div class="clock"><span class="sdot s-${SY.st}${SC.on ? '' : ' hidden'}" id="sdot" title="${esc(syncLine())}" data-act="syncDot"></span><span id="clk">${hm}</span></div></div></div>`;
}
function tickClock() {
  const now = new Date();
  if (phaseOf(now) !== PHASE) { const h = $('#hd'); if (h) { const tmp = document.createElement('div'); tmp.innerHTML = headerHTML(topView()); h.replaceWith(tmp.firstChild); } return; }
  const c = $('#clk'); if (c) c.textContent = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/* ---------- tabs ---------- */
const ICONS = {
  map: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg>',
  people: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14c3 0 5 2 5 5"/></svg>',
  becoming: '<svg viewBox="0 0 24 24"><path d="M12 21v-8"/><path d="M12 13c0-4 3-7 7-7 0 4-3 7-7 7z"/><path d="M12 15c0-3-2.5-5.5-6-5.5 0 3 2.5 5.5 6 5.5z"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/></svg>'
};
function tabsHTML() {
  const t = (k, n) => `<button class="tab${TAB === k && !topView() ? ' on' : ''}" data-act="tab" data-v="${k}">${ICONS[k]}<span>${n}</span></button>`;
  return t('becoming', 'Becoming') + t('map', 'Map') + `<button class="fab" data-act="fab" aria-label="Add"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>` + t('people', 'People') + t('settings', 'Settings');
}

/* ---------- render ---------- */
function render() {
  try {
    const v = topView();
    let body;
    if (v && v.type === 'person') { const p = getP(v.id); body = p ? personView(p) : goneView('That person was removed.'); }
    else if (v && v.type === 'session') { const s = getS(v.id); body = s ? sessionView(s) : goneView('That session was removed.'); }
    else body = { becoming: becomingView, map: mapView, people: peopleView, settings: settingsView }[TAB]();
    $('#app').innerHTML = headerHTML(v) + '<div class="wrap" id="main">' + body + '</div>';
    $('#tabs').innerHTML = tabsHTML();
    afterRender(v);
  } catch (e) {
    logDiag('render: ' + (e && e.message) + ' ' + (e && e.stack ? e.stack.split('\n')[1] : ''));
    $('#app').innerHTML = `<div class="crash"><div class="stamp" style="margin:0 auto 14px">心</div><p><b>Something went wrong on this screen.</b></p><p class="sm">Your data is safe. Export a backup, then try another tab.</p><div class="btns"><button class="btn" data-act="exportNow">Export backup</button><button class="btn g" data-act="tab" data-v="becoming">Go to Becoming</button></div></div>`;
  }
}
function goneView(msg) { return `<div class="card"><div class="empty"><b>Not found</b>${esc(msg)}</div><button class="btn w g" data-act="back">Go back</button></div>`; }
function softRender() {
  if (isTyping()) { renderWaiting = true; return; }
  renderWaiting = false;
  const y = window.scrollY; render(); window.scrollTo(0, y); refreshSheet();
}
function afterRender(v) {
  if (v && v.type === 'session') bindSession(getS(v.id));
  if (!v && TAB === 'map') bindMap();
}
document.addEventListener('focusout', () => setTimeout(() => { if (renderWaiting && !isTyping()) softRender(); }, 60));

/* ---------- Lite mode: turns itself on after an unexpected close ---------- */
function checkCrash() {
  try {
    const v = JSON.parse(lsGet(LS_VIS) || 'null');
    if (isObj(v) && v.vis === 1 && Date.now() - (v.t || 0) < 10 * 60e3 && !D.lite) {
      D.lite = true; D.autoLite = true; saveDev();
      logDiag('last session closed unexpectedly: Lite mode on');
      setTimeout(() => toast('Kokoro closed unexpectedly last time, so Lite mode is on. Change it in Settings.', 4200), 600);
    }
  } catch (e) { /* ignore */ }
}
function markVisible(vis) { lsSet(LS_VIS, JSON.stringify({ vis: vis ? 1 : 0, t: Date.now() })); }
function applyLite() { document.body.classList.toggle('lite', !!D.lite); }

/* ---------- start ---------- */
function start() {
  checkCrash(); applyLite();
  applyTheme(pickTheme());
  loadSC(); takeSnap();
  if (!STORAGE_OK) storageBanner();
  initHistory();
  render();
  markVisible(true);
  setInterval(() => { if (!document.hidden) { tickClock(); markVisible(true); } }, 15000);
  setInterval(() => { if (!document.hidden && SC.on) syncNow(false); }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { flushTyping(); markVisible(false); flushOnHide(); }
    else { markVisible(true); tickClock(); if (SC.on) syncNow(false); }
  });
  window.addEventListener('pagehide', () => { flushTyping(); markVisible(false); flushOnHide(); });
  window.addEventListener('online', () => { if (SC.on) syncNow(false); });
  if (SC.on) { setSync('busy'); syncNow(false); }
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(e => logDiag('sw: ' + e.message));
}
/* text boxes save as you type (debounced); this writes any pending text right away */
const PENDING = new Map();
function typeSave(key, fn, ms = 500) { clearTimeout((PENDING.get(key) || {}).t); PENDING.set(key, { fn, t: setTimeout(() => { PENDING.delete(key); fn(); }, ms) }); }
function flushTyping() { for (const [k, v] of PENDING) { clearTimeout(v.t); PENDING.delete(k); try { v.fn(); } catch (e) { logDiag('flush: ' + e.message); } } }

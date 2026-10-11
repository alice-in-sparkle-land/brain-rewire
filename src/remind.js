'use strict';
/* ===== remind.js — the daily reminder (web push through the sync site) =====
   This phone subscribes once; the Worker's 5-minute schedule decides when to send.
   Nothing about your thoughts is sent in the notification: the phone shows a fixed line. */
const LS_PUSH = 'kkr.push';
const PU = (() => {
  try {
    const o = JSON.parse(lsGet(LS_PUSH) || 'null') || {};
    return { on: sBool(o.on), time: /^\d{2}:\d{2}$/.test(o.time) ? o.time : '21:00', endpoint: sStr(o.endpoint, 1000), msg: '' };
  } catch (e) { return { on: false, time: '21:00', endpoint: '', msg: '' }; }
})();
const savePU = () => lsSet(LS_PUSH, JSON.stringify({ on: PU.on, time: PU.time, endpoint: PU.endpoint }));
let PU_BUSY = false;

const pushSupported = () => !!(window.isSecureContext && /^https?:$/.test(location.protocol) && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
const localTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } };
function keyBytes(b64) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
function sameKey(buf, b64) {
  if (!buf) return false;
  const a = new Uint8Array(buf), b = keyBytes(b64);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
function swReady(ms = 8000) {
  return Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no({ kind: 'sw' }), ms))]);
}
function remindErr(e) {
  if (e && e.kind === 'sw') return 'Kokoro’s offline helper isn’t running yet. Reload the page and try again.';
  if (e && e.name === 'NotAllowedError') return 'Notifications are blocked for this site.';
  if (e && e.kind) return syncErrText(e);
  return 'Couldn’t set up the reminder (' + sStr(e && (e.message || e.name) || 'unknown', 80) + ').';
}

/* subscribe this phone (or refresh its subscription) and tell the Worker the time */
async function pushSubscribe() {
  const reg = await swReady();
  const { key } = await api('GET', '/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options && sub.options.applicationServerKey, key)) { try { await sub.unsubscribe(); } catch (e) { /* ignore */ } sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  if (PU.endpoint && PU.endpoint !== sub.endpoint) { try { await api('DELETE', '/push/sub', { endpoint: PU.endpoint }); } catch (e) { /* old one */ } }
  const r = await api('PUT', '/push/sub', { endpoint: sub.endpoint, time: PU.time, tz: localTz(), slot: SC.slot });
  PU.endpoint = sub.endpoint; PU.on = true; savePU();
  return r;
}
async function remindOn() {
  if (PU_BUSY) return; PU_BUSY = true; PU.msg = 'Setting up…'; drawRemind();
  try {
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (perm !== 'granted') { PU.on = false; savePU(); PU.msg = perm === 'denied' ? 'blocked' : 'Allow notifications to turn the reminder on.'; return; }
    const r = await pushSubscribe();
    PU.msg = r && r.next === 'tomorrow' ? `Done. The first reminder comes tomorrow at ${PU.time}.` : `Done. The first reminder comes today at ${PU.time}.`;
  } catch (e) { PU.on = false; savePU(); PU.msg = remindErr(e); logDiag('remind on: ' + (e && (e.kind || e.message || e.name))); }
  finally { PU_BUSY = false; drawRemind(); }
}
async function remindOff(quiet) {
  const ep = PU.endpoint;
  PU.on = false; savePU(); if (!quiet) { PU.msg = 'Reminder off.'; drawRemind(); }
  try { if (ep && SC.on) await api('DELETE', '/push/sub', { endpoint: ep }); } catch (e) { logDiag('remind off: ' + (e && (e.kind || e.message))); }
  try { const reg = await swReady(3000); const sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch (e) { /* ignore */ }
  PU.endpoint = ''; savePU();
}
async function remindTime(v) {
  if (!/^\d{2}:\d{2}$/.test(v)) return;
  PU.time = v; savePU();
  if (!PU.on) return;
  PU.msg = 'Saving…'; drawRemind();
  try { const r = await pushSubscribe(); PU.msg = `Saved. Next reminder ${r && r.next === 'tomorrow' ? 'tomorrow' : 'today'} at ${PU.time}.`; }
  catch (e) { PU.msg = remindErr(e); }
  drawRemind();
}
async function remindTest() {
  if (!PU.endpoint) return;
  PU.msg = 'Sending a test…'; drawRemind();
  try {
    const r = await api('POST', '/push/test', { endpoint: PU.endpoint });
    if (r.ok) PU.msg = 'Sent. It should appear within a few seconds.';
    else if (r.status === 404 || r.status === 410) { PU.on = false; PU.endpoint = ''; savePU(); PU.msg = 'This phone’s reminder had expired. Turn it on again.'; }
    else PU.msg = 'The notification service didn’t accept it' + (r.status ? ` (code ${r.status})` : '') + '. Try again in a minute.';
  } catch (e) { PU.msg = remindErr(e); }
  drawRemind();
}
/* on opening Kokoro: keep the subscription fresh (phones sometimes replace it quietly) */
async function remindRefresh() {
  if (!PU.on || !SC.on || !pushSupported() || Notification.permission !== 'granted') return;
  try { await pushSubscribe(); } catch (e) { logDiag('remind refresh: ' + (e && (e.kind || e.message || e.name))); }
}

function remindInner() {
  let h = '<div class="lbl">Daily reminder</div>';
  if (!pushSupported()) return h + '<p class="sm" style="margin:6px 0 0">Reminders need Kokoro opened from its web address in Chrome, such as kokoro.alicecabinet.com, not as a saved file.</p>';
  if (!SC.on) return h + '<p class="sm" style="margin:6px 0 0">Your sync site sends the reminder, so connect Cloud sync above first.</p>';
  const blocked = Notification.permission === 'denied' || PU.msg === 'blocked';
  h += `<label class="toggle" style="margin-top:4px"><input type="checkbox" data-in="remindOn" ${PU.on ? 'checked' : ''} ${PU_BUSY || blocked ? 'disabled' : ''}> Remind me every day</label>
    <div class="row0"><label for="remT" class="sm" style="flex:none">At</label><input class="in" id="remT" type="time" data-in="remindTime" value="${esc(PU.time)}" style="max-width:150px"></div>
    <p class="sm" style="margin:8px 0 0">“Time for a moment with Kokoro.” Skipped on days you’ve already written a thought (once this phone has synced).</p>`;
  if (blocked) h += '<p class="sm" style="margin:8px 0 0;color:var(--danger)">Notifications are blocked for this site. In Chrome tap ⋮ → Settings → Site settings → Notifications, allow this site, then come back.</p>';
  else if (PU.on && Notification.permission !== 'granted') h += '<p class="sm" style="margin:8px 0 0;color:var(--danger)">Notifications were turned off for this site, so reminders can’t show. Turn the switch off and on again.</p>';
  if (PU.msg && PU.msg !== 'blocked') h += `<p class="sm" style="margin:8px 0 0">${esc(PU.msg)}</p>`;
  if (PU.on) h += '<button class="btn g sm2" style="margin-top:10px" data-act="remindTest">Send a test</button>';
  return h;
}
function drawRemind() { const b = document.getElementById('remindBox'); if (b) b.innerHTML = remindInner(); }

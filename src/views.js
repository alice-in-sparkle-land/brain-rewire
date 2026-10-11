'use strict';
/* ===== views.js — Becoming, sessions, Map, People, person pages, Settings ===== */

/* ---------- shared bits ---------- */
const typeTag = t => `<span class="tag" style="background:${TYPE_BG[t]};color:${TYPE_INK[t]}">${TYPE_NAME[t]}</span>`;
const personChip = pid => { const p = pid && getP(pid); return p ? `<span class="pp">${esc(p.name)}</span>` : ''; };
const levelDot = (lv, sz = 9) => `<i style="width:${sz}px;height:${sz}px;border-radius:50%;display:inline-block;background:${LEVEL_COL[lv]}"></i>`;
function typeButtons(cur, act) {
  return `<div class="typeb">${TYPES.map(t => `<button type="button" data-act="${act}" data-v="${t}" class="${cur === t ? 'on' : ''}" style="${cur === t ? `background:${TYPE_COL[t]};border-color:${TYPE_COL[t]}` : ''}" aria-pressed="${cur === t}">${TYPE_LONG[t]}</button>`).join('')}</div>`;
}
function setTypeButtons(box, cur) {
  $$('.typeb button', box).forEach(b => { const on = b.dataset.v === cur; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.style.background = on ? TYPE_COL[b.dataset.v] : ''; b.style.borderColor = on ? TYPE_COL[b.dataset.v] : ''; });
}
function personSelect(id, cur, attrs = '') {
  const ps = [...S.people].sort((a, b) => a.name.localeCompare(b.name));
  return `<select class="in" id="${id}" ${attrs}><option value="">No one in particular</option>${ps.map(p => `<option value="${esc(p.id)}"${p.id === cur ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;
}
function copyText(text) {
  const fallback = () => { const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; } ta.remove(); return ok; };
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(() => true, () => fallback());
  return Promise.resolve(fallback());
}
function download(name, text, type) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  } catch (e) { logDiag('download: ' + e.message); return false; }
}

/* =====================================================================
   BECOMING — write thoughts, tag them, stress test them in sessions
   ===================================================================== */
let DRAFT = (() => { try { const o = JSON.parse(lsGet('kkr.draft') || 'null'); return { text: sStr(o && o.text, 2000), type: TYPES.includes(o && o.type) ? o.type : '', pid: sId(o && o.pid) }; } catch (e) { return { text: '', type: '', pid: '' }; } })();
const saveDraft = () => lsSet('kkr.draft', JSON.stringify(DRAFT));
let JUST_SAVED = '', LIBF = 'all', LIBN = 40, SESN = 10;

function becomingView() {
  const os = openSession();
  const lib = [...S.thoughts].filter(t => LIBF === 'all' || t.type === LIBF).sort((a, b) => b.date - a.date);
  const all = S.thoughts.length;
  if (DRAFT.pid && !getP(DRAFT.pid)) DRAFT.pid = '';
  let h = `<div class="card">
    <label class="lbl" for="newT">Write a thought</label>
    <textarea class="in" id="newT" data-in="draftText" rows="3" maxlength="2000" placeholder="My capacity is not enough for more serious things." style="margin-top:8px">${esc(DRAFT.text)}</textarea>
    <div style="margin-top:10px" id="draftTypes">${typeButtons(DRAFT.type, 'draftType')}</div>
    <div class="fld"><label for="draftP">About someone? (optional)</label>${personSelect('draftP', DRAFT.pid, 'data-in="draftP"')}</div>
    <div class="err" id="newErr"></div>
    <button class="btn w" style="margin-top:12px" data-act="saveThought">Save thought</button>
    ${JUST_SAVED && getT(JUST_SAVED) ? `<p class="sm" style="margin:10px 0 0">Saved. <button class="link" data-act="stressIt" data-id="${esc(JUST_SAVED)}">Stress test it now →</button></p>` : ''}
  </div>`;
  if (os) {
    h += `<div class="card ban"><div class="lbl" style="color:var(--ac)">Open session · since ${esc(fmtWhen(os.date))}</div>
      <p class="sm" style="margin:4px 0 0">${plural(os.thoughtIds.length, 'thought')} · ${plural(os.notes.length, 'note')}</p>
      <button class="btn w" style="margin-top:10px" data-act="openSession" data-id="${esc(os.id)}">Continue session</button></div>`;
  }
  h += `<div class="card"><div class="between"><span class="lbl">Thought library · ${all}</span><button class="link" data-act="newSession">+ New session</button></div>`;
  if (all) {
    h += `<div class="seg" style="margin:10px 0 2px">${['all', ...TYPES].map(f => `<button data-act="libF" data-v="${f}" class="${LIBF === f ? 'on' : ''}">${f === 'all' ? 'All' : TYPE_NAME[f]}</button>`).join('')}</div>`;
    h += lib.length ? lib.slice(0, LIBN).map(t => `<button class="tl" data-act="thought" data-id="${esc(t.id)}"><div class="between"><span>${typeTag(t.type)} ${personChip(t.pid)}</span><span class="sm">${esc(fmtWhen(t.date))}</span></div><div class="tx">${esc(trunc(t.text, 220))}</div></button>`).join('')
      : `<div class="empty">No ${TYPE_NAME[LIBF] || ''} thoughts yet.</div>`;
    if (lib.length > LIBN) h += `<button class="btn g w sm2" style="margin:6px 0 4px" data-act="libMore">Show more (${lib.length - LIBN})</button>`;
  } else h += `<div class="empty"><b>Your library is empty</b>Write a thought above and tag it. It lands here, newest first.</div>`;
  h += `</div>`;
  const ss = [...S.sessions].sort((a, b) => b.date - a.date);
  h += `<div class="card"><div class="lbl">Past sessions · ${ss.length}</div>`;
  h += ss.length ? ss.slice(0, SESN).map(s => {
    const first = s.thoughtIds.map(getT).find(Boolean);
    const snip = s.conclusion || (first ? first.text : '');
    return `<button class="tl" data-act="openSession" data-id="${esc(s.id)}"><div class="between"><span class="sm">${esc(fmtWhen(s.date))}${s.open ? ' · <b style="color:var(--ac)">open</b>' : ''}</span><span class="sm">${plural(s.thoughtIds.length, 'thought')} · ${plural(s.notes.length, 'note')}</span></div>${snip ? `<div class="tx">${esc(trunc(snip, 120))}</div>` : ''}</button>`;
  }).join('') : `<div class="empty">No sessions yet. Pick thoughts with “+ New session” to pull them apart word by word.</div>`;
  if (ss.length > SESN) h += `<button class="btn g w sm2" style="margin:6px 0 4px" data-act="sesMore">Show more (${ss.length - SESN})</button>`;
  h += `</div>`;
  const stale = !S.meta.lastExport || Date.now() - S.meta.lastExport > 7 * 864e5;
  if (S.meta.changes > 0 && stale && !SC.on) h += `<p class="sm" style="text-align:center;margin:4px 0 12px">${plural(S.meta.changes, 'change')} since your last backup · <button class="link" data-act="exportNow">Export</button></p>`;
  return h;
}
function saveThought() {
  const text = sStr(DRAFT.text, 2000).trim(), err = $('#newErr');
  if (!text) { err.textContent = 'Write the thought first.'; $('#newT').focus(); return; }
  if (!DRAFT.type) { err.textContent = 'Pick what kind of thought this is: Spiral, Hope or Fact.'; return; }
  const t = { id: uid(), text, type: DRAFT.type, pid: getP(DRAFT.pid) ? DRAFT.pid : '', date: Date.now(), u: 0 };
  S.thoughts.push(t); commit();
  JUST_SAVED = t.id; DRAFT = { text: '', type: '', pid: '' }; saveDraft();
  render(); toast('Thought saved');
}
function stressIt(tid) {
  if (!getT(tid)) return;
  let s = openSession();
  if (s) { if (!s.thoughtIds.includes(tid)) s.thoughtIds.push(tid); }
  else { s = { id: uid(), date: Date.now(), thoughtIds: [tid], notes: [], conclusion: '', linked: [], open: true, u: 0 }; S.sessions.push(s); }
  commit(); JUST_SAVED = '';
  openView('session', s.id);
}

/* thought sheet: edit, re-tag, link to a person, stress test, delete */
let TEDIT = null;
function thoughtSheet(tid) {
  const t = getT(tid); if (!t) return;
  TEDIT = { id: t.id, type: t.type };
  const inS = S.sessions.filter(s => s.thoughtIds.includes(t.id) || s.linked.includes(t.id)).sort((a, b) => b.date - a.date);
  openSheet(() => `${sheetHead('Thought')}
    <p class="sm" style="margin:0 0 6px">Saved ${esc(fmtWhen(t.date))}</p>
    <textarea class="in" id="teText" rows="4" maxlength="2000">${esc(t.text)}</textarea>
    <div style="margin-top:10px" id="teTypes">${typeButtons(TEDIT.type, 'teType')}</div>
    <div class="fld"><label for="teP">About someone?</label>${personSelect('teP', t.pid)}</div>
    <div class="err" id="teErr"></div>
    <div class="btns"><button class="btn o" data-act="stressItS" data-id="${esc(t.id)}">Stress test it</button><button class="btn" data-act="teSave">Save</button></div>
    ${inS.length ? `<div class="lbl" style="margin-top:16px">In ${plural(inS.length, 'session')}</div>${inS.map(s => `<button class="tl" data-act="openSession" data-id="${esc(s.id)}"><span class="sm">${esc(fmtWhen(s.date))}${s.open ? ' · open' : ''} · ${plural(s.notes.filter(n => n.tid === t.id).length, 'note')}</span></button>`).join('')}` : ''}
    <button class="btn d w" style="margin-top:16px" data-act="teDel">Delete thought</button>`, { focus: null });
}
function deleteThought(id) {
  S.thoughts = S.thoughts.filter(t => t.id !== id);
  for (const s of S.sessions) { s.thoughtIds = s.thoughtIds.filter(x => x !== id); s.linked = s.linked.filter(x => x !== id); s.notes = s.notes.filter(n => n.tid !== id); }
  if (JUST_SAVED === id) JUST_SAVED = '';
  commit();
}

/* picker: start a new session or add thoughts to one */
let PICK = null;
function pickSheet(mode, sid) {
  const s = sid ? getS(sid) : null;
  const have = new Set(s ? s.thoughtIds : []);
  const list = [...S.thoughts].sort((a, b) => b.date - a.date).filter(t => !have.has(t.id));
  PICK = { mode, sid, f: 'all' };
  const os = openSession();
  openSheet(() => `${sheetHead(mode === 'add' ? 'Add thoughts' : 'New session')}
    <p class="sm" style="margin:0 0 8px">${mode === 'add' ? 'Tick the thoughts to add to this session.' : 'Tick one or more thoughts to work through together.' + (os ? ' Starting a new session closes the one that’s open.' : '')}</p>
    ${list.length ? `<div class="seg" style="margin-bottom:6px">${['all', ...TYPES].map(f => `<button data-act="pickF" data-v="${f}" class="${f === 'all' ? 'on' : ''}">${f === 'all' ? 'All' : TYPE_NAME[f]}</button>`).join('')}</div>
    <div id="pickList">${list.map(t => `<label class="pick" data-type="${t.type}"><input type="checkbox" value="${esc(t.id)}"><span class="grow">${typeTag(t.type)} ${personChip(t.pid)}<span style="display:block;margin-top:4px;overflow-wrap:anywhere">${esc(trunc(t.text, 200))}</span></span></label>`).join('')}</div>
    <div class="err" id="pickErr"></div>
    <button class="btn w" style="margin-top:12px" data-act="pickGo">${mode === 'add' ? 'Add to session' : 'Start session'}</button>`
      : `<div class="empty"><b>No thoughts to pick</b>${mode === 'add' ? 'Every thought is already in this session.' : 'Write a thought on the Becoming tab first.'}</div>`}`);
}
function pickGo() {
  const ids = $$('#pickList input:checked').map(i => i.value).filter(getT);
  if (!ids.length) { $('#pickErr').textContent = 'Tick at least one thought.'; return; }
  if (PICK.mode === 'add') {
    const s = getS(PICK.sid); if (!s) return closeSheet();
    ids.forEach(id => { if (!s.thoughtIds.includes(id)) s.thoughtIds.push(id); });
    commit(); closeSheet(); softRender(); toast(plural(ids.length, 'thought') + ' added');
  } else {
    S.sessions.forEach(x => { x.open = false; });
    const s = { id: uid(), date: Date.now(), thoughtIds: ids.slice(0, LIM.sessThoughts), notes: [], conclusion: '', linked: [], open: true, u: 0 };
    S.sessions.push(s); commit();
    openView('session', s.id);
  }
}

/* ---------- session page ---------- */
const PICKS = {};          // tapped words per thought, while on the session page
let LINKTYPE = '';
const words = text => text.match(/\S+/g) || [];
function sessionView(s) {
  let h = `<div class="card"><div class="between"><span class="lbl">Session · ${esc(fmtWhen(s.date))}</span>${s.open ? '<span class="tag" style="background:var(--ac);color:#fff">open</span>' : '<span class="sm">closed</span>'}</div>`;
  const ts = s.thoughtIds.map(getT).filter(Boolean);
  if (!ts.length) h += `<div class="empty">This session has no thoughts yet.</div>`;
  ts.forEach(t => {
    const pk = PICKS[t.id] || new Set();
    h += `<div class="tb"><div class="between"><span>${typeTag(t.type)} ${personChip(t.pid)}</span><button class="sm link" style="color:var(--mut)" data-act="unlinkT" data-t="${esc(t.id)}">Remove</button></div>
      <div style="margin:6px 0 4px" aria-label="Tap words to pick them">${words(t.text).map((w, i) => `<span class="wd${pk.has(i) ? ' pk' : ''}" role="button" tabindex="0" data-act="word" data-t="${esc(t.id)}" data-i="${i}">${esc(w)}</span>`).join(' ')}</div>
      <button class="btn o sm2" data-act="extract" data-t="${esc(t.id)}">Extract selected words</button>
      <div class="err" id="xerr-${esc(t.id)}"></div>
      ${s.notes.filter(n => n.tid === t.id).map(n => `<div class="note"><div class="between"><span class="ph">“${esc(n.phrase)}”</span><button class="sm link" style="color:var(--mut)" data-act="delNote" data-n="${esc(n.id)}">Remove</button></div>
        <textarea class="in" rows="2" maxlength="4000" data-in="note" data-n="${esc(n.id)}" placeholder="What’s really true about this part?">${esc(n.comment)}</textarea></div>`).join('')}
    </div>`;
  });
  h += `<button class="btn g w" style="margin-top:6px" data-act="addToSession">+ Add another thought</button></div>`;
  h += `<div class="card"><label class="lbl" for="concl">Conclusion (optional)</label>
    <textarea class="in" id="concl" rows="3" maxlength="4000" data-in="concl" placeholder="What did this session actually show you?" style="margin-top:8px">${esc(s.conclusion)}</textarea></div>`;
  const linked = s.linked.map(getT).filter(Boolean);
  h += `<div class="card"><div class="lbl">Link a new thought (optional)</div>
    ${linked.map(t => `<button class="tl" data-act="thought" data-id="${esc(t.id)}">${typeTag(t.type)} ${personChip(t.pid)}<div class="tx">${esc(t.text)}</div></button>`).join('')}
    <textarea class="in" id="linkT" rows="2" maxlength="2000" placeholder="My value depends on how big my measurable impact is." style="margin-top:10px"></textarea>
    <div style="margin-top:10px" id="linkTypes">${typeButtons(LINKTYPE, 'linkType')}</div>
    <div class="err" id="linkErr"></div>
    <button class="btn g w" style="margin-top:10px" data-act="linkNew">+ Save and link this thought</button></div>`;
  h += `<div class="btns"><button class="btn g" data-act="toggleOpen">${s.open ? 'Close session' : 'Reopen session'}</button><button class="btn" data-act="report">Report for Claude</button></div>
    <button class="btn d w" style="margin:12px 0 8px" data-act="delSession">Delete session</button>`;
  return h;
}
function bindSession() { /* all handled by delegation */ }
function curSession() { const v = topView(); return v && v.type === 'session' ? getS(v.id) : null; }
function extract(tid) {
  const s = curSession(), t = getT(tid); if (!s || !t) return;
  const pk = [...(PICKS[tid] || [])].sort((a, b) => a - b);
  if (!pk.length) { const e = $('#xerr-' + CSS.escape(tid)); if (e) e.textContent = 'Tap a word, or a few, in the sentence first.'; return; }
  const ws = words(t.text); let phrase = '';
  pk.forEach((i, k) => { if (k && i !== pk[k - 1] + 1) phrase += ' …'; phrase += (phrase ? ' ' : '') + (ws[i] || ''); });
  s.notes.push({ id: uid(), tid, phrase: sLine(phrase, 300), comment: '' });
  delete PICKS[tid]; commit(); softRender();
  setTimeout(() => { const ns = $$(`textarea[data-in="note"]`); const last = s.notes[s.notes.length - 1]; const ta = ns.find(x => x.dataset.n === last.id); if (ta) ta.focus(); }, 50);
}
function buildReport(s) {
  let md = `# Stress test session\n\n${fmtWhen(s.date)}\n\n`;
  s.thoughtIds.map(getT).filter(Boolean).forEach(t => {
    const p = t.pid && getP(t.pid);
    md += `## Thought (${TYPE_LONG[t.type]}${p ? ', about ' + p.name : ''})\n"${t.text}"\n\n`;
    const ns = s.notes.filter(n => n.tid === t.id);
    if (ns.length) { md += `**Stress-tested parts:**\n`; ns.forEach(n => { md += `- "${n.phrase}" — ${n.comment.trim() || '(no comment yet)'}\n`; }); md += `\n`; }
  });
  if (s.conclusion.trim()) md += `## Conclusion\n${s.conclusion.trim()}\n\n`;
  const ln = s.linked.map(getT).filter(Boolean);
  if (ln.length) { md += `## Linked new thoughts\n`; ln.forEach(t => { md += `- (${TYPE_LONG[t.type]}) ${t.text}\n`; }); }
  return md;
}
function reportSheet(s) {
  const md = buildReport(s);
  const canShare = !!(navigator.share);
  openSheet(() => `${sheetHead('Report for Claude')}
    <p class="sm" style="margin:0 0 8px">Copy it and paste it to Claude for another perspective, or save it as a file.</p>
    <textarea class="in report" id="repBox" readonly>${esc(md)}</textarea>
    <div class="btns"><button class="btn" data-act="repCopy">Copy</button><button class="btn g" data-act="repDl">Download .md</button></div>
    ${canShare ? '<button class="btn g w" style="margin-top:10px" data-act="repShare">Share</button>' : ''}`);
}

/* =====================================================================
   MAP — drag people between the rings and the four outer corners
   ===================================================================== */
let PULSE = '';
function dotHTML(p, inTray) {
  const z = zoneOf(p.place);
  const pos = inTray ? '' : `left:${p.place.x}%;top:${p.place.y}%;`;
  const up = !inTray && p.place.y > 86 ? ' up' : '';
  return `<div class="mdot${PULSE === p.id ? ' pulse' : ''}${up}" data-id="${esc(p.id)}" role="button" tabindex="0" aria-label="${esc(p.name)}, ${esc(zoneName(z))}" style="${pos}background:${ZONE_COL[z]}"><span class="nmz">${esc(p.name)}</span></div>`;
}
function mapView() {
  const placed = S.people.filter(p => p.place), tray = S.people.filter(p => !p.place);
  const Z = S.labels.zones;
  const zl = (k, x, y, c) => `<span class="zl${c ? ' c' : ''}" style="left:${x}%;top:${y}%">${esc(Z[k])}</span>`;
  let h = `<div class="card"><div class="between"><span class="lbl">Your map</span><button class="link" data-act="addPerson">+ Add</button></div>`;
  if (!S.people.length) h += `<p class="sm" style="margin:6px 0 0">Each dot is a person, or a thing, in your life. Add someone, then drag them into a ring to keep them close, or out to a corner if they stay outside your circle.</p>`;
  if (tray.length) h += `<div class="sm" style="margin-top:8px">Not on the map yet · drag onto the circle, or tap to open</div><div class="tray" id="tray">${tray.map(p => dotHTML(p, true)).join('')}</div>`;
  h += `<div class="mcor top"><span style="color:${ZONE_COL.q_tl}">${esc(Z.q_tl)}</span><span style="color:${ZONE_COL.q_tr};text-align:right">${esc(Z.q_tr)}</span></div>
  <div class="mapbox" id="mapbox">
    <div class="mq" style="left:0;top:0;background:${ZONE_COL.q_tl}"></div><div class="mq" style="right:0;top:0;background:${ZONE_COL.q_tr}"></div>
    <div class="mq" style="left:0;bottom:0;background:${ZONE_COL.q_bl}"></div><div class="mq" style="right:0;bottom:0;background:${ZONE_COL.q_br}"></div>
    <div class="ring" style="inset:10%"></div><div class="ring" style="inset:23.2%"></div><div class="ring" style="inset:36.4%;background:rgba(255,255,255,.9)"></div>
    ${zl('ring3', 50, 13.5, 1)}${zl('ring2', 50, 26.8, 1)}${zl('ring1', 50, 40, 1)}
    ${placed.map(p => dotHTML(p, false)).join('')}
  </div>
  <div class="mcor"><span style="color:${ZONE_COL.q_bl}">${esc(Z.q_bl)}</span><span style="color:${ZONE_COL.q_br};text-align:right">${esc(Z.q_br)}</span></div>`;
  h += `<p class="sm" style="text-align:center;margin:8px 0 2px">Drag a dot to move someone · tap to open their page</p></div>`;
  const counts = {}; for (const p of S.people) { const z = zoneOf(p.place); counts[z] = (counts[z] || 0) + 1; }
  h += `<div class="card legend"><div class="lbl">Zones</div>
    ${['ring1', 'ring2', 'ring3'].map(k => `<div class="li"><i style="background:${ZONE_COL[k]}"></i><span class="grow">${esc(Z[k])}</span><span class="sm">${counts[k] || 0}</span></div>`).join('')}
    <div class="lbl" style="margin-top:12px">Outside your circle</div>
    ${['q_br', 'q_bl', 'q_tl', 'q_tr'].map(k => `<div class="li"><i style="background:${ZONE_COL[k]}"></i><span class="grow">${esc(Z[k])}</span><span class="sm">${counts[k] || 0}</span></div>`).join('')}
    <p class="sm" style="margin:8px 0 2px">Rename the zones in Settings.</p></div>`;
  if (S.people.length && !tray.length && placed.length) h += `<p class="sm" style="text-align:center;font-family:var(--serif);font-style:italic;font-size:15px;margin:4px 0 10px">Your boundaries are a little clearer now.</p>`;
  return h;
}
function bindMap() {
  const box = $('#mapbox'); if (!box) return;
  if (PULSE) setTimeout(() => { PULSE = ''; const d = $('.mdot.pulse'); if (d) d.classList.remove('pulse'); }, 2200);
  $$('.mdot').forEach(el => attachDrag(el, box));
}
function attachDrag(el, box) {
  let down = false, drag = false, sx = 0, sy = 0, fromTray = false, pos = null, pid = el.dataset.id;
  el.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    e.preventDefault();
    down = true; drag = false; sx = e.clientX; sy = e.clientY;
    fromTray = !!el.closest('#tray');
    pos = null;
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  el.addEventListener('pointermove', e => {
    if (!down) return;
    if (!drag && Math.hypot(e.clientX - sx, e.clientY - sy) > 6) {
      drag = true; el.classList.add('drag');
      if (fromTray) {
        /* lift the dot out of the tray and onto the map at the finger's position */
        try { el.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        box.appendChild(el); el.style.margin = '';
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }
    }
    if (!drag) return;
    const r = box.getBoundingClientRect();
    const x = clamp((e.clientX - r.left) / r.width * 100, -8, 108), y = clamp((e.clientY - r.top) / r.height * 100, -30, 108);
    pos = { x, y };
    el.style.left = x + '%'; el.style.top = y + '%';
    el.style.background = ZONE_COL[zoneOf({ x: clamp(x, 0, 100), y: clamp(y, 0, 100) })];
  });
  const end = e => {
    if (!down) return; down = false;
    try { el.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const p = getP(pid); if (!p) return softRender();
    if (!drag) { openView('person', pid); return; }
    el.classList.remove('drag');
    const tray = $('#tray');
    const tr = tray && tray.getBoundingClientRect();
    if (e.type !== 'pointercancel' && tr && e.clientX >= tr.left - 8 && e.clientX <= tr.right + 8 && e.clientY >= tr.top - 8 && e.clientY <= tr.bottom + 8) p.place = null;
    else if (e.type === 'pointercancel' || !pos) { /* keep where it was */ }
    else if (pos.y < -4 && !p.place) { /* dropped above the map while coming from the tray: leave it there */ }
    else p.place = { x: Math.round(clamp(pos.x, 0, 100) * 10) / 10, y: Math.round(clamp(pos.y, 0, 100) * 10) / 10 };
    commit(); softRender();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openView('person', pid); } });
}

/* =====================================================================
   PEOPLE — grouped by where they sit on the map
   ===================================================================== */
let PQ = '', PF = -1;
const ZORDER = ['ring1', 'ring2', 'ring3', 'q_tr', 'q_tl', 'q_bl', 'q_br', 'none'];
function recentLevels(pid, days = 90) { const cut = keyOf(Date.now() - days * 864e5); return actsOf(pid).filter(a => a.date >= cut); }
function peopleList() {
  const q = PQ.trim().toLowerCase();
  let ps = S.people.filter(p => !q || p.name.toLowerCase().includes(q) || p.rel.toLowerCase().includes(q) || p.traits.some(t => t.text.toLowerCase().includes(q)));
  if (PF >= 0) ps = ps.filter(p => recentLevels(p.id).some(a => a.level === PF));
  if (!ps.length) return `<div class="card"><div class="empty">${S.people.length ? 'No one matches.' : ''}</div></div>`;
  let h = '';
  for (const z of ZORDER) {
    const g = ps.filter(p => zoneOf(p.place) === z).sort((a, b) => a.name.localeCompare(b.name));
    if (!g.length) continue;
    h += `<div class="sec"><i style="background:${ZONE_COL[z]}"></i>${esc(zoneName(z))} · ${g.length}</div><div class="card flat">`;
    h += g.map(p => {
      const acts = actsOf(p.id).slice(0, 8).reverse();
      const sub = p.rel || p.traits.slice(0, 3).map(t => t.text).join(' · ');
      return `<button class="li" data-act="person" data-id="${esc(p.id)}"><span class="av" style="background:${ZONE_COL[z]}">${initial(p.name)}</span><span class="grow"><span class="nm" style="display:block">${esc(p.name)}</span>${sub ? `<span class="sm one" style="display:block">${esc(sub)}</span>` : ''}</span><span class="dots">${acts.map(a => `<i style="background:${LEVEL_COL[a.level]}" title="${esc(levelName(a.level))}"></i>`).join('')}</span></button>`;
    }).join('');
    h += `</div>`;
  }
  return h;
}
function peopleView() {
  if (!S.people.length) return `<div class="card"><div class="empty"><b>Add the people in your life</b>Each person gets a place on your map, traits that describe who they are, and a log of what they did, kept apart.</div><button class="btn w" data-act="addPerson">Add a person</button></div>`;
  return `<div class="card"><div class="row0"><input class="in" id="pq" type="search" data-in="pq" placeholder="Search names, traits…" value="${esc(PQ)}" autocomplete="off"><button class="btn sm2" data-act="addPerson" aria-label="Add a person" style="flex:none">+ Add</button></div>
    <div class="sm" style="margin:10px 0 6px">Did something in the last 90 days:</div>
    <div class="chips" id="pfChips"><button class="chip${PF < 0 ? ' on' : ''}" data-act="pf" data-v="-1">Anyone</button>${LEVELS.map(i => `<button class="chip${PF === i ? ' on' : ''}" data-act="pf" data-v="${i}">${levelDot(i)} ${esc(levelName(i))}</button>`).join('')}</div></div>
    <div id="plist">${peopleList()}</div>`;
}

/* ---------- person page ---------- */
function personView(p) {
  const z = zoneOf(p.place), acts = actsOf(p.id), recent = recentLevels(p.id);
  const cnt = LEVELS.map(i => recent.filter(a => a.level === i).length);
  let h = `<div class="card"><div class="row0"><span class="av big" style="background:${ZONE_COL[z]}">${initial(p.name)}</span><div class="grow"><div class="h2" style="overflow-wrap:anywhere">${esc(p.name)}</div>${p.rel ? `<div class="sm">${esc(p.rel)}</div>` : ''}<div class="sm" style="margin-top:2px"><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${ZONE_COL[z]};margin-right:5px"></i>${esc(zoneName(z))}</div></div></div>
    <div class="btns"><button class="btn g sm2" data-act="editPerson" data-id="${esc(p.id)}">Edit</button><button class="btn g sm2" data-act="showOnMap" data-id="${esc(p.id)}">${p.place ? 'Show on map' : 'Place on map'}</button></div>
    ${p.note ? `<p style="white-space:pre-wrap;margin:12px 0 0;font-size:14.5px;overflow-wrap:anywhere">${esc(p.note)}</p>` : ''}
    <div class="lbl" style="margin-top:14px">Who they are</div>
    <div class="chips" style="margin-top:8px">${p.traits.map(t => `<button class="chip" data-act="trait" data-id="${esc(t.id)}">${esc(t.text)}</button>`).join('')}<button class="chip add" data-act="traits">${p.traits.length ? '+ trait' : '+ Add a trait'}</button></div>
    <p class="sm" style="margin:6px 0 0">Traits describe the person and are never scored.</p></div>`;
  h += `<div class="card"><div class="between"><span class="lbl">What they did</span><button class="btn sm2" data-act="logAction" data-id="${esc(p.id)}">+ Log an action</button></div>`;
  if (recent.length) {
    h += `<div class="sm" style="margin-top:10px">Last 90 days</div><div class="mix" style="margin-top:6px">${LEVELS.map(i => cnt[i] ? `<span style="flex:${cnt[i]};background:${LEVEL_COL[i]}"></span>` : '').join('')}</div>
      <div class="mixl">${[3, 4, 2, 1, 0].filter(i => cnt[i]).map(i => `<span><b style="background:${LEVEL_COL[i]}"></b>${cnt[i]} ${esc(levelName(i).toLowerCase())}</span>`).join('')}<span>· last 90 days</span></div>`;
  }
  if (acts.length) {
    let last = '';
    acts.forEach(a => {
      const ym = a.date.slice(0, 7);
      if (ym !== last) { last = ym; const d = new Date(ym + '-01T00:00:00'); h += `<div class="month">${isNaN(d) ? '' : d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</div>`; }
      h += `<button class="act" data-act="action" data-id="${esc(a.id)}"><span class="ld" style="background:${LEVEL_COL[a.level]}"></span><span class="grow"><span style="display:block;font-weight:600;overflow-wrap:anywhere">${esc(a.title)}</span>${a.detail ? `<span class="sm" style="display:block;overflow-wrap:anywhere">${esc(trunc(a.detail, 140))}</span>` : ''}<span class="sm" style="display:block">${esc(levelName(a.level))} · ${esc(fmtDateKey(a.date))}</span></span></button>`;
    });
  } else h += `<p class="sm" style="margin:10px 0 2px">Nothing logged yet. Each action gets its own level, wherever they sit on your map.</p>`;
  h += `</div>`;
  const R = [['feel', 'How I feel about them', 'Not a verdict, just what’s true for you right now'], ['appreciate', 'What I appreciate', 'Small things count'], ['wish', 'What I wish were different', 'About the situation, or about me']];
  h += `<div class="card"><div class="lbl">Reflections</div><p class="sm" style="margin:4px 0 0">Words, not numbers. Saved as you type.</p>
    ${R.map(([k, l, ph]) => `<div class="fld"><label for="rf-${k}">${l}<span class="saved" id="sv-${k}">Saved</span></label><textarea class="in" id="rf-${k}" rows="3" maxlength="4000" data-in="refl" data-k="${k}" placeholder="${ph}">${esc(p.refl[k])}</textarea></div>`).join('')}</div>`;
  const th = S.thoughts.filter(t => t.pid === p.id).sort((a, b) => b.date - a.date);
  h += `<div class="card"><div class="between"><span class="lbl">Thoughts about ${esc(trunc(p.name, 18))}</span><button class="link" data-act="thoughtAbout" data-id="${esc(p.id)}">+ Write one</button></div>
    ${th.length ? th.slice(0, 30).map(t => `<button class="tl" data-act="thought" data-id="${esc(t.id)}"><div class="between"><span>${typeTag(t.type)}</span><span class="sm">${esc(fmtWhen(t.date))}</span></div><div class="tx">${esc(trunc(t.text, 200))}</div></button>`).join('') : '<p class="sm" style="margin:8px 0 2px">None yet.</p>'}</div>`;
  return h;
}
function curPerson() { const v = topView(); return v && v.type === 'person' ? getP(v.id) : null; }

/* add or edit a person */
function personSheet(p) {
  const isNew = !p;
  openSheet(() => `${sheetHead(isNew ? 'Add a person' : 'Edit person')}
    <div class="fld" style="margin-top:4px"><label for="pN">Name</label><input class="in" id="pN" maxlength="60" autocomplete="off" value="${esc(p ? p.name : '')}" placeholder="Mai, Mom, my boss, a project…"></div>
    <div class="err" id="pErr"></div>
    <div class="fld"><label for="pR">Who they are to you (optional)</label><input class="in" id="pR" maxlength="60" value="${esc(p ? p.rel : '')}" placeholder="Friend, sister, coworker…"></div>
    <div class="fld"><label for="pNote">Note (optional)</label><textarea class="in" id="pNote" rows="3" maxlength="4000" placeholder="Why are they where they are on your map?">${esc(p ? p.note : '')}</textarea></div>
    ${p && p.place ? `<label class="toggle"><input type="checkbox" id="pOff"> Take them off the map</label>` : ''}
    <button class="btn w" style="margin-top:12px" data-act="pSave" data-id="${esc(p ? p.id : '')}">${isNew ? 'Add person' : 'Save changes'}</button>
    ${isNew ? '' : `<button class="btn d w" style="margin-top:12px" data-act="pDel" data-id="${esc(p.id)}">Delete ${esc(trunc(p.name, 20))}</button><p class="sm" style="margin:6px 0 0">Deleting also removes their logged actions. Thoughts about them stay in your library.</p>`}`,
    { focus: isNew ? '#pN' : null });
}
function savePerson(id) {
  const name = sLine($('#pN').value, 60);
  if (!name) { $('#pErr').textContent = 'Add a name to continue.'; $('#pN').focus(); return; }
  const rel = sLine($('#pR').value, 60), note = sStr($('#pNote').value, 4000).trim();
  if (!id) {
    const p = { id: uid(), name, rel, note, place: null, traits: [], refl: { feel: '', appreciate: '', wish: '' }, created: Date.now(), u: 0 };
    S.people.push(p); commit();
    const fromMap = !topView() && TAB === 'map';
    if (fromMap) { closeSheet(); softRender(); toast('Added. Drag ' + name + ' onto the circle.'); }
    else openView('person', p.id);
    return;
  }
  const p = getP(id); if (!p) return closeSheet();
  p.name = name; p.rel = rel; p.note = note;
  const off = $('#pOff'); if (off && off.checked) p.place = null;
  commit(); closeSheet(); softRender(); toast('Saved');
}
function deletePerson(id) {
  const p = getP(id); if (!p) return;
  S.people = S.people.filter(x => x.id !== id);
  S.actions = S.actions.filter(a => a.pid !== id);
  S.thoughts.forEach(t => { if (t.pid === id) t.pid = ''; });
  commit();
  popAllUI(); toast('Deleted ' + p.name);
}

/* traits */
function traitsSheet(p) {
  const has = t => p.traits.some(x => x.text.toLowerCase() === t.toLowerCase());
  const pb = t => `<button class="chip${has(t) ? ' on' : ''}" data-act="preset" data-v="${esc(t)}" aria-pressed="${has(t)}">${esc(t)}</button>`;
  openSheet(() => `${sheetHead('Who they are', 'Done')}
    <p class="sm" style="margin:0 0 6px">Tap to add or remove. Traits describe the person and are never scored.</p>
    <div class="fl" style="margin-top:12px">Bright sides</div><div class="chips">${BRIGHT.map(pb).join('')}</div>
    <div class="fl" style="margin-top:14px">Tender sides</div><div class="chips">${TENDER.map(pb).join('')}</div>
    <div class="fl" style="margin-top:14px">In your own words</div>
    <div class="row0"><input class="in" id="tIn" maxlength="48" placeholder="Sometimes insecure"><button class="btn" data-act="tAdd" style="flex:none">Add</button></div>`, { live: true });
}
function traitSheet(p, t) {
  openSheet(() => `${sheetHead('Edit trait')}
    <input class="in" id="etIn" maxlength="48" value="${esc(t.text)}">
    <p class="sm" style="margin:6px 0 0">Add nuance if it helps, like “sometimes” or “about money”.</p>
    <div class="btns"><button class="btn d" data-act="etDel" data-id="${esc(t.id)}">Remove</button><button class="btn" data-act="etSave" data-id="${esc(t.id)}">Save</button></div>`);
}

/* actions */
let ALV = -1;
function actionSheet(p, a) {
  const isNew = !a;
  ALV = a ? a.level : -1;
  openSheet(() => `${sheetHead(isNew ? 'Log an action' : 'Action')}
    <p class="sm" style="margin:0 0 4px">${esc(p.name)}</p>
    <div class="fld"><label for="aT">What did they do?</label><input class="in" id="aT" maxlength="120" value="${esc(a ? a.title : '')}" placeholder="Covered my shift without being asked"></div>
    <div class="fld"><span class="fl">How did it land?</span><div class="lvb" id="lvb">${LEVELS.map(i => `<button type="button" data-act="alv" data-v="${i}" aria-pressed="${ALV === i}" style="${ALV === i ? `background:${LEVEL_COL[i]};border-color:${LEVEL_COL[i]};color:#fff` : `color:${LEVEL_INK[i]};background:${LEVEL_BG[i]}`}">${esc(levelName(i))}</button>`).join('')}</div></div>
    <div class="fld"><label for="aD">What happened (optional)</label><textarea class="in" id="aD" rows="3" maxlength="4000" placeholder="Context, what you saw, how it unfolded">${esc(a ? a.detail : '')}</textarea></div>
    <div class="fld"><label for="aDate">When</label><input class="in" id="aDate" type="date" value="${esc(a ? a.date : todayKey())}" max="${todayKey()}"></div>
    <div class="err" id="aErr"></div>
    <button class="btn w" style="margin-top:12px" data-act="aSave" data-p="${esc(p.id)}" data-id="${esc(a ? a.id : '')}">${isNew ? 'Log action' : 'Save changes'}</button>
    ${isNew ? '' : `<button class="btn d w" style="margin-top:12px" data-act="aDel" data-id="${esc(a.id)}">Delete action</button>`}`,
    { focus: isNew ? '#aT' : null });
}
function paintLevels() {
  $$('#lvb button').forEach(b => { const i = +b.dataset.v, on = i === ALV; b.setAttribute('aria-pressed', on); b.style.background = on ? LEVEL_COL[i] : LEVEL_BG[i]; b.style.borderColor = on ? LEVEL_COL[i] : ''; b.style.color = on ? '#fff' : LEVEL_INK[i]; });
}
function saveAction(pid, id) {
  const p = getP(pid); if (!p) return closeSheet();
  const title = sLine($('#aT').value, 120);
  if (!title) { $('#aErr').textContent = 'Give the action a short name.'; $('#aT').focus(); return; }
  if (ALV < 0) { $('#aErr').textContent = 'Pick how it landed: one of the five levels.'; return; }
  const vals = { title, level: ALV, detail: sStr($('#aD').value, 4000).trim(), date: sDate($('#aDate').value) || todayKey() };
  if (id) { const a = S.actions.find(x => x.id === id); if (a) Object.assign(a, vals); }
  else S.actions.push({ id: uid(), pid, created: Date.now(), u: 0, ...vals });
  commit(); closeSheet(); softRender(); toast(id ? 'Saved' : 'Action logged');
}
function choosePersonSheet() {
  const ps = [...S.people].sort((a, b) => a.name.localeCompare(b.name));
  openSheet(() => `${sheetHead('Log an action')}<p class="sm" style="margin:0 0 6px">Who was it?</p>
    ${ps.length ? ps.map(p => `<button class="li" data-act="logFor" data-id="${esc(p.id)}"><span class="av" style="background:${ZONE_COL[zoneOf(p.place)]}">${initial(p.name)}</span><span class="grow nm">${esc(p.name)}</span></button>`).join('') : '<div class="empty">Add a person first.</div>'}
    <button class="btn g w" style="margin-top:10px" data-act="addPerson">+ Add a person</button>`);
}

/* =====================================================================
   SETTINGS
   ===================================================================== */
function settingsView() {
  const total = S.people.length + S.actions.length + S.thoughts.length + S.sessions.length;
  const since = S.meta.lastExport ? 'Last backup ' + ago(S.meta.lastExport) + '.' : 'You haven’t exported a backup yet.';
  const canShare = !!(navigator.canShare && (() => { try { return navigator.canShare({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] }); } catch (e) { return false; } })());
  let h = `<div class="card" id="syncBox">${syncInner()}</div><div class="card" id="remindBox">${remindInner()}</div>`;
  h += `<div class="card"><div class="lbl">Backup</div>
    <p class="sm" style="margin:6px 0 0">${since}${S.meta.changes ? ` <b style="color:var(--ink)">${plural(S.meta.changes, 'change')} since then.</b>` : ''}</p>
    <div class="btns"><button class="btn" data-act="exportNow">Export</button>${canShare ? '<button class="btn g" data-act="shareBackup">Share</button>' : ''}<button class="btn g" data-act="importFile">Import</button></div>
    <button class="link" style="margin-top:12px;font-size:14px" data-act="backupText">Show the backup as text</button>
    <p class="sm" style="margin:10px 0 0">Bringing over your old Kokoro, boundary map or Stress Test data? Open <b>export-old-data.html</b> on this phone, save its file, then tap Import here.</p></div>`;
  const prev = k => `<button data-act="setTheme" data-v="${k}" class="${!D.random && D.theme === k ? 'on' : ''}"><img alt="" src="${sceneURL(k, 'day', true)}"><b>${THEMES[k].name}</b></button>`;
  h += `<div class="card"><div class="lbl">Theme</div><p class="sm" style="margin:6px 0 10px">Now showing ${THEMES[THEME].name}. ${D.random ? 'A new one is picked each time you open Kokoro.' : 'Locked.'}</p>
    <div class="worlds">${Object.keys(THEMES).map(prev).join('')}</div>
    <label class="toggle" style="margin-top:8px"><input type="checkbox" data-in="random" ${D.random ? 'checked' : ''}> Pick a random theme each time I open Kokoro</label></div>`;
  h += `<div class="card"><div class="lbl">Names</div><p class="sm" style="margin:6px 0 0">Rename the map zones and the action levels. Saved as you type.</p>
    <div class="fl" style="margin-top:12px">Map zones</div>
    ${ZONES.map(k => `<div class="row0" style="margin-top:8px"><i style="width:12px;height:12px;border-radius:50%;background:${ZONE_COL[k]};flex:none"></i><input class="in" data-in="zname" data-k="${k}" maxlength="60" value="${esc(S.labels.zones[k])}" aria-label="Name for zone ${k}"></div>`).join('')}
    <div class="fl" style="margin-top:14px">Action levels</div>
    ${LEVELS.map(i => `<div class="row0" style="margin-top:8px">${levelDot(i, 12)}<input class="in" data-in="lname" data-i="${i}" maxlength="30" value="${esc(S.labels.levels[i])}" aria-label="Name for level ${i + 1}"></div>`).join('')}
    <button class="link" style="margin-top:12px;font-size:14px" data-act="resetNames">Reset to the default names</button></div>`;
  h += `<div class="card"><div class="lbl">Display</div>
    <label class="toggle"><input type="checkbox" data-in="lite" ${D.lite ? 'checked' : ''}> Lite mode (no animation)</label>
    ${D.autoLite && D.lite ? '<p class="sm" style="margin:0">Turned on by itself after Kokoro closed unexpectedly.</p>' : ''}</div>`;
  h += `<div class="card"><div class="lbl">Diagnostics</div>
    <div class="diag" style="margin-top:8px">${DIAG.length ? esc(DIAG.slice(-12).join('\n')) : 'No problems logged.'}</div>
    <div class="btns"><button class="btn g sm2" data-act="copyDiag">Copy report</button><button class="btn g sm2" data-act="clearDiag">Clear</button></div></div>`;
  h += `<div class="card"><div class="lbl">Erase</div><p class="sm" style="margin:6px 0 0">${SC.on ? 'Erases everything here and on every device that syncs with this one.' : 'Erases everything on this phone. Export a backup first.'}</p>
    <button class="btn d w" style="margin-top:10px" data-act="eraseAll">Erase all data</button></div>`;
  h += `<p class="sm" style="text-align:center;margin:6px 0 14px">Kokoro ${APP_VER} · ${plural(S.people.length, 'person', 'people')} · ${plural(S.actions.length, 'action')} · ${plural(S.thoughts.length, 'thought')} · ${plural(S.sessions.length, 'session')} · ${total ? 'saved on this phone' : 'nothing saved yet'}</p>`;
  return h;
}
function markExported() { S.meta.lastExport = Date.now(); S.meta.changes = 0; persist(); }
function exportNow() {
  if (download(backupName(), backupJSON(S), 'application/json')) { markExported(); toast('Backup saved to your downloads'); softRender(); }
  else backupTextSheet();
}
async function shareBackup() {
  try { const f = new File([backupJSON(S)], backupName(), { type: 'application/json' }); await navigator.share({ files: [f], title: 'Kokoro backup' }); markExported(); softRender(); }
  catch (e) { if (e && e.name !== 'AbortError') { logDiag('share: ' + e.message); backupTextSheet(); } }
}
function backupTextSheet() {
  openSheet(() => `${sheetHead('Backup as text')}<p class="sm" style="margin:0 0 8px">Copy all of this and keep it somewhere safe, like a note. To restore it, save it as a .json file and use Import.</p>
    <textarea class="in report" readonly id="bkText">${esc(backupJSON(S))}</textarea><button class="btn w" style="margin-top:10px" data-act="bkCopy">Copy</button>`);
}
let IMPORT = null;
function onImportText(text) {
  try { IMPORT = parseImport(text); }
  catch (e) { IMPORT = null; openSheet(() => `${sheetHead('Can’t import')}<p>${esc((e && e.msg) || 'That file couldn’t be read.')}</p><button class="btn w" data-act="closeSheet">OK</button>`); return; }
  const m = IMPORT.summary;
  openSheet(() => `${sheetHead(m.kind === 'old' ? 'Import your old data' : 'Import backup')}
    <p>This file has ${plural(m.people, 'person', 'people')}, ${plural(m.actions, 'action')}, ${plural(m.thoughts, 'thought')} and ${plural(m.sessions, 'session')}.</p>
    ${m.notes.length ? `<ul class="sm" style="margin:0 0 8px;padding-left:18px">${m.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    <p class="sm"><b>Merge</b> keeps everything you have, adds what’s new and updates anything changed more recently in the file. <b>Replace</b> swaps all your current data for this file${SC.on ? ', on every synced device' : ''}.</p>
    <div class="btns"><button class="btn d" data-act="impReplace">Replace</button><button class="btn" data-act="impMerge">Merge</button></div>`);
}
function applyImport(mode) {
  if (!IMPORT) return closeSheet();
  const I = IMPORT.st; IMPORT = null;
  if (mode === 'replace') {
    const old = idsOf(S);
    S.people = I.people; S.actions = I.actions; S.thoughts = I.thoughts; S.sessions = I.sessions; S.del = {};
    S.labels = I.labels ? sLabels(I.labels) : sLabels({});
    if (I.zones) Object.assign(S.labels.zones, I.zones);
    fixAfterMerge(); touchAll(old); S.meta.changes += 1;
    markDirty(); persist(); schedSync();
    closeSheet(); goTab(TAB); toast('Data replaced');
    return;
  }
  for (const col of SYNC_COLS) {
    const L = new Map(S[col].map(x => [x.id, x]));
    for (const x of I[col]) {
      const cur = L.get(x.id), delAt = S.del[x.id] || 0;
      if (!cur) { if (!delAt || (x.u || 0) > delAt) { S[col].push(x); L.set(x.id, x); } }
      else if ((x.u || 0) > (cur.u || 0)) Object.assign(cur, x);
    }
  }
  if (I.labels && (I.labels.u || 0) > (S.labels.u || 0)) S.labels = sLabels(I.labels);
  if (I.zones) Object.assign(S.labels.zones, I.zones);
  fixAfterMerge(); commit();
  closeSheet(); softRender(); toast('Merged');
}
function eraseAll() {
  S.people = []; S.actions = []; S.thoughts = []; S.sessions = []; S.labels = sLabels({}); S.meta.changes = 0;
  DRAFT = { text: '', type: '', pid: '' }; saveDraft(); JUST_SAVED = '';
  commit(); goTab('becoming'); toast('Everything was erased');
}

/* =====================================================================
   FAB: quick add
   ===================================================================== */
function fabSheet() {
  openSheet(() => `${sheetHead('Add')}
    <div class="big3">
      <button data-act="fabThought"><span class="ic" style="background:${TYPE_COL.spiral}">✎</span><span><b>Write a thought</b><span class="sm" style="display:block">Spiral, hope or fact</span></span></button>
      <button data-act="fabAction"><span class="ic" style="background:${LEVEL_COL[3]}">●</span><span><b>Log an action</b><span class="sm" style="display:block">What someone did, and how it landed</span></span></button>
      <button data-act="addPerson"><span class="ic" style="background:${ZONE_COL.ring2}">+</span><span><b>Add a person</b><span class="sm" style="display:block">Then place them on your map</span></span></button>
    </div>`);
}

/* =====================================================================
   EVENTS (one delegated handler for taps, one for typing)
   ===================================================================== */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;
  try { ACTIONS[act] && ACTIONS[act](el, id, e); }
  catch (err) { logDiag('act ' + act + ': ' + (err && err.message)); toast('Something went wrong. Your data is safe.'); }
});
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset && e.target.dataset.act === 'word') { e.preventDefault(); e.target.click(); }
  if (e.key === 'Enter' && e.target.id === 'tIn') { e.preventDefault(); ACTIONS.tAdd(); }
});
const ACTIONS = {
  closeSheet: () => closeSheet(),
  back: () => { if (LAY.length) popLayerUI(); else goTab(TAB); },
  tab: el => goTab(el.dataset.v),
  fab: () => fabSheet(),
  fabThought: () => { goTab('becoming'); setTimeout(() => { const t = $('#newT'); if (t) t.focus(); }, 80); },
  fabAction: () => choosePersonSheet(),
  syncDot: () => goTab('settings'),
  /* becoming */
  draftType: el => { DRAFT.type = el.dataset.v; saveDraft(); setTypeButtons($('#draftTypes'), DRAFT.type); const e = $('#newErr'); if (e) e.textContent = ''; },
  saveThought: () => saveThought(),
  stressIt: (el, id) => stressIt(id),
  stressItS: (el, id) => { saveThoughtEdits(true); stressIt(id); },
  libF: el => { LIBF = el.dataset.v; LIBN = 40; softRender(); },
  libMore: () => { LIBN += 60; softRender(); },
  sesMore: () => { SESN += 20; softRender(); },
  thought: (el, id) => thoughtSheet(id),
  teType: el => { TEDIT.type = el.dataset.v; setTypeButtons($('#teTypes'), TEDIT.type); },
  teSave: () => { if (saveThoughtEdits()) { closeSheet(); softRender(); toast('Saved'); } },
  teDel: el => { if (!armed(el, 'Tap again to delete')) return; deleteThought(TEDIT.id); closeSheet(); softRender(); toast('Thought deleted'); },
  newSession: () => pickSheet('new'),
  addToSession: () => { const s = curSession(); if (s) pickSheet('add', s.id); },
  pickF: el => { $$('.seg button', el.parentNode.parentNode).forEach(b => b.classList.toggle('on', b === el)); $$('#pickList .pick').forEach(r => r.classList.toggle('hidden', el.dataset.v !== 'all' && r.dataset.type !== el.dataset.v)); },
  pickGo: () => pickGo(),
  openSession: (el, id) => { if (getS(id)) openView('session', id); },
  word: el => { const t = el.dataset.t, i = +el.dataset.i; const set = PICKS[t] || (PICKS[t] = new Set()); if (set.has(i)) set.delete(i); else set.add(i); el.classList.toggle('pk', set.has(i)); const x = $('#xerr-' + CSS.escape(t)); if (x) x.textContent = ''; },
  extract: el => extract(el.dataset.t),
  delNote: el => { if (!armed(el, 'Tap again')) return; const s = curSession(); if (!s) return; s.notes = s.notes.filter(n => n.id !== el.dataset.n); commit(); softRender(); },
  unlinkT: el => { if (!armed(el, 'Tap again to remove')) return; const s = curSession(); if (!s) return; const t = el.dataset.t; s.thoughtIds = s.thoughtIds.filter(x => x !== t); s.notes = s.notes.filter(n => n.tid !== t); delete PICKS[t]; commit(); softRender(); toast('Removed from this session. The thought stays in your library.'); },
  linkType: el => { LINKTYPE = el.dataset.v; setTypeButtons($('#linkTypes'), LINKTYPE); },
  linkNew: () => {
    const s = curSession(); if (!s) return;
    const text = sStr($('#linkT').value, 2000).trim(), err = $('#linkErr');
    if (!text) { err.textContent = 'Write the new thought first.'; return; }
    if (!LINKTYPE) { err.textContent = 'Pick what kind of thought this is.'; return; }
    const t = { id: uid(), text, type: LINKTYPE, pid: '', date: Date.now(), u: 0 };
    S.thoughts.push(t); s.linked.push(t.id); LINKTYPE = ''; commit(); softRender(); toast('Saved and linked');
  },
  toggleOpen: () => { const s = curSession(); if (!s) return; flushTyping(); const was = s.open; S.sessions.forEach(x => { x.open = false; }); s.open = !was; commit(); softRender(); toast(s.open ? 'Session reopened' : 'Session closed'); },
  delSession: el => { if (!armed(el, 'Tap again to delete the session')) return; const s = curSession(); if (!s) return; S.sessions = S.sessions.filter(x => x.id !== s.id); commit(); popLayerUI(); toast('Session deleted. Its thoughts stay in your library.'); },
  report: () => { flushTyping(); const s = curSession(); if (s) reportSheet(s); },
  repCopy: () => copyText($('#repBox').value).then(ok => toast(ok ? 'Copied. Paste it to Claude.' : 'Couldn’t copy. Select the text and copy it.')),
  repDl: () => { download('stress-test-' + stamp(Date.now()) + '.md', $('#repBox').value, 'text/markdown') ? toast('Saved to your downloads') : toast('Couldn’t save. Use Copy instead.'); },
  repShare: () => { navigator.share({ title: 'Stress test session', text: $('#repBox').value }).catch(() => {}); },
  /* map and people */
  addPerson: () => personSheet(null),
  person: (el, id) => openView('person', id),
  pf: el => { PF = +el.dataset.v; $$('#pfChips .chip').forEach(c => c.classList.toggle('on', +c.dataset.v === PF)); $('#plist').innerHTML = peopleList(); },
  editPerson: (el, id) => { const p = getP(id); if (p) personSheet(p); },
  pSave: (el, id) => savePerson(id),
  pDel: (el, id) => { if (!armed(el, 'Tap again to delete')) return; deletePerson(id); },
  showOnMap: (el, id) => { PULSE = id; goTab('map'); const d = $(`.mdot[data-id="${CSS.escape(id)}"]`); if (d) d.scrollIntoView({ block: 'center' }); if (!getP(id).place) toast('Drag them from “Not on the map yet” onto the circle.'); },
  traits: () => { const p = curPerson(); if (p) traitsSheet(p); },
  trait: (el, id) => { const p = curPerson(); const t = p && p.traits.find(x => x.id === id); if (t) traitSheet(p, t); },
  preset: el => {
    const p = curPerson(); if (!p) return; const v = el.dataset.v, low = v.toLowerCase();
    if (p.traits.some(x => x.text.toLowerCase() === low)) p.traits = p.traits.filter(x => x.text.toLowerCase() !== low);
    else if (p.traits.length < LIM.traits) p.traits.push({ id: uid(), text: v });
    const on = p.traits.some(x => x.text.toLowerCase() === low); el.classList.toggle('on', on); el.setAttribute('aria-pressed', on);
    commit(); render();
  },
  tAdd: () => {
    const p = curPerson(), inp = $('#tIn'); if (!p || !inp) return; const v = sLine(inp.value, 48); if (!v) return;
    if (!p.traits.some(x => x.text.toLowerCase() === v.toLowerCase()) && p.traits.length < LIM.traits) { p.traits.push({ id: uid(), text: v }); commit(); render(); toast('Added “' + v + '”'); }
    inp.value = ''; inp.focus();
  },
  etSave: (el, id) => { const p = curPerson(), t = p && p.traits.find(x => x.id === id); const v = sLine($('#etIn').value, 48); if (t && v) { t.text = v; commit(); } closeSheet(); softRender(); },
  etDel: (el, id) => { const p = curPerson(); if (p) { p.traits = p.traits.filter(x => x.id !== id); commit(); } closeSheet(); softRender(); },
  logAction: (el, id) => { const p = getP(id); if (p) actionSheet(p, null); },
  logFor: (el, id) => { const p = getP(id); if (p) actionSheet(p, null); },
  action: (el, id) => { const a = S.actions.find(x => x.id === id), p = a && getP(a.pid); if (p) actionSheet(p, a); },
  alv: el => { ALV = +el.dataset.v; paintLevels(); const e = $('#aErr'); if (e) e.textContent = ''; },
  aSave: el => saveAction(el.dataset.p, el.dataset.id),
  aDel: (el, id) => { if (!armed(el, 'Tap again to delete')) return; S.actions = S.actions.filter(x => x.id !== id); commit(); closeSheet(); softRender(); toast('Action deleted'); },
  thoughtAbout: (el, id) => { DRAFT.pid = id; saveDraft(); goTab('becoming'); setTimeout(() => { const t = $('#newT'); if (t) t.focus(); }, 80); },
  /* settings */
  exportNow: () => exportNow(),
  shareBackup: () => shareBackup(),
  backupText: () => backupTextSheet(),
  bkCopy: () => copyText($('#bkText').value).then(ok => { if (ok) { markExported(); toast('Copied'); } else toast('Couldn’t copy. Select the text and copy it.'); }),
  importFile: () => { const f = $('#file'); f.value = ''; f.click(); },
  impMerge: () => applyImport('merge'),
  impReplace: el => { if (!armed(el, 'Tap again to replace')) return; applyImport('replace'); },
  setTheme: el => { D.theme = el.dataset.v; D.random = false; saveDev(); applyTheme(D.theme); SCENE_KEY = ''; softRender(); },
  resetNames: () => { S.labels = { ...sLabels({}), u: S.labels.u }; commit(); softRender(); toast('Names reset'); },
  copyDiag: () => copyText(`Kokoro ${APP_VER}\n${navigator.userAgent}\nstorage ${STORAGE_OK ? 'ok' : 'blocked'} · lite ${D.lite} · sync ${SC.on ? SY.st : 'off'}\n` + DIAG.join('\n')).then(ok => toast(ok ? 'Report copied' : 'Couldn’t copy')),
  clearDiag: () => { DIAG = []; lsSet(LS_DIAG, '[]'); softRender(); },
  eraseAll: el => { if (!armed(el, SC.on ? 'Tap again: erase on every device' : 'Tap again to erase everything')) return; eraseAll(); },
  syncSrvShow: () => { const f = $('#srvFld'); if (f) f.classList.remove('hidden'); },
  syncConnect: async el => {
    const pin = ($('#spin').value || '').trim(), srvIn = $('#ssrv'), server = srvIn && !$('#srvFld').classList.contains('hidden') ? srvIn.value.trim().replace(/\/+$/, '') : '';
    const err = $('#syncErr');
    if (!/^\d{4,8}$/.test(pin)) { err.textContent = 'Enter your PIN: 4 to 8 digits.'; return; }
    if (server && !/^https?:\/\/[^\s"'<>]+$/.test(server)) { err.textContent = 'The address should start with https://'; return; }
    if (!server && !pageServer()) { err.textContent = 'Add the address of your sync site.'; $('#srvFld').classList.remove('hidden'); return; }
    el.disabled = true; el.textContent = 'Connecting…';
    try {
      const r = await connectSync(pin, server);
      if (r === 'ask') {
        openSheet(() => `${sheetHead('Your cloud already has data')}<p>This phone has data too. <b>Merge both</b> keeps everything from both places. <b>Use cloud copy</b> replaces this phone’s data with the cloud’s.</p>
          <div class="btns"><button class="btn g" data-act="connCloud">Use cloud copy</button><button class="btn" data-act="connMerge">Merge both</button></div>`);
        return;
      }
      setSync('ok'); toast(r === 'took' ? 'Connected. Your data came from the cloud.' : 'Connected'); syncNow(true); softRender();
    } catch (e2) { if (err.isConnected) err.textContent = syncErrText(e2); el.disabled = false; el.textContent = 'Connect'; }
  },
  connMerge: () => { finishConnect('merge'); closeSheet(); syncNow(true); softRender(); toast('Connected and merged'); },
  connCloud: el => { if (!armed(el, 'Tap again: use the cloud copy')) return; finishConnect('cloud'); closeSheet(); syncNow(true); softRender(); toast('Connected'); },
  syncNowBtn: () => syncNow(true),
  signIn: () => { flushTyping(); persist(); location.reload(); },
  syncPin: () => { const v = ($('#spin2').value || '').trim(); if (!/^\d{4,8}$/.test(v)) return toast('Enter 4 to 8 digits'); SC.pin = v; saveSC(); SY.st = 'busy'; syncNow(true); },
  remindTest: () => remindTest(),
  syncOff: el => { if (!armed(el, 'Tap again to disconnect')) return; if (PU.on) remindOff(true); disconnectSync(); softRender(); toast('Sync is off. Your data stays on this phone.'); }
};
function saveThoughtEdits(quiet) {
  const t = TEDIT && getT(TEDIT.id); if (!t) return false;
  const text = sStr($('#teText').value, 2000).trim();
  if (!text) { if (!quiet) $('#teErr').textContent = 'A thought can’t be empty.'; return false; }
  const pid = $('#teP').value;
  t.text = text; t.type = TEDIT.type; t.pid = getP(pid) ? pid : '';
  /* a note's phrase came from the old wording; it stays as written */
  commit(); return true;
}

document.addEventListener('input', e => {
  const el = e.target, k = el.dataset && el.dataset.in; if (!k) return;
  if (k === 'draftText') { DRAFT.text = el.value; typeSave('draft', saveDraft, 400); const er = $('#newErr'); if (er) er.textContent = ''; }
  else if (k === 'pq') { PQ = el.value; $('#plist').innerHTML = peopleList(); }
  else if (k === 'note') { const s = curSession(), n = s && s.notes.find(x => x.id === el.dataset.n); if (n) { n.comment = sStr(el.value, 4000); typeSave('note' + n.id, commit); } }
  else if (k === 'concl') { const s = curSession(); if (s) { s.conclusion = sStr(el.value, 4000); typeSave('concl' + s.id, commit); } }
  else if (k === 'refl') {
    const p = curPerson(); if (!p) return; const key = el.dataset.k;
    p.refl[key] = sStr(el.value, 4000);
    typeSave('refl' + p.id + key, () => { commit(); const s = $('#sv-' + key); if (s) { s.classList.add('on'); setTimeout(() => s.classList.remove('on'), 1200); } }, 600);
  }
  else if (k === 'zname') { S.labels.zones[el.dataset.k] = sLine(el.value, 60) || ZONE_DEF[el.dataset.k]; typeSave('labels', commit); }
  else if (k === 'lname') { S.labels.levels[+el.dataset.i] = sLine(el.value, 30) || LEVEL_DEF[+el.dataset.i]; typeSave('labels', commit); }
});
document.addEventListener('change', e => {
  const el = e.target, k = el.dataset && el.dataset.in;
  if (k === 'draftP') { DRAFT.pid = el.value; saveDraft(); }
  else if (k === 'random') { D.random = el.checked; if (!D.random) D.theme = THEME; saveDev(); softRender(); }
  else if (k === 'remindOn') { if (el.checked) remindOn(); else remindOff(); }
  else if (k === 'remindTime') remindTime(el.value);
  else if (k === 'lite') { D.lite = el.checked; if (!D.lite) D.autoLite = false; saveDev(); applyLite(); softRender(); }
  else if (el.id === 'file') {
    const f = el.files && el.files[0]; if (!f) return;
    if (f.size > 20e6) { toast('That file is too large to be a Kokoro backup.'); return; }
    const r = new FileReader();
    r.onload = () => onImportText(String(r.result || ''));
    r.onerror = () => toast('Couldn’t read that file.');
    r.readAsText(f);
  }
});

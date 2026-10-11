"""Daily reminder: Worker schedule rules (fake push service, fixed clock) and the Settings card in Chromium."""
import json, sys, time, urllib.request, urllib.error
from datetime import datetime
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright

B = 'http://localhost:8787'
FAILS, PASSES = [], []
def ok(name, cond, info=''):
    (PASSES if cond else FAILS).append(name + ('' if cond else ' :: ' + str(info)))
    if not cond: print('  ✗', name, info, flush=True)
def req(method, path, body=None, pin='2468', ip='remind-test'):
    h = {'X-Forwarded-For': ip, 'Content-Type': 'application/json'}
    if pin is not None: h['X-Pin'] = pin
    r = urllib.request.Request(B + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=h)
    try:
        with urllib.request.urlopen(r) as x: return x.status, json.loads(x.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')
def knob(**k): return json.loads(urllib.request.urlopen(urllib.request.Request(B + '/__knob', data=json.dumps(k).encode(), method='POST')).read() or b'null') if k.get('subs') else urllib.request.urlopen(urllib.request.Request(B + '/__knob', data=json.dumps(k).encode(), method='POST')).read()
def cron(dt): return json.loads(urllib.request.urlopen(B + '/__cron?now=%d' % int(dt.timestamp() * 1000)).read())
def pushes(): return json.loads(urllib.request.urlopen(B + '/__pushlog').read())
def subs(): return json.loads(urllib.request.urlopen(urllib.request.Request(B + '/__knob', data=b'{"subs":true}', method='POST')).read())
VN, PARIS = ZoneInfo('Asia/Ho_Chi_Minh'), ZoneInfo('Europe/Paris')
vn = lambda d, h, m: datetime(2026, 10, d, h, m, tzinfo=VN)
EP = lambda i: B + '/__push/' + i

# ---------------- Worker rules ----------------
knob(reset=True, clearPushes=True)
ok('key needs the PIN', req('GET', '/api/push/key', pin=None)[0] == 401)
s, k1 = req('GET', '/api/push/key'); s2, k2 = req('GET', '/api/push/key')
ok('one VAPID key, kept', s == 200 and len(k1['key']) == 87 and k1 == k2)
for bad, why in [({'endpoint': EP('x'), 'time': '25:00', 'tz': 'Asia/Ho_Chi_Minh'}, 'time'), ({'endpoint': EP('x'), 'time': '21:00', 'tz': 'Mars/Base'}, 'tz'),
                 ({'endpoint': 'javascript:alert(1)', 'time': '21:00', 'tz': 'UTC'}, 'endpoint'), ({'endpoint': 'http://evil.example/x', 'time': '21:00', 'tz': 'UTC'}, 'endpoint')]:
    ok('rejects bad ' + why, req('PUT', '/api/push/sub', bad)[0] == 400)

# subscribe "now" (real clock) at a time that has not come yet, then drive a fixed clock
now_vn = datetime.now(VN)
target = (now_vn.hour * 60 + now_vn.minute + 30) % 1440
if target < now_vn.hour * 60 + now_vn.minute: target = 23 * 60 + 59  # keep it later today
tt = '%02d:%02d' % divmod(target, 60)
s, r = req('PUT', '/api/push/sub', {'endpoint': EP('a'), 'time': tt, 'tz': 'Asia/Ho_Chi_Minh', 'slot': 'kokoro'})
ok('subscribe: later today', s == 200 and r['next'] == 'today', r)
s, r = req('PUT', '/api/push/sub', {'endpoint': EP('late'), 'time': '%02d:%02d' % divmod(max(0, now_vn.hour * 60 + now_vn.minute - 1), 60), 'tz': 'Asia/Ho_Chi_Minh'})
ok('subscribe after today\'s time: starts tomorrow', r['next'] == 'tomorrow', r)
# already done today, then moved to a later time today: still waits for tomorrow
later = '%02d:%02d' % divmod(min(1439, now_vn.hour * 60 + now_vn.minute + 30), 60)
s, r = req('PUT', '/api/push/sub', {'endpoint': EP('late'), 'time': later, 'tz': 'Asia/Ho_Chi_Minh'})
ok('done today, moved later: no second reminder today', r['next'] == 'tomorrow', r)
req('DELETE', '/api/push/sub', {'endpoint': EP('late')})
ok('delete removes', [x['endpoint'] for x in subs()] == [EP('a')])

# fixed-clock schedule tests with a fresh subscription set straight in the table
knob(reset=True, clearPushes=True)
req('GET', '/api/push/key')
def put(ep, t, tz='Asia/Ho_Chi_Minh'): return req('PUT', '/api/push/sub', {'endpoint': ep, 'time': t, 'tz': tz, 'slot': 'kokoro'})
put(EP('vn'), '21:00'); put(EP('paris'), '08:00', 'Europe/Paris')
# The real clock may already be past 21:00 in Vietnam, which marks today as done; make the schedule independent of it:
import sqlite3  # (the server's DB is in memory, so reset last_day through the API instead)
knob(subs=True)
# use 12 Oct onwards (in the future relative to the subscribe call), so last_day from today never blocks
r = cron(vn(12, 20, 55)); ok('20:55: nothing yet', r['sent'] == 0, r)
r = cron(vn(12, 21, 0)); ok('21:00: sent', r['sent'] == 1, r)
r = cron(vn(12, 21, 5)); ok('21:05: not again', r['sent'] == 0, r)
r = cron(vn(12, 23, 55)); ok('later that night: not again', r['sent'] == 0, r)
r = cron(vn(13, 21, 2)); ok('next day: sent again', r['sent'] == 1, r)
p = [x for x in pushes() if x['id'] == 'vn']
ok('push is signed (VAPID) and empty, with a TTL', len(p) == 2 and all(x['vapid'] and x['len'] == 0 and x['ttl'] == '14400' for x in p), p)
# Paris 08:00 = 13:00 or 14:00 Vietnam
paris8 = datetime(2026, 10, 14, 8, 1, tzinfo=PARIS)
r = cron(paris8.astimezone(VN)); ok('Paris time zone respected', r['sent'] == 1 and [x['id'] for x in pushes()][-1] == 'paris', r)
r = cron(datetime(2026, 10, 15, 7, 58, tzinfo=PARIS)); ok('Paris: not before 08:00', r['sent'] == 0, r)
# missed runs: still sent within 3 hours, not after
r = cron(vn(14, 23, 50)); ok('2 h 50 late: still sent', r['sent'] == 1, r)
r = cron(vn(16, 0, 5)); ok('3 h+ late (after midnight it is a new day, before 21:00): nothing', r['sent'] == 0, r)
# skip on days a thought was written (data from sync)
def put_slot(thoughts):
    st, cur = req('GET', '/api/slot/kokoro')
    data = json.dumps({'app': 'kokoro', 'v': 1, 'people': [], 'actions': [], 'thoughts': thoughts, 'sessions': [], 'labels': {}, 'del': {}})
    return req('PUT', '/api/slot/kokoro', {'base': cur['rev'], 'data': data})
put_slot([{'id': 't1', 'text': 'x', 'type': 'hope', 'date': int(vn(17, 9, 0).timestamp() * 1000)}])
r = cron(vn(17, 21, 0)); ok('skipped: a thought was written today', r['skipped'] == 1 and r['sent'] == 0, r)
r = cron(vn(17, 21, 10)); ok('skip counts as done for the day', r['skipped'] == 0 and r['sent'] == 0, r)
r = cron(vn(18, 21, 0)); ok('next day without a thought: sent', r['sent'] == 1, r)
put_slot([{'id': 't2', 'text': 'x', 'type': 'hope', 'date': int(vn(19, 0, 30).timestamp() * 1000)}])
r = cron(vn(19, 21, 0)); ok('thought just after midnight counts for that day', r['skipped'] == 1, r)
put_slot([{'id': 't3', 'text': 'x', 'type': 'hope', 'date': int(vn(19, 23, 59).timestamp() * 1000)}])
r = cron(vn(20, 21, 0)); ok('thought late the previous evening does not count', r['sent'] == 1, r)
# dead and failing endpoints
knob(pushStatus={'gone': 410, 'flaky': 500})
put(EP('gone'), '08:00'); put(EP('flaky'), '08:00')
r = cron(vn(22, 8, 0)); ok('410 removes the phone', r['removed'] == 1 and not any(x['endpoint'] == EP('gone') for x in subs()), r)
fl = [x for x in subs() if x['endpoint'] == EP('flaky')][0]
ok('500 counts a failure but keeps the phone', r['failed'] == 1 and fl['fails'] == 1, fl)
s, r = req('POST', '/api/push/test', {'endpoint': EP('gone')})
ok('test to a dead phone says so', r['ok'] is False and r['status'] == 410, r)
s, r = req('POST', '/api/push/test', {'endpoint': EP('vn')})
ok('test sends now', r['ok'] is True and [x['id'] for x in pushes()][-1] == 'vn', r)

# ---------------- Settings card in Chromium ----------------
STUB = """
(() => {
  let current = null;
  const mk = (key) => ({ endpoint: 'http://localhost:8787/__push/phone-' + Math.random().toString(36).slice(2, 8),
    options: { applicationServerKey: key.buffer }, unsubscribe: async () => { current = null; return true; } });
  PushManager.prototype.subscribe = async function (o) { current = mk(new Uint8Array(o.applicationServerKey)); window.__subs = (window.__subs || 0) + 1; return current; };
  PushManager.prototype.getSubscription = async function () { return current; };
})();
"""
knob(reset=True, clearPushes=True, pushStatus={'gone': 201, 'flaky': 201})
with sync_playwright() as p:
    b = p.chromium.launch(channel='chromium')   # full Chromium: the headless shell always denies notifications
    # opened as a file: not supported
    c0 = b.new_context(); p0 = c0.new_page(); p0.goto('file:///home/claude/brain-rewire/public/kokoro.html'); p0.click('.tab[data-v=settings]')
    ok('file: explains it needs the web address', 'web address' in p0.inner_text('#remindBox')); c0.close()

    ctx = b.new_context(viewport={'width': 412, 'height': 915}, extra_http_headers={'X-Forwarded-For': 'phone-ui'})
    ctx.grant_permissions(['notifications'], origin=B)
    ctx.add_init_script(STUB)
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(B + '/kokoro.html'); pg.wait_for_selector('#newT')
    pg.click('.tab[data-v=settings]')
    ok('sync off: asks to connect sync first', 'connect Cloud sync' in pg.inner_text('#remindBox'))
    pg.fill('#spin', '2468'); pg.click('[data-act=syncConnect]'); pg.wait_for_selector('[data-act=syncNowBtn]')
    pg.wait_for_selector('[data-in=remindOn]')
    ok('after connecting: switch and time shown, default 21:00', pg.input_value('#remT') == '21:00' and not pg.is_checked('[data-in=remindOn]'))
    pg.check('[data-in=remindOn]')
    pg.wait_for_function("document.getElementById('remindBox').innerText.includes('Done')", timeout=8000)
    sb = subs()
    ok('turning on registers this phone at 21:00', len(sb) == 1 and sb[0]['mins'] == 1260, sb)
    ok('local prefs saved', pg.evaluate("JSON.parse(localStorage.getItem('kkr.push')).on") is True)
    pg.click('[data-act=remindTest]')
    pg.wait_for_function("document.getElementById('remindBox').innerText.includes('Sent')", timeout=8000)
    ok('test button reaches the push service', pushes()[-1]['id'].startswith('phone-') and pushes()[-1]['vapid'])
    pg.fill('#remT', '07:30'); pg.dispatch_event('#remT', 'change')
    pg.wait_for_function("document.getElementById('remindBox').innerText.includes('Saved')", timeout=8000)
    ok('changing the time updates the Worker', subs()[0]['mins'] == 450, subs())
    # reload: refresh keeps one subscription, no duplicates
    pg.reload(); pg.wait_for_selector('#newT'); pg.wait_for_timeout(5000)
    ok('reopening keeps exactly one phone entry', len(subs()) == 1, subs())
    # the service worker shows the notification on a push
    cdp = ctx.new_cdp_session(pg)
    regs = {}
    cdp.on('ServiceWorker.workerRegistrationUpdated', lambda e: [regs.__setitem__(r['scopeURL'], r['registrationId']) for r in e['registrations']])
    cdp.send('ServiceWorker.enable'); pg.wait_for_timeout(800)
    rid = next((v for k, v in regs.items() if k.startswith(B)), None)
    if rid:
        cdp.send('ServiceWorker.deliverPushMessage', {'origin': B, 'registrationId': rid, 'data': ''})
        pg.wait_for_timeout(1200)
        n = pg.evaluate("navigator.serviceWorker.ready.then(r => r.getNotifications()).then(ns => ns.map(n => [n.title, n.body, n.tag, n.icon.slice(0, 22)]))")
        ok('push shows “Kokoro · Time for a moment with Kokoro.” with the stamp icon', n and n[0][0] == 'Kokoro' and n[0][1] == 'Time for a moment with Kokoro.' and n[0][2] == 'kokoro-daily' and n[0][3] == 'data:image/png;base64,', n)
    else: ok('found the service worker registration', False, regs)
    # turning off removes it
    pg.click('.tab[data-v=settings]'); pg.uncheck('[data-in=remindOn]'); pg.wait_for_timeout(800)
    ok('turning off removes the phone', subs() == [], subs())
    # on again, then disconnect sync: also removed
    pg.check('[data-in=remindOn]'); pg.wait_for_function("document.getElementById('remindBox').innerText.includes('Done')", timeout=8000)
    pg.click('[data-act=syncOff]'); pg.click('[data-act=syncOff]'); pg.wait_for_timeout(800)
    ok('disconnecting sync removes the reminder', subs() == [] and 'connect Cloud sync' in pg.inner_text('#remindBox'), subs())
    ok('no page errors', not errs, errs)
    ctx.close()

    # permission denied
    c2 = b.new_context(extra_http_headers={'X-Forwarded-For': 'phone-denied'}); c2.add_init_script(STUB + "Notification.requestPermission = async () => 'denied';")
    p2 = c2.new_page(); p2.goto(B + '/kokoro.html'); p2.wait_for_selector('#newT'); p2.click('.tab[data-v=settings]')
    p2.fill('#spin', '2468'); p2.click('[data-act=syncConnect]'); p2.wait_for_selector('[data-in=remindOn]')
    p2.click('[data-in=remindOn]'); p2.wait_for_timeout(800)
    ok('denied: explains how to allow, switch stays off', 'blocked' in p2.inner_text('#remindBox') and subs() == [], p2.inner_text('#remindBox'))
    c2.close()
    # sync site needs sign-in again (Access): clear message
    c3 = b.new_context(extra_http_headers={'X-Forwarded-For': 'phone-auth'}); c3.grant_permissions(['notifications'], origin=B); c3.add_init_script(STUB)
    p3 = c3.new_page(); p3.goto(B + '/kokoro.html'); p3.wait_for_selector('#newT'); p3.click('.tab[data-v=settings]')
    p3.fill('#spin', '2468'); p3.click('[data-act=syncConnect]'); p3.wait_for_selector('[data-in=remindOn]')
    knob(access=True); p3.click('[data-in=remindOn]'); p3.wait_for_timeout(1500); knob(access=False)
    ok('expired sign-in: says so, stays off', 'sign-in' in p3.inner_text('#remindBox') and not p3.is_checked('[data-in=remindOn]'), p3.inner_text('#remindBox'))
    c3.close()
    b.close()

print('PASS', len(PASSES)); print('FAIL', len(FAILS))
sys.exit(1 if FAILS else 0)

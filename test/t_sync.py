"""Sync between devices through the real worker.js on the local test server."""
import json, sys, time, urllib.request
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8787/kokoro.html'
FAILS, PASSES = [], []
def ok(name, cond, info=''):
    (PASSES if cond else FAILS).append(name + ('' if cond else ' :: ' + str(info)))
    if not cond: print('  ✗', name, info, flush=True)
def knob(**k):
    r = urllib.request.Request('http://localhost:8787/__knob', data=json.dumps(k).encode(), method='POST'); return urllib.request.urlopen(r).read().decode()
def cloud():
    r = urllib.request.Request('http://localhost:8787/api/slot/kokoro', headers={'X-Pin': '2468', 'X-Forwarded-For': 'tester'}); j = json.loads(urllib.request.urlopen(r).read())
    return j['rev'], (json.loads(j['data']) if j['data'] else None)
def put_cloud(data, base):
    r = urllib.request.Request('http://localhost:8787/api/slot/kokoro', data=json.dumps({'base': base, 'data': data}).encode(), method='PUT', headers={'X-Pin': '2468', 'X-Forwarded-For': 'tester', 'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(r).read())

def state(pg): return pg.evaluate("JSON.parse(localStorage.getItem('kkr.v1'))")
def until(fn, t=8):
    end = time.time() + t
    while time.time() < end:
        try:
            if fn(): return True
        except Exception: pass
        time.sleep(0.15)
    return False

with sync_playwright() as p:
    b = p.chromium.launch()
    def device(ip):
        ctx = b.new_context(viewport={'width': 412, 'height': 915}, extra_http_headers={'X-Forwarded-For': ip})
        pg = ctx.new_page(); pg.errs = []; pg.on('pageerror', lambda e: pg.errs.append(str(e)))
        pg.goto(BASE); pg.wait_for_selector('#newT'); return ctx, pg
    def add_thought(pg, text, typ='spiral'):
        pg.click('.tab[data-v=becoming]'); pg.fill('#newT', text); pg.click(f'[data-act=draftType][data-v={typ}]'); pg.click('[data-act=saveThought]')
    def connect(pg, pin='2468'):
        pg.click('.tab[data-v=settings]'); pg.fill('#spin', pin); pg.click('[data-act=syncConnect]')
    def sync(pg):
        pg.click('.tab[data-v=settings]'); pg.wait_for_selector('[data-act=syncNowBtn]'); pg.click('[data-act=syncNowBtn]')
        until(lambda: pg.evaluate("document.getElementById('sdot') && document.getElementById('sdot').className").find('s-busy') < 0, 6)
        pg.wait_for_timeout(150)
    texts = lambda pg: sorted(t['text'] for t in state(pg)['thoughts'])

    knob(reset=True, delay=0, down=False, pin='2468')
    A_ctx, A = device('dev-a'); add_thought(A, 'From phone A')
    connect(A); until(lambda: A.query_selector('[data-act=syncNowBtn]'))
    ok('A connects to empty cloud', until(lambda: cloud()[0] >= 1) and cloud()[1]['thoughts'][0]['text'] == 'From phone A')
    ok('status dot green', until(lambda: 's-ok' in A.get_attribute('#sdot', 'class')))

    B_ctx, B = device('dev-b'); connect(B)
    ok('empty B takes cloud copy silently', until(lambda: texts(B) == ['From phone A']))

    C_ctx, C = device('dev-c'); add_thought(C, 'From watch C')
    connect(C); C.wait_for_selector('[data-act=connMerge]')
    ok('C with own data is asked', 'already has data' in C.inner_text('.sheet'))
    C.click('[data-act=connMerge]')
    ok('merge both keeps both', until(lambda: texts(C) == ['From phone A', 'From watch C']))
    sync(A); sync(B)
    ok('A and B receive C', texts(A) == texts(B) == ['From phone A', 'From watch C'], (texts(A), texts(B)))

    # different items edited on two devices at once
    add_thought(A, 'A2'); add_thought(B, 'B2')
    A.evaluate("document.querySelector('[data-act=tab][data-v=settings]').click()"); B.evaluate("document.querySelector('[data-act=tab][data-v=settings]').click()")
    A.evaluate("document.querySelector('[data-act=syncNowBtn]').click()"); B.evaluate("document.querySelector('[data-act=syncNowBtn]').click()")
    time.sleep(1.5); sync(A); sync(B); sync(C)
    ok('two devices saving at the same moment converge', texts(A) == texts(B) == texts(C) and len(texts(A)) == 4, (texts(A), texts(B), texts(C)))

    # same item edited on both: newer wins everywhere
    tid = [t for t in state(A)['thoughts'] if t['text'] == 'A2'][0]['id']
    def edit(pg, new):
        pg.click('.tab[data-v=becoming]'); pg.click(f'.tl[data-act=thought][data-id="{tid}"]'); pg.fill('#teText', new); pg.click('[data-act=teSave]')
    edit(B, 'A2 edited on B'); time.sleep(0.05); edit(A, 'A2 edited on A later')
    sync(B); sync(A); sync(B); sync(C)
    ok('same item: later edit wins on every device', all('A2 edited on A later' in texts(x) and 'A2 edited on B' not in texts(x) for x in (A, B, C)), (texts(A), texts(B)))

    # delete on one device vs later edit on another
    tid2 = [t for t in state(A)['thoughts'] if t['text'] == 'B2'][0]['id']
    A.click('.tab[data-v=becoming]'); A.click(f'.tl[data-act=thought][data-id="{tid2}"]'); A.click('[data-act=teDel]'); A.click('[data-act=teDel]')
    time.sleep(0.05)
    B.click('.tab[data-v=becoming]'); B.click(f'.tl[data-act=thought][data-id="{tid2}"]'); B.fill('#teText', 'B2 kept by later edit'); B.click('[data-act=teSave]')
    sync(A); sync(B); sync(A)
    ok('later edit beats earlier delete', 'B2 kept by later edit' in texts(A) and 'B2 kept by later edit' in texts(B))
    B.click('.tab[data-v=becoming]'); B.click(f'.tl[data-act=thought][data-id="{tid2}"]'); B.click('[data-act=teDel]'); B.click('[data-act=teDel]')
    sync(B); sync(A); sync(C)
    ok('delete spreads to every device', all(not any('B2' in t for t in texts(x)) for x in (A, B, C)))

    # a change made during a slow save still gets sent
    knob(delay=1500)
    add_thought(A, 'During slow save 1')
    A.click('.tab[data-v=settings]'); A.click('[data-act=syncNowBtn]'); time.sleep(0.3)
    add_thought(A, 'During slow save 2')
    time.sleep(6); knob(delay=0); sync(A)
    ok('change during a slow save reaches the cloud', 'During slow save 2' in [t['text'] for t in cloud()[1]['thoughts']])

    # offline, then back online
    knob(down=True)
    add_thought(A, 'Offline thought'); sync(A)
    ok('offline: grey dot and message', 's-offline' in A.get_attribute('#sdot', 'class') and 'Offline' in A.inner_text('#syncBox'), A.get_attribute('#sdot', 'class'))
    ok('offline: change kept on phone', 'Offline thought' in texts(A))
    A.reload(); A.wait_for_selector('#newT')
    ok('offline: survives reload', 'Offline thought' in texts(A))
    knob(down=False); sync(A); sync(B)
    ok('back online: change reaches other device', 'Offline thought' in texts(B))

    # keepalive save when the page is hidden/closed
    add_thought(B, 'Saved on close')
    B.close(); time.sleep(1)
    ok('keepalive save when the page closes', 'Saved on close' in [t['text'] for t in cloud()[1]['thoughts']])
    B = B_ctx.new_page(); B.errs = []; B.goto(BASE); B.wait_for_selector('#newT')

    # convergence: no more pushes when nothing changed
    sync(A); sync(B); sync(C); r0 = cloud()[0]; sync(A); sync(B); sync(C); sync(A)
    ok('converged: no pushes when nothing changes', cloud()[0] == r0, (r0, cloud()[0]))
    ok('converged: identical data', texts(A) == texts(B) == texts(C))

    # people, actions, map places and labels sync too
    A.click('.tab[data-v=people]'); A.click('[data-act=addPerson]'); A.fill('#pN', 'Mai'); A.click('[data-act=pSave]'); A.wait_for_selector('[data-act=logAction]')
    A.click('[data-act=logAction]'); A.fill('#aT', 'Helped'); A.click('[data-act=alv][data-v="3"]'); A.click('[data-act=aSave]')
    A.click('.tab[data-v=settings]'); A.fill('[data-in=zname][data-k=ring1]', 'Heart circle'); time.sleep(0.8)
    sync(A); sync(B)
    sb = state(B)
    ok('person, action and zone name sync', sb['people'][0]['name'] == 'Mai' and sb['actions'][0]['level'] == 3 and sb['labels']['zones']['ring1'] == 'Heart circle')

    # import Replace spreads to every device
    rep = {'app': 'kokoro', 'v': 1, 'data': {'thoughts': [{'id': 'only', 'text': 'Only this', 'type': 'fact', 'date': 1790000000000}]}}
    import tempfile, os
    f = os.path.join(tempfile.mkdtemp(), 'r.json'); json.dump(rep, open(f, 'w'))
    A.click('.tab[data-v=settings]'); A.set_input_files('#file', f); A.wait_for_selector('[data-act=impReplace]')
    ok('replace warns about synced devices', 'every synced device' in A.inner_text('.sheet'))
    A.click('[data-act=impReplace]'); A.click('[data-act=impReplace]'); time.sleep(0.3)
    sync(A); sync(B); sync(C)
    ok('import Replace wins on every device', texts(A) == texts(B) == texts(C) == ['Only this'] and state(B)['people'] == [], (texts(B), texts(C)))

    # erase all spreads
    C.click('.tab[data-v=settings]')
    ok('erase warns about every device', 'every device' in C.inner_text('#main'))
    C.click('[data-act=eraseAll]'); C.click('[data-act=eraseAll]'); sync(C); sync(A)
    ok('erase all spreads', texts(A) == [] and texts(C) == [])

    # wrong PIN and the lockout
    knob(clearGuard=True)
    D_ctx, Dp = device('dev-d'); add_thought(Dp, 'D own')
    Dp.click('.tab[data-v=settings]')
    for i in range(4):
        Dp.evaluate("document.getElementById('syncErr').textContent=''"); Dp.fill('#spin', '1111'); Dp.click('[data-act=syncConnect]'); until(lambda: Dp.inner_text('#syncErr') != '', 4); last = Dp.inner_text('#syncErr'); Dp.wait_for_timeout(100)
    ok('wrong PIN says tries left', 'not accepted' in last and '1 try left' in last, last)
    Dp.fill('#spin', '1111'); Dp.click('[data-act=syncConnect]'); until(lambda: 'paused' in Dp.inner_text('#syncErr'), 4)
    ok('5 wrong PINs lock this device out', 'paused for 15 min' in Dp.inner_text('#syncErr'), Dp.inner_text('#syncErr'))
    Dp.fill('#spin', '2468'); Dp.click('[data-act=syncConnect]'); until(lambda: 'paused' in Dp.inner_text('#syncErr'), 4)
    ok('even the right PIN waits during the lockout', 'paused' in Dp.inner_text('#syncErr'))
    ok('other devices are not locked out', (sync(A) or True) and 's-ok' in A.get_attribute('#sdot', 'class'))
    ok('locked device keeps its data, sync stays off', texts(Dp) == ['D own'] and Dp.query_selector('[data-act=syncConnect]') is not None)
    knob(clearGuard=True)

    # PIN changed on the server: device shows the problem and can retry
    knob(pin='9999'); add_thought(A, 'after pin change'); sync(A)
    ok('PIN changed on server: red dot and PIN box', 's-pin' in A.get_attribute('#sdot', 'class') and A.query_selector('#spin2') is not None)
    A.fill('#spin2', '9999'); A.click('[data-act=syncPin]'); until(lambda: 's-ok' in A.get_attribute('#sdot', 'class'), 6)
    ok('new PIN works', 's-ok' in A.get_attribute('#sdot', 'class') and 'after pin change' in [t['text'] for t in cloud_pin('9999')[1]['thoughts']] if (cloud_pin := (lambda pin: (lambda r: (r['rev'], json.loads(r['data'])))(json.loads(urllib.request.urlopen(urllib.request.Request('http://localhost:8787/api/slot/kokoro', headers={'X-Pin': pin, 'X-Forwarded-For': 'tester'})).read())))) else False)
    knob(pin='2468'); knob(clearGuard=True)
    A.fill('#spin2', '2468') if A.query_selector('#spin2') else None

    # foreign or corrupt cloud data is refused without touching local data
    knob(reset=True)
    put_cloud(json.dumps({'app': 'the-way', 'v': 2}), 0)
    E_ctx, E = device('dev-e'); add_thought(E, 'E stays'); connect(E); until(lambda: E.inner_text('#syncErr') != '', 5)
    ok('foreign cloud data refused', 'another tool' in E.inner_text('#syncErr') and texts(E) == ['E stays'], E.inner_text('#syncErr'))
    knob(reset=True); put_cloud('{not json', 0)
    E.fill('#spin', '2468'); E.click('[data-act=syncConnect]'); until(lambda: 'could not be read' in E.inner_text('#syncErr'), 5)
    ok('corrupt cloud data refused', 'could not be read' in E.inner_text('#syncErr') and texts(E) == ['E stays'])

    # large data in several pieces
    knob(reset=True)
    big = {'app': 'kokoro', 'v': 1, 'data': {'thoughts': [{'id': 'b%05d' % i, 'text': 'Thought number %d with some words to make it longer than short' % i, 'type': 'spiral', 'date': 1790000000000 + i} for i in range(12000)]}}
    f2 = os.path.join(tempfile.mkdtemp(), 'big.json'); json.dump(big, open(f2, 'w'))
    E.click('.tab[data-v=settings]'); E.set_input_files('#file', f2); E.wait_for_selector('[data-act=impReplace]'); E.click('[data-act=impReplace]'); E.click('[data-act=impReplace]'); time.sleep(0.5)
    E.click('.tab[data-v=settings]'); E.fill('#spin', '2468'); E.click('[data-act=syncConnect]'); time.sleep(4)
    rev, data = cloud()
    ok('12,000 records stored in several pieces', data and len(data['thoughts']) == 12000, rev)
    F_ctx, F = device('dev-f'); connect(F)
    ok('12,000 records arrive on a new device', until(lambda: len(state(F)['thoughts']) == 12000, 15))
    F.click('.tab[data-v=becoming]'); t0 = time.time(); F.wait_for_selector('.tl'); dt = time.time() - t0
    ok('library still fast with 12,000 thoughts', dt < 2.5, dt)

    errs = [e for x in (A, B, C, E, F) for e in x.errs]
    ok('no page errors during sync', not errs, errs[:3])
    b.close()

print('PASS', len(PASSES)); print('FAIL', len(FAILS))
for f in FAILS: print('  ✗', f)
sys.exit(1 if FAILS else 0)

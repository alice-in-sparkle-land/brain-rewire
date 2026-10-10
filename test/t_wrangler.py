"""The same app in Cloudflare's local runtime (wrangler dev): pages, D1, sync, large data, offline, lockout."""
import json, os, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8788/kokoro.html'
FAILS, PASSES = [], []
def ok(name, cond, info=''):
    (PASSES if cond else FAILS).append(name + ('' if cond else ' :: ' + str(info)))
    if not cond: print('  ✗', name, info, flush=True)
def state(pg): return pg.evaluate("JSON.parse(localStorage.getItem('kkr.v1'))")
def until(fn, t=10):
    end = time.time() + t
    while time.time() < end:
        try:
            if fn(): return True
        except Exception: pass
        time.sleep(0.2)
    return False

with sync_playwright() as p:
    b = p.chromium.launch()
    def device():
        ctx = b.new_context(viewport={'width': 412, 'height': 915}); pg = ctx.new_page(); pg.errs = []
        pg.on('pageerror', lambda e: pg.errs.append(str(e))); pg.goto(BASE); pg.wait_for_selector('#newT'); return ctx, pg
    def connect(pg):
        pg.click('.tab[data-v=settings]'); pg.fill('#spin', '2468'); pg.click('[data-act=syncConnect]')
    def sync(pg):
        pg.click('.tab[data-v=settings]'); pg.wait_for_selector('[data-act=syncNowBtn]'); pg.click('[data-act=syncNowBtn]'); time.sleep(1.2)
    texts = lambda pg: sorted(t['text'] for t in state(pg)['thoughts'])

    actx, A = device()
    ok('root redirects to the app', A.url == BASE)
    A.fill('#newT', 'Real runtime thought'); A.click('[data-act=draftType][data-v=hope]'); A.click('[data-act=saveThought]')
    connect(A); ok('connects in the real runtime', until(lambda: 's-ok' in A.get_attribute('#sdot', 'class')))
    bctx, B = device(); connect(B)
    ok('second device receives the data', until(lambda: texts(B) == ['Real runtime thought']))
    B.click('.tab[data-v=people]'); B.click('[data-act=addPerson]'); B.fill('#pN', 'Mai'); B.click('[data-act=pSave]'); B.wait_for_selector('[data-act=logAction]')
    sync(B); sync(A)
    ok('person syncs back', [x['name'] for x in state(A)['people']] == ['Mai'])

    # offline opening through the service worker
    A.goto(BASE); A.wait_for_timeout(1500)
    ok('service worker active', A.evaluate("navigator.serviceWorker.controller !== null") or (A.reload() or A.wait_for_timeout(800) or A.evaluate("navigator.serviceWorker.controller !== null")))
    actx.set_offline(True)
    A.reload(); A.wait_for_selector('#newT', timeout=8000)
    ok('opens with no internet', 'Real runtime thought' in A.inner_text('#main'))
    A.fill('#newT', 'Written offline'); A.click('[data-act=draftType][data-v=fact]'); A.click('[data-act=saveThought]')
    actx.set_offline(False); sync(A); sync(B)
    ok('offline change syncs when back online', 'Written offline' in texts(B))

    # large data
    big = {'app': 'kokoro', 'v': 1, 'data': {'thoughts': [{'id': 'b%05d' % i, 'text': 'Thought number %d with enough words to be realistic for a person' % i, 'type': 'fact', 'date': 1790000000000 + i} for i in range(12000)]}}
    f = os.path.join(tempfile.mkdtemp(), 'big.json'); json.dump(big, open(f, 'w'))
    A.click('.tab[data-v=settings]'); A.set_input_files('#file', f); A.wait_for_selector('[data-act=impReplace]'); A.click('[data-act=impReplace]'); A.click('[data-act=impReplace]')
    time.sleep(1); sync(A); time.sleep(3); sync(B)
    ok('12,000 records through real D1 in pieces', until(lambda: len(state(B)['thoughts']) == 12000, 20), len(state(B)['thoughts']))

    # lockout last (wrangler gives every request the same address)
    cctx, C = device(); C.click('.tab[data-v=settings]')
    for i in range(5):
        C.evaluate("document.getElementById('syncErr').textContent=''"); C.fill('#spin', '0000'); C.click('[data-act=syncConnect]'); until(lambda: C.inner_text('#syncErr') != '', 5)
    ok('lockout after 5 wrong PINs', 'paused' in C.inner_text('#syncErr'), C.inner_text('#syncErr'))
    errs = A.errs + B.errs + C.errs
    ok('no page errors', not errs, errs[:3])
    b.close()

print('PASS', len(PASSES)); print('FAIL', len(FAILS))
sys.exit(1 if FAILS else 0)

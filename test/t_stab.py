"""Stability: Back gesture, sheets, storage/history blocked, crash -> Lite, widths, memory, network."""
import json, sys, time
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8787/kokoro.html'
FAILS, PASSES = [], []
def ok(name, cond, info=''):
    (PASSES if cond else FAILS).append(name + ('' if cond else ' :: ' + str(info)))
    if not cond: print('  ✗', name, info, flush=True)

SEED = {'app': 'kokoro', 'v': 1, 'data': {
    'people': [{'id': 'p1', 'name': 'Mai', 'place': {'x': 60, 'y': 40}}, {'id': 'p2', 'name': 'Mom'}],
    'actions': [{'id': 'a1', 'pid': 'p1', 'title': 'Helped', 'level': 3, 'date': '2026-10-01'}],
    'thoughts': [{'id': 't1', 'text': 'One two three four', 'type': 'spiral', 'pid': 'p1', 'date': 1791000000000}],
    'sessions': [{'id': 's1', 'thoughtIds': ['t1'], 'open': True, 'date': 1791000000000}]}}

def seed(pg):
    pg.evaluate("d => { const st = d.data; st.meta = {welcomed:true}; localStorage.setItem('kkr.v1', JSON.stringify(st)); }", SEED)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 412, 'height': 915}); pg = ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    ext = []; pg.on('request', lambda r: ext.append(r.url) if not r.url.startswith(('http://localhost:8787', 'data:', 'blob:')) else None)
    pg.goto('http://localhost:8787/export-old-data.html'); seed(pg)   # seed from another page so nothing overwrites it
    pg.goto(BASE); pg.wait_for_selector('#newT')
    toast = lambda: pg.inner_text('#toast') if pg.evaluate("document.getElementById('toast').classList.contains('on')") else ''

    # --- Back gesture on the main screen
    pg.go_back(); pg.wait_for_timeout(200)
    ok('first Back shows hint and stays', 'Swipe back again' in toast() and pg.url.endswith('kokoro.html') and pg.query_selector('#newT'))
    pg.wait_for_timeout(2700)
    pg.go_back(); pg.wait_for_timeout(200)
    ok('Back after 2.5 s warns again', 'Swipe back again' in toast() and pg.query_selector('#newT') is not None)
    # sheets and pages
    pg.click('[data-act=fab]'); pg.wait_for_selector('.sheet')
    pg.go_back(); pg.wait_for_timeout(200)
    ok('Back closes a sheet', pg.query_selector('#ov') is None and pg.query_selector('#newT') is not None)
    pg.click('[data-act=openSession]'); pg.wait_for_selector('[data-act=extract]')
    pg.click('[data-act=report]'); pg.wait_for_selector('#repBox')
    pg.go_back(); pg.wait_for_timeout(200)
    ok('Back closes sheet over a page, page stays', pg.query_selector('#ov') is None and pg.query_selector('[data-act=extract]') is not None)
    pg.go_back(); pg.wait_for_timeout(200)
    ok('Back closes the page', pg.query_selector('#newT') is not None)
    # close a sheet with its button, then open another at once (the late-Back bug)
    pg.click('[data-act=fab]'); pg.wait_for_selector('.sheet')
    pg.evaluate("document.querySelector('[data-act=closeSheet]').click(); document.querySelector('[data-act=fab]').click();")
    pg.wait_for_timeout(400)
    ok('sheet reopened right after closing stays open', pg.query_selector('#ov .sheet') is not None)
    pg.go_back(); pg.wait_for_timeout(300)
    ok('and Back still closes it', pg.query_selector('#ov') is None)
    # close button never leaves the app
    for i in range(3):
        pg.click('[data-act=fab]'); pg.wait_for_selector('.sheet'); pg.click('[data-act=closeSheet]'); pg.wait_for_timeout(150)
    ok('close buttons never leave the app', pg.url.endswith('kokoro.html') and pg.query_selector('#newT') is not None)
    # from a sheet open a page (thought sheet -> session)
    pg.click('.tl[data-act=thought]'); pg.wait_for_selector('.sheet'); pg.click('.sheet [data-act=openSession]'); pg.wait_for_timeout(400)
    ok('sheet -> page swaps cleanly', pg.query_selector('#ov') is None and pg.query_selector('[data-act=extract]') is not None)
    pg.go_back(); pg.wait_for_timeout(300)
    ok('one Back returns to main', pg.query_selector('#newT') is not None)
    # deep: person page -> edit -> delete closes everything
    pg.click('.tab[data-v=people]'); pg.click('[data-act=person][data-id=p2]'); pg.click('[data-act=editPerson]'); pg.click('[data-act=pDel]'); pg.click('[data-act=pDel]'); pg.wait_for_timeout(400)
    ok('delete person returns to list', pg.query_selector('#plist') is not None and 'Mom' not in pg.inner_text('#plist'))
    pg.go_back(); pg.wait_for_timeout(200)
    ok('history clean after delete (Back = hint)', 'Swipe back again' in toast())
    pg.wait_for_timeout(2600)
    # double back really leaves
    pg.go_back(); pg.wait_for_timeout(150); pg.go_back(); pg.wait_for_timeout(500)
    ok('second Back within 2.5 s leaves', 'kokoro.html' not in pg.url, pg.url)

    # --- 360 px, no horizontal scroll, on every tab and page
    ctx3 = b.new_context(viewport={'width': 360, 'height': 740}); p3 = ctx3.new_page()
    p3.goto('http://localhost:8787/export-old-data.html'); seed(p3); p3.goto(BASE); p3.wait_for_selector('#newT')
    over = []
    def chk(n):
        w = p3.evaluate('document.documentElement.scrollWidth')
        if w > 360: over.append((n, w))
    for t in ['becoming', 'map', 'people', 'settings']:
        p3.click(f'.tab[data-v={t}]'); p3.wait_for_timeout(150); chk(t)
    p3.click('.tab[data-v=people]'); p3.click('[data-act=person][data-id=p1]'); p3.wait_for_timeout(150); chk('person')
    p3.click('[data-act=logAction]'); p3.wait_for_timeout(150); chk('action sheet')
    ok('no horizontal scroll at 360 px', not over, over)
    ctx3.close()

    # --- memory flat over 1,500 renders
    pg2 = ctx.new_page(); pg2.goto(BASE); pg2.wait_for_selector('#newT')
    cdp = ctx.new_cdp_session(pg2)
    def heap():
        cdp.send('HeapProfiler.collectGarbage'); return pg2.evaluate('performance.memory.usedJSHeapSize')
    pg2.evaluate("() => { for (let i = 0; i < 100; i++) document.querySelector('[data-act=tab][data-v=map]').click(), document.querySelector('[data-act=tab][data-v=becoming]').click(); }")
    h0 = heap()
    pg2.evaluate("() => { const t = ['map','people','settings','becoming']; for (let i = 0; i < 1500; i++) document.querySelector('[data-act=tab][data-v=' + t[i % 4] + ']').click(); }")
    h1 = heap()
    ok('memory flat after 1,500 renders', h1 < h0 * 1.5 + 2e6, (h0, h1))
    ok('DOM node count stable', pg2.evaluate('document.getElementsByTagName("*").length') < 900)

    ok('no external requests', not ext, ext[:5])
    ok('no page errors', not errs, errs)
    ctx.close()

    # --- storage blocked
    c4 = b.new_context(viewport={'width': 412, 'height': 915})
    c4.add_init_script("Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });")
    p4 = c4.new_page(); e4 = []; p4.on('pageerror', lambda e: e4.append(str(e)))
    p4.goto(BASE); p4.wait_for_selector('#newT')
    ok('storage blocked: banner shown', p4.is_visible('#banner') and 'blocked' in p4.inner_text('#banner'))
    p4.fill('#newT', 'Still works'); p4.click('[data-act=draftType][data-v=hope]'); p4.click('[data-act=saveThought]')
    ok('storage blocked: app still works in memory', 'Still works' in p4.inner_text('#main'))
    with p4.expect_download() as dl: p4.click('#banner [data-act=exportNow]')
    ok('storage blocked: export still works', json.load(open(dl.value.path()))['data']['thoughts'][0]['text'] == 'Still works')
    ok('storage blocked: no crashes', not e4, e4)
    c4.close()

    # --- history blocked
    c5 = b.new_context(viewport={'width': 412, 'height': 915})
    c5.add_init_script("history.pushState = () => { throw new Error('no'); }; history.replaceState = () => { throw new Error('no'); };")
    p5 = c5.new_page(); e5 = []; p5.on('pageerror', lambda e: e5.append(str(e)))
    p5.goto('http://localhost:8787/export-old-data.html'); seed(p5); p5.goto(BASE); p5.wait_for_selector('#newT')
    p5.click('[data-act=fab]'); p5.wait_for_selector('.sheet'); p5.click('[data-act=closeSheet]'); p5.wait_for_timeout(200)
    p5.click('[data-act=openSession]'); p5.wait_for_selector('[data-act=extract]'); p5.click('[data-act=back]'); p5.wait_for_timeout(200)
    ok('history blocked: sheets and pages still open and close', p5.query_selector('#ov') is None and p5.query_selector('#newT') is not None and p5.url.endswith('kokoro.html'))
    ok('history blocked: no crashes', not e5, e5)
    c5.close()

    # --- crash detection turns on Lite mode
    c6 = b.new_context(); p6 = c6.new_page(); p6.goto(BASE); p6.wait_for_selector('#newT')
    p6.evaluate("localStorage.setItem('kkr.vis', JSON.stringify({vis:1, t: Date.now() - 5000}))")
    p6.goto('about:blank')  # pagehide writes vis:0, so set it again to simulate a crash
    p6.goto('http://localhost:8787/export-old-data.html'); p6.evaluate("localStorage.setItem('kkr.vis', JSON.stringify({vis:1, t: Date.now() - 5000}))")
    p6.goto(BASE); p6.wait_for_selector('#newT'); p6.wait_for_timeout(800)
    ok('crash turns Lite mode on', p6.evaluate("document.body.classList.contains('lite')") and 'closed unexpectedly' in p6.inner_text('#toast'))
    p6.goto('about:blank'); p6.goto(BASE); p6.wait_for_selector('#newT')
    ok('normal close does not trigger it again', p6.evaluate("JSON.parse(localStorage.getItem('kkr.dev')).lite") is True and 'closed unexpectedly' not in p6.inner_text('#toast'))
    c6.close()

    # --- render error is caught: safe screen with export
    c7 = b.new_context(); p7 = c7.new_page(); p7.goto(BASE); p7.wait_for_selector('#newT')
    p7.evaluate("window.__orig = Array.prototype.filter; S.people.push({id:'zz', name:'x', traits: null, place: null, refl:{}, rel:'', note:''});") if False else None
    p7.evaluate("""() => { const v = document.querySelector('[data-act=tab][data-v=people]'); localStorage.setItem('kkr.v1', JSON.stringify({people:[{id:'p', name:'P'}]})); }""")
    p7.reload(); p7.wait_for_selector('#newT')
    p7.evaluate("document.querySelector('[data-act=tab][data-v=people]').click()")
    ok('people page renders after odd data', p7.query_selector('#plist') is not None)
    c7.close()
    b.close()

print('PASS', len(PASSES)); print('FAIL', len(FAILS))
for f in FAILS: print('  ✗', f)
sys.exit(1 if FAILS else 0)

"""Core flows: Becoming, sessions, people, map, person page, settings. Run with the test server up."""
import json, sys, re, time
from playwright.sync_api import sync_playwright, expect

BASE = 'http://localhost:8787/kokoro.html'
FAILS, PASSES = [], []
def ok(name, cond, info=''):
    (PASSES if cond else FAILS).append(name + ('' if cond else ' :: ' + str(info)))
    if not cond: print('  ✗', name, info, flush=True)
def state(pg): return pg.evaluate("JSON.parse(localStorage.getItem('kkr.v1'))")

def new_page(b, w=412):
    ctx = b.new_context(viewport={'width': w, 'height': 915}, device_scale_factor=1)
    pg = ctx.new_page(); pg.errs = []
    pg.on('pageerror', lambda e: pg.errs.append(str(e)))
    pg.on('console', lambda m: pg.errs.append(m.text) if m.type == 'error' else None)
    return ctx, pg

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx, pg = new_page(b)
    pg.goto(BASE); pg.wait_for_selector('#newT')

    # --- T1 write thought with validation
    pg.click('[data-act=saveThought]')
    ok('empty thought error', 'Write the thought first' in pg.inner_text('#newErr'))
    pg.fill('#newT', "I'm only wanted when I'm useful.")
    pg.click('[data-act=saveThought]')
    ok('no type error', 'Pick what kind' in pg.inner_text('#newErr'))
    pg.click('[data-act=draftType][data-v=spiral]')
    pg.reload(); pg.wait_for_selector('#newT')
    ok('draft survives reload', pg.input_value('#newT') == "I'm only wanted when I'm useful.")
    ok('draft type survives reload', pg.get_attribute('[data-act=draftType][data-v=spiral]', 'aria-pressed') == 'true')
    pg.click('[data-act=saveThought]')
    st = state(pg)
    ok('thought saved', len(st['thoughts']) == 1 and st['thoughts'][0]['type'] == 'spiral')
    ok('draft cleared', pg.input_value('#newT') == '')
    ok('library shows thought', 'only wanted' in pg.inner_text('#main'))

    # --- T2 stress test it now, words, extract, notes autosave
    pg.click('text=Stress test it now')
    pg.wait_for_selector('[data-act=extract]')
    ok('session open', state(pg)['sessions'][0]['open'] is True)
    pg.click('[data-act=extract]')
    ok('extract needs words', 'Tap a word' in pg.inner_text('.err[id^=xerr]'))
    ws = pg.query_selector_all('.wd')
    ok('words split', len(ws) == 6, len(ws))
    ws[2].click(); ws[5].click()
    pg.click('[data-act=extract]'); pg.wait_for_timeout(200)
    st = state(pg)
    ok('note made with gap mark', st['sessions'][0]['notes'][0]['phrase'] == 'wanted … useful.', st['sessions'][0]['notes'])
    ta = pg.locator('textarea[data-in=note]').first
    ok('note box focused', pg.evaluate("document.activeElement.dataset.in") == 'note')
    ta.type('Huy called just to talk')
    pg.reload(); pg.wait_for_selector('textarea[data-in=note]', timeout=3000) if False else pg.wait_for_timeout(400)
    st = state(pg)
    ok('note saved even when page closes mid-typing', st['sessions'][0]['notes'][0]['comment'] == 'Huy called just to talk', st['sessions'][0]['notes'][0])
    ok('after reload back on main screen (pages are not restored)', pg.query_selector('#newT') is not None)

    # --- T3 add thoughts to a session via picker
    pg.fill('#newT', 'Mai planned the last two trips without me.')
    pg.click('[data-act=draftType][data-v=fact]'); pg.click('[data-act=saveThought]')
    pg.fill('#newT', 'I can say no and still be loved.')
    pg.click('[data-act=draftType][data-v=hope]'); pg.click('[data-act=saveThought]')
    pg.click('[data-act=openSession]')
    pg.click('[data-act=addToSession]')
    pg.wait_for_selector('#pickList')
    ok('picker hides thoughts already in session', len(pg.query_selector_all('#pickList .pick')) == 2)
    pg.click('[data-act=pickGo]')
    ok('picker needs a tick', 'Tick at least one' in pg.inner_text('#pickErr'))
    pg.click('[data-act=pickF][data-v=fact]')
    ok('picker filter', pg.locator('#pickList .pick:not(.hidden)').count() == 1)
    pg.check('#pickList .pick:not(.hidden) input'); pg.click('[data-act=pickGo]')
    pg.wait_for_timeout(300)
    ok('thought added to session', len(state(pg)['sessions'][0]['thoughtIds']) == 2)
    ok('sheet closed after add', pg.query_selector('#ov') is None)

    # --- T4 conclusion, link new thought, report
    pg.fill('#concl', 'One lunch isn’t the whole friendship.')
    pg.click('[data-act=linkNew]')
    ok('link needs text', 'Write the new thought' in pg.inner_text('#linkErr'))
    pg.fill('#linkT', 'I can ask Mai to the next trip.')
    pg.click('[data-act=linkNew]')
    ok('link needs type', 'Pick what kind' in pg.inner_text('#linkErr'))
    pg.click('[data-act=linkType][data-v=hope]'); pg.click('[data-act=linkNew]')
    st = state(pg)
    ok('linked thought saved', len(st['sessions'][0]['linked']) == 1 and len(st['thoughts']) == 4)
    ok('conclusion saved', st['sessions'][0]['conclusion'].startswith('One lunch'))
    pg.click('[data-act=report]')
    rep = pg.input_value('#repBox')
    ok('report has thought, note, conclusion, link', all(x in rep for x in ['"I\'m only wanted', '"wanted … useful." — Huy called', '## Conclusion', 'I can ask Mai']), rep)
    with pg.expect_download() as dl: pg.click('[data-act=repDl]')
    ok('report downloads .md', dl.value.suggested_filename.endswith('.md'))
    pg.click('[data-act=closeSheet]'); pg.wait_for_timeout(200)

    # --- T5 close / reopen / new session closes old
    pg.click('[data-act=toggleOpen]')
    ok('session closed', state(pg)['sessions'][0]['open'] is False)
    pg.click('[data-act=back]'); pg.wait_for_selector('#newT')
    ok('no open banner when closed', 'Continue session' not in pg.inner_text('#main'))
    pg.click('[data-act=newSession]'); pg.check('#pickList .pick input >> nth=0'); pg.click('[data-act=pickGo]'); pg.wait_for_selector('[data-act=extract]')
    st = state(pg)
    ok('new session open', sum(1 for s in st['sessions'] if s['open']) == 1 and len(st['sessions']) == 2)
    pg.click('[data-act=back]'); pg.wait_for_timeout(200)
    pg.click('[data-act=openSession] >> nth=1') if False else None

    # --- T6 thought edit, re-tag, delete
    pg.click('.tl[data-act=thought] >> nth=0')
    pg.fill('#teText', '')
    pg.click('[data-act=teSave]')
    ok('empty edit refused', 'can’t be empty' in pg.inner_text('#teErr'))
    tid = pg.evaluate("TEDIT_ID = document.querySelector('[data-act=stressItS]').dataset.id")
    pg.fill('#teText', 'Edited thought text'); pg.click('[data-act=teType][data-v=fact]'); pg.click('[data-act=teSave]')
    t = [x for x in state(pg)['thoughts'] if x['id'] == tid][0]
    ok('thought edited and re-tagged', t['text'] == 'Edited thought text' and t['type'] == 'fact')
    # delete the first thought (in both sessions with notes)
    first = state(pg)['sessions']
    t0 = [s for s in first if not s['open']][0]['thoughtIds'][0]
    pg.evaluate(f"document.querySelector('.tl[data-act=thought][data-id=\"{t0}\"]').click()")
    pg.click('[data-act=teDel]'); ok('delete needs 2 taps', any(x['id'] == t0 for x in state(pg)['thoughts']))
    pg.click('[data-act=teDel]')
    st = state(pg)
    ok('thought deleted everywhere', not any(x['id'] == t0 for x in st['thoughts']) and not any(t0 in s['thoughtIds'] or any(n['tid'] == t0 for n in s['notes']) for s in st['sessions']))

    # --- T7 people and map
    pg.click('.tab[data-v=map]'); pg.wait_for_selector('#mapbox')
    for name in ['Mai', 'Mom', 'Ex <img src=x onerror=window.PWNED=1>']:
        pg.click('[data-act=addPerson]'); pg.fill('#pN', name); pg.click('[data-act=pSave]'); pg.wait_for_timeout(150)
    ok('injection escaped', pg.evaluate('window.PWNED') is None and '<img' in pg.inner_text('#tray'))
    ok('3 dots in tray', len(pg.query_selector_all('#tray .mdot')) == 3)
    box = pg.query_selector('#mapbox').bounding_box()
    def drag(sel, fx, fy):
        d = pg.query_selector(sel).bounding_box()
        pg.mouse.move(d['x'] + d['width'] / 2, d['y'] + d['height'] / 2); pg.mouse.down()
        bx = pg.query_selector('#mapbox').bounding_box()
        for k in range(1, 9): pg.mouse.move(bx['x'] + bx['width'] * fx * k / 8 + (d['x'] + d['width'] / 2) * (8 - k) / 8 * 0 + bx['x'] * 0, bx['y'] + bx['height'] * fy, steps=1) if False else None
        pg.mouse.move(d['x'] + 10, d['y'] + 10, steps=3)
        pg.mouse.move(bx['x'] + bx['width'] * fx, bx['y'] + bx['height'] * fy, steps=8)
        pg.mouse.up(); pg.wait_for_timeout(200)
    ids = {p_['name'].split()[0]: p_['id'] for p_ in state(pg)['people']}
    drag(f'.mdot[data-id="{ids["Mai"]}"]', 0.58, 0.40)
    drag(f'.mdot[data-id="{ids["Mom"]}"]', 0.50, 0.50)
    drag(f'.mdot[data-id="{ids["Ex"]}"]', 0.93, 0.93)
    pl = {p_['name'].split()[0]: p_['place'] for p_ in state(pg)['people']}
    zone = pg.evaluate("(() => { const r = {}; for (const p of JSON.parse(localStorage.getItem('kkr.v1')).people) r[p.name.split(' ')[0]] = p.place; return r; })()")
    ok('Mai placed in ring 2', pl['Mai'] and 8 < ((pl['Mai']['x'] - 50) ** 2 + (pl['Mai']['y'] - 50) ** 2) ** .5 <= 26.8, pl)
    ok('Mom placed in ring 1', pl['Mom'] and ((pl['Mom']['x'] - 50) ** 2 + (pl['Mom']['y'] - 50) ** 2) ** .5 <= 13.6, pl)
    ok('Ex in boundary corner', pl['Ex'] and pl['Ex']['x'] > 85 and pl['Ex']['y'] > 85, pl)
    ok('tray gone when all placed', pg.query_selector('#tray') is None)
    ok('settled note', 'boundaries are a little clearer' in pg.inner_text('#main'))
    # drag a placed dot to a new spot
    drag(f'.mdot[data-id="{ids["Mai"]}"]', 0.20, 0.80)
    pmai = [p_ for p_ in state(pg)['people'] if p_['name'] == 'Mai'][0]['place']
    ok('re-drag moves dot to let-go corner', pmai['x'] < 25 and pmai['y'] > 75, pmai)
    # tap opens the person page
    pg.click(f'.mdot[data-id="{ids["Mai"]}"]'); pg.wait_for_timeout(200)
    ok('tap opens person page', pg.query_selector('[data-act=logAction]') is not None)

    # --- T8 person page
    pg.click('[data-act=logAction]'); pg.click('[data-act=aSave]')
    ok('action needs title', 'short name' in pg.inner_text('#aErr'))
    pg.fill('#aT', 'Helped me move house'); pg.click('[data-act=aSave]')
    ok('action needs level', 'Pick how it landed' in pg.inner_text('#aErr'))
    pg.click('[data-act=alv][data-v="3"]'); pg.click('[data-act=aSave]'); pg.wait_for_timeout(150)
    pg.click('[data-act=logAction]'); pg.fill('#aT', "Didn't include me"); pg.click('[data-act=alv][data-v="1"]'); pg.click('[data-act=aSave]'); pg.wait_for_timeout(150)
    pg.click('[data-act=logAction]'); pg.fill('#aT', 'Shouted at me'); pg.click('[data-act=alv][data-v="0"]')
    pg.fill('#aDate', '2026-06-01'); pg.click('[data-act=aSave]'); pg.wait_for_timeout(150)
    st = state(pg)
    ok('3 actions logged', len(st['actions']) == 3 and sorted(a['level'] for a in st['actions']) == [0, 1, 3])
    txt = pg.inner_text('#main')
    ok('mix shows last 90 days only', '1 good' in txt and '1 hurtful' in txt and '1 toxic' not in txt, txt[:400])
    ok('old action still listed', 'Shouted at me' in txt and 'JUNE 2026' in txt.upper(), [a['date'] for a in st['actions']])
    pg.click('.act >> text=Shouted at me'); pg.click('[data-act=alv][data-v="2"]'); pg.click('[data-act=aSave]'); pg.wait_for_timeout(150)
    ok('action edited', [a for a in state(pg)['actions'] if a['title'] == 'Shouted at me'][0]['level'] == 2)
    pg.click('.act >> text=Shouted at me'); pg.click('[data-act=aDel]'); pg.click('[data-act=aDel]'); pg.wait_for_timeout(150)
    ok('action deleted', len(state(pg)['actions']) == 2)
    pg.click('[data-act=traits]'); pg.click('[data-act=preset][data-v=Loyal]'); pg.click('[data-act=preset][data-v=Guarded]'); pg.click('[data-act=preset][data-v=Loyal]')
    pg.fill('#tIn', 'Sometimes guarded about money'); pg.press('#tIn', 'Enter'); pg.wait_for_timeout(100)
    tr = [t_['text'] for t_ in [p_ for p_ in state(pg)['people'] if p_['name'] == 'Mai'][0]['traits']]
    ok('traits toggled and custom added', tr == ['Guarded', 'Sometimes guarded about money'], tr)
    pg.click('[data-act=closeSheet]'); pg.wait_for_timeout(150)
    ok('traits shown on page', 'Sometimes guarded about money' in pg.inner_text('#main'))
    pg.fill('#rf-feel', 'Grateful but hurt'); pg.wait_for_timeout(900)
    ok('reflection autosaved', [p_ for p_ in state(pg)['people'] if p_['name'] == 'Mai'][0]['refl']['feel'] == 'Grateful but hurt')
    pg.click('[data-act=thoughtAbout]'); pg.wait_for_selector('#newT')
    ok('write-about preselects person', pg.input_value('#draftP') == ids['Mai'])
    pg.fill('#newT', 'She forgot me again'); pg.click('[data-act=draftType][data-v=spiral]'); pg.click('[data-act=saveThought]')
    ok('thought linked to person', [t_ for t_ in state(pg)['thoughts'] if t_['text'] == 'She forgot me again'][0]['pid'] == ids['Mai'])

    # --- T9 people tab
    pg.click('.tab[data-v=people]'); pg.wait_for_selector('#plist')
    secs = [s.inner_text() for s in pg.query_selector_all('.sec')]
    ok('people grouped by zone in order', secs[0].startswith('Closest') and any('let go' in s for s in secs), secs)
    pg.click('[data-act=pf][data-v="1"]')
    ok('filter by hurtful', pg.inner_text('#plist').count('Mai') == 1 and 'Mom' not in pg.inner_text('#plist'))
    pg.click('[data-act=pf][data-v="-1"]'); pg.fill('#pq', 'mom')
    ok('search', 'Mom' in pg.inner_text('#plist') and 'Mai' not in pg.inner_text('#plist'))
    ok('search keeps focus', pg.evaluate("document.activeElement.id") == 'pq')
    pg.fill('#pq', '')

    # --- T10 settings: names, theme, lite
    pg.click('.tab[data-v=settings]'); pg.wait_for_selector('#syncBox')
    pg.fill('[data-in=zname][data-k=ring1]', 'My people'); pg.fill('[data-in=lname][data-i="4"]', 'Wow'); pg.wait_for_timeout(700)
    st = state(pg)
    ok('labels renamed', st['labels']['zones']['ring1'] == 'My people' and st['labels']['levels'][4] == 'Wow')
    pg.fill('[data-in=zname][data-k=ring2]', ''); pg.wait_for_timeout(700)
    ok('empty name falls back to default', state(pg)['labels']['zones']['ring2'] == 'Close')
    pg.click('[data-act=setTheme][data-v=sea]')
    dev = pg.evaluate("JSON.parse(localStorage.getItem('kkr.dev'))")
    ok('theme locked', dev['theme'] == 'sea' and dev['random'] is False)
    pg.reload(); pg.wait_for_selector('#newT')
    ok('locked theme persists', pg.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--ac').trim()") == '#1D7898')
    pg.click('.tab[data-v=settings]'); pg.check('[data-in=random]')
    pg.check('[data-in=lite]'); ok('lite on', pg.evaluate("document.body.classList.contains('lite')"))
    pg.uncheck('[data-in=lite]')

    # --- T11 export, erase, import replace, merge no duplicates
    with pg.expect_download() as dl: pg.click('[data-act=exportNow]')
    path = dl.value.path(); data = open(path).read()
    ok('backup file name', re.match(r'kokoro-backup-\d{8}-\d{4}\.json', dl.value.suggested_filename))
    before = state(pg)
    ok('changes counter reset', before['meta']['changes'] == 0)
    pg.click('[data-act=eraseAll]'); pg.click('[data-act=eraseAll]'); pg.wait_for_timeout(200)
    ok('erased', len(state(pg)['people']) == 0 and len(state(pg)['thoughts']) == 0)
    pg.click('.tab[data-v=settings]')
    pg.set_input_files('#file', path); pg.wait_for_selector('[data-act=impMerge]')
    ok('import summary', '3 people' in pg.inner_text('.sheet') and '2 actions' in pg.inner_text('.sheet'))
    pg.click('[data-act=impReplace]'); pg.click('[data-act=impReplace]'); pg.wait_for_timeout(200)
    after = state(pg)
    same = all(len(after[k]) == len(before[k]) for k in ['people', 'actions', 'thoughts', 'sessions'])
    ok('replace restores everything', same and after['labels']['zones']['ring1'] == 'My people')
    pg.evaluate("document.getElementById('file').value=''"); print('dbg', pg.evaluate('JSON.stringify({l:LAY_DBG()})') if False else '')
    pg.set_input_files('#file', path); pg.wait_for_selector('[data-act=impMerge]'); pg.click('[data-act=impMerge]'); pg.wait_for_timeout(200)
    m2 = state(pg)
    ok('merge adds no duplicates', all(len(m2[k]) == len(before[k]) for k in ['people', 'actions', 'thoughts', 'sessions']))

    # --- T13 bad files
    import tempfile, os
    def tmp(content, name='x.json'):
        f = os.path.join(tempfile.mkdtemp(), name); open(f, 'w').write(content); return f
    for label, content, expect_txt in [
        ('invalid json', '{nope', 'isn’t valid JSON'),
        ('other app', json.dumps({'app': 'the-way', 'v': 1, 'data': {}}), 'another tool'),
        ('random json', json.dumps({'hello': 1}), 'isn’t a Kokoro backup'),
    ]:
        pg.evaluate("document.getElementById('file').value=''"); pg.set_input_files('#file', tmp(content)); pg.wait_for_selector('.sheet')
        ok('rejects ' + label, expect_txt in pg.inner_text('.sheet'), pg.inner_text('.sheet'))
        pg.click('[data-act=closeSheet]'); pg.wait_for_timeout(150)
    evil = {'app': 'kokoro', 'v': 1, 'data': {'people': [{'id': 'e1', 'name': '<script>window.PWN2=1</script>Eve', 'place': {'x': 999, 'y': -5}, 'traits': [{'id': 't', 'text': '<b>x</b>'}] * 3}, {'id': 'bad id!', 'name': 'x'}, 'junk', None],
                                              'actions': [{'id': 'a1', 'pid': 'e1', 'title': 'T', 'level': 99}, {'id': 'a2', 'pid': 'nobody', 'title': 'T'}],
                                              'thoughts': [{'id': 'th', 'text': 'x' * 5000, 'type': 'weird'}],
                                              'sessions': [{'id': 's1', 'open': True}, {'id': 's2', 'open': True, 'u': 5}]}}
    pg.evaluate("document.getElementById('file').value=''"); pg.set_input_files('#file', tmp(json.dumps(evil))); pg.wait_for_selector('[data-act=impMerge]'); pg.click('[data-act=impMerge]'); pg.wait_for_timeout(200)
    st = state(pg); eve = [x for x in st['people'] if x['id'] == 'e1'][0]
    ok('malicious import cleaned', eve['place'] == {'x': 100, 'y': 0} and len(eve['traits']) == 1 and not any(x['id'] == 'bad id!' for x in st['people']))
    ok('bad action dropped, level clamped', [a for a in st['actions'] if a['id'] == 'a1'][0]['level'] == 4 and not any(a['id'] == 'a2' for a in st['actions']))
    ok('long text capped, type fixed', [t_ for t_ in st['thoughts'] if t_['id'] == 'th'][0]['type'] == 'spiral' and len([t_ for t_ in st['thoughts'] if t_['id'] == 'th'][0]['text']) == 2000)
    ok('only one open session', sum(1 for s in st['sessions'] if s['open']) == 1)
    pg.click('.tab[data-v=people]'); pg.wait_for_timeout(200)
    ok('no script injection', pg.evaluate('window.PWN2') is None)

    ok('no page errors', not pg.errs, pg.errs)
    b.close()

print('PASS', len(PASSES)); print('FAIL', len(FAILS))
for f in FAILS: print('  ✗', f)
sys.exit(1 if FAILS else 0)

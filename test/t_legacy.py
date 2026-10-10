"""Old data: real old tools write data, the helper exports it, Kokoro imports it."""
import json, os, shutil, sys, tempfile
from playwright.sync_api import sync_playwright

FAILS, PASSES = [], []
def ok(name, cond, info=''):
    (PASSES if cond else FAILS).append(name + ('' if cond else ' :: ' + str(info)))
    if not cond: print('  ✗', name, info, flush=True)

D = tempfile.mkdtemp(prefix='old-')
UP = '/root/.claude/uploads/25354eec-d9ed-5c78-bd88-670e9b8b10b5/'
shutil.copy(UP + 'dd8acc93-kokoro.html', D + '/kokoro.html')
shutil.copy(UP + '1815734d-Ban_Do_Ranh_Gioi-1.html', D + '/map.html')
shutil.copy(UP + '898ae821-stress-test.html', D + '/stress-test.html')
shutil.copy('/home/claude/kokoro/public/export-old-data.html', D + '/export-old-data.html')
F = 'file://' + D + '/'

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 412, 'height': 915}, accept_downloads=True)
    ctx.route('**/fonts.googleapis.com/**', lambda r: r.abort()); ctx.route('**/fonts.gstatic.com/**', lambda r: r.abort())
    pg = ctx.new_page()
    pg.on('dialog', lambda d: d.accept())

    # --- old Stress Test, used through its own screens
    pg.goto(F + 'stress-test.html')
    for text, typ in [("My capacity is not enough for more serious things.", 'spiral'), ("Mai planned the last two trips without me.", 'fact'), ("I can say no and still be loved.", 'hope')]:
        pg.fill('#newThoughtText', text); pg.click(f'#screen-home .type-chip[data-type={typ}]'); pg.click('#saveThoughtBtn')
    pg.click('#newStressTestBtn'); pg.check('#pickList input >> nth=2'); pg.check('#pickList input >> nth=1'); pg.click('#confirmPickBtn')
    pg.click('.word >> nth=1'); pg.click('.word >> nth=2'); pg.click('[data-extract] >> nth=0')
    pg.fill('[data-ann-comment]', 'I handled the launch alone.'); pg.fill('#sessionConclusion', 'Capacity grows.')
    pg.fill('#linkNewThoughtText', 'My value isn’t my output.'); pg.click('#linkThoughtCard .type-chip[data-type=hope]'); pg.click('#linkNewThoughtBtn')
    pg.click('#saveSessionBtn')
    old_stress = pg.evaluate("JSON.parse(localStorage.getItem('rewire-stresstest-v1'))")
    ok('old stress test wrote its data', len(old_stress['thoughts']) == 4 and len(old_stress['sessions']) == 1)

    # --- old boundary map: open it (it saves its 6 empty starter dots), then place named dots like a drag would
    pg.goto(F + 'map.html'); pg.wait_for_timeout(200)
    pg.evaluate("""() => { const d = JSON.parse(localStorage.getItem('boundary-map-v2'));
      d.items[0].name='Mai'; d.items[0].xPct=60; d.items[0].yPct=38; d.items[0].note='Hai đứa quen từ đại học';
      d.items[1].name='Sếp'; d.items[1].xPct=70; d.items[1].yPct=72;
      d.items[2].name='Ex'; d.items[2].xPct=94; d.items[2].yPct=93;
      d.items[3].xPct=20; d.items[3].yPct=20;
      d.labels.q_tr = 'Giữ khoảng cách';
      localStorage.setItem('boundary-map-v2', JSON.stringify(d)); }""")
    pg.reload(); pg.wait_for_timeout(200)
    ok('old map shows the placed dots', pg.locator('.canvas .dot').count() == 4)

    # --- old Kokoro: one person with actions at different scores, saved in its own format
    pg.goto(F + 'export-old-data.html'); pg.wait_for_timeout(100)
    pg.evaluate("""() => localStorage.setItem('kokoro.v1', JSON.stringify({version:1, people:[
      {id:'k1', name:'Mai', relation:'Friend', created: 1790000000000, updated: 1791000000000,
       traits:[{id:'t1',text:'Loyal'}], reflections:{feel:'Grateful', appreciate:'', wish:''},
       actions:[{id:'a1',title:'Helped me move',detail:'',date:'2026-09-01',score:70,created:1790000000000},
                {id:'a2',title:'Ignored me',detail:'',date:'2026-09-05',score:5,created:1790000000001},
                {id:'a3',title:'Gift',detail:'',date:'2026-09-06',score:100,created:1790000000002},
                {id:'a4',title:'Meh',detail:'',date:'2026-09-07',score:33,created:1790000000003}]},
      {id:'k2', name:'Mom', relation:'', traits:[], actions:[]}]}))""")
    pg.goto(F + 'kokoro.html'); pg.wait_for_timeout(300)
    ok('old kokoro shows people', 'Mai' in pg.inner_text('#view') and 'Mom' in pg.inner_text('#view'))

    # --- helper reads all three
    pg.goto(F + 'export-old-data.html'); pg.wait_for_timeout(200)
    found = pg.inner_text('#found')
    ok('helper finds kokoro', '2 people' in found, found)
    ok('helper finds map', '4 dots' in found, found)
    ok('helper finds stress', '4 thoughts, 1 sessions' in found, found)
    with pg.expect_download() as dl: pg.click('#dl')
    legacy = dl.value.path()
    lj = json.load(open(legacy))
    ok('helper file shape', lj['app'] == 'kokoro-legacy' and lj['kokoro'] and lj['map'] and lj['stress'])
    # the javascript: line gives the same file from inside an old tool
    snip = pg.input_value('#snip')
    pg.goto(F + 'stress-test.html')
    with pg.expect_download() as dl2: pg.evaluate(snip)
    s2 = json.load(open(dl2.value.path()))
    ok('fallback line exports from inside an old tool', s2['app'] == 'kokoro-legacy' and len(s2['stress']['thoughts']) == 4)

    # --- empty browser: helper says nothing found and hides the save card
    ctx2 = b.new_context(); pg2 = ctx2.new_page(); pg2.goto(F + 'export-old-data.html'); pg2.wait_for_timeout(150)
    ok('helper with nothing found', 'not found' in pg2.inner_text('#found') and not pg2.is_visible('#saveCard'))
    ctx2.close()

    # --- import into Kokoro
    k = b.new_context(viewport={'width': 412, 'height': 915}).new_page()
    k.goto('http://localhost:8787/kokoro.html'); k.wait_for_selector('#newT')
    k.click('.tab[data-v=settings]'); k.set_input_files('#file', legacy); k.wait_for_selector('[data-act=impMerge]')
    sm = k.inner_text('.sheet')
    ok('summary mentions sources', 'Kokoro: 2 people' in sm and 'Boundary map: 4 dots' in sm and 'Stress test: 4 thoughts, 1 sessions' in sm, sm)
    ok('summary mentions name matching', '1 map dot was matched' in sm, sm)
    k.click('[data-act=impMerge]'); k.wait_for_timeout(300)
    st = k.evaluate("JSON.parse(localStorage.getItem('kkr.v1'))")
    names = sorted(x['name'] for x in st['people'])
    ok('people merged by name', names == ['Ex', 'Mai', 'Mom', 'Sếp', 'Unnamed'], names)
    mai = [x for x in st['people'] if x['name'] == 'Mai'][0]
    ok('Mai got her map place and note', mai['place'] == {'x': 60, 'y': 38} and 'đại học' in mai['note'] and mai['rel'] == 'Friend')
    ok('Mai traits and reflection kept', mai['traits'][0]['text'] == 'Loyal' and mai['refl']['feel'] == 'Grateful')
    lv = {a['title']: a['level'] for a in st['actions']}
    ok('old scores map to levels', lv == {'Helped me move': 3, 'Ignored me': 1, 'Gift': 4, 'Meh': 2}, lv)
    ok('custom zone name kept, default Vietnamese ignored', st['labels']['zones']['q_tr'] == 'Giữ khoảng cách' and st['labels']['zones']['ring1'] == 'Closest', st['labels']['zones'])
    ok('thoughts imported with types', sorted(t['type'] for t in st['thoughts']) == ['fact', 'hope', 'hope', 'spiral'])
    s = st['sessions'][0]
    ok('session imported open with note, conclusion, link', s['open'] and len(s['notes']) == 1 and s['notes'][0]['comment'] == 'I handled the launch alone.' and s['conclusion'] == 'Capacity grows.' and len(s['linked']) == 1, s)
    ok('note phrase from old session', s['notes'][0]['phrase'] in ('can say', 'planned the'), s['notes'][0]['phrase'])
    # importing the same old file again adds nothing
    k.evaluate("document.getElementById('file').value=''"); k.set_input_files('#file', legacy); k.wait_for_selector('[data-act=impMerge]'); k.click('[data-act=impMerge]'); k.wait_for_timeout(200)
    st2 = k.evaluate("JSON.parse(localStorage.getItem('kkr.v1'))")
    ok('second old import adds no duplicates', all(len(st2[c]) == len(st[c]) for c in ['people', 'actions', 'thoughts', 'sessions']))
    # importing a single old Kokoro backup file (its own Export) also works
    kb = os.path.join(D, 'kokoro-backup.json'); json.dump({'app': 'kokoro', 'version': 1, 'exported': 'x', 'people': lj['kokoro']['people']}, open(kb, 'w'))
    k.evaluate("document.getElementById('file').value=''"); k.set_input_files('#file', kb); k.wait_for_selector('.sheet')
    ok('old Kokoro export file accepted', 'Kokoro: 2 people' in k.inner_text('.sheet'), k.inner_text('.sheet'))
    k.click('[data-act=impMerge]'); k.wait_for_timeout(200)
    k.click('.tab[data-v=becoming]'); k.wait_for_timeout(200)
    ok('open session banner after import', 'Continue session' in k.inner_text('#main'))
    k.screenshot(path='legacy_becoming.png')
    k.click('.tab[data-v=map]'); k.wait_for_timeout(200); k.screenshot(path='legacy_map.png', full_page=True)
    b.close()

print('PASS', len(PASSES)); print('FAIL', len(FAILS))
for f in FAILS: print('  ✗', f)
sys.exit(1 if FAILS else 0)

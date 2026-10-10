"""Screenshots of every screen, theme and time of day with realistic data."""
import json, os, sys
from datetime import datetime
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots'); os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:8787/kokoro.html'
T = int(datetime(2026, 10, 10, 9, 20).timestamp() * 1000)
day = 864e5
P = lambda i, n, rel, x=None, y=None, tr=(), note='': {'id': i, 'name': n, 'rel': rel, 'note': note, 'place': {'x': x, 'y': y} if x is not None else None, 'traits': [{'id': i + 't%d' % k, 'text': t} for k, t in enumerate(tr)], 'refl': {'feel': 'Grateful, and a bit hurt lately.' if i == 'mai' else '', 'appreciate': '', 'wish': ''}}
people = [P('mom', 'Mom', 'Mother', 47, 52, ['Kind', 'Anxious']), P('mai', 'Mai', 'Friend since university', 62, 38, ['Loyal', 'Funny', 'Sometimes guarded']),
          P('huy', 'Huy', 'Friend', 36, 62, ['Generous']), P('boss', 'Anh Tuấn', 'Boss', 72, 70, ['Proud']), P('ex', 'Ex', '', 92, 92, ['Restless']),
          P('unc', 'Uncle T.', 'Family', 9, 88), P('acc', 'Neighbour', '', 10, 12), P('linh', 'Linh', 'New coworker')]
A = lambda i, pid, t, lv, d, det='': {'id': i, 'pid': pid, 'title': t, 'level': lv, 'date': datetime.fromtimestamp((T - d * day) / 1000).strftime('%Y-%m-%d'), 'detail': det}
actions = [A('a1', 'mai', 'Helped me move house', 3, 8, 'Came at 7am with her brother’s van.'), A('a2', 'mai', 'Didn’t include me in the lunch chat', 1, 2), A('a3', 'mai', 'Remembered my exam and texted', 4, 20),
           A('a4', 'mai', 'Cancelled last minute', 2, 35), A('a5', 'mai', 'Covered for me at the party', 3, 50), A('a6', 'mom', 'Cooked my favourite soup', 3, 3), A('a7', 'mom', 'Compared me with my cousin', 1, 12),
           A('a8', 'ex', 'Read my messages without asking', 0, 60), A('a9', 'ex', 'Shouted in public', 0, 75), A('a10', 'boss', 'Corrected my report in the meeting', 1, 4), A('a11', 'huy', 'Called just to talk', 4, 6)]
Th = lambda i, txt, ty, d, pid='': {'id': i, 'text': txt, 'type': ty, 'pid': pid, 'date': T - d * day}
thoughts = [Th('t1', "I'm only wanted when I'm useful.", 'spiral', 0.01, 'mai'), Th('t2', 'Mai planned the last two trips without me.', 'fact', 0.02, 'mai'), Th('t3', 'I can say no and still be loved.', 'hope', 1.5),
            Th('t4', 'My capacity is not enough for more serious things.', 'spiral', 3), Th('t5', 'If I make a mistake, they will stop trusting me.', 'spiral', 4, 'boss'), Th('t6', 'Huy called last week just to talk.', 'fact', 5, 'huy'),
            Th('t7', 'Rest is part of the work.', 'hope', 9)]
sessions = [{'id': 's1', 'date': T - 0.01 * day, 'open': True, 'thoughtIds': ['t1', 't2'], 'notes': [{'id': 'n1', 'tid': 't1', 'phrase': 'only wanted', 'comment': 'Huy called last week just to talk. Mom asks how I am every day.'}],
             'conclusion': 'One lunch isn’t the whole friendship.', 'linked': ['t3']},
            {'id': 's2', 'date': T - 4 * day, 'open': False, 'thoughtIds': ['t5'], 'notes': [{'id': 'n2', 'tid': 't5', 'phrase': 'stop trusting', 'comment': 'He gave me the client launch after that meeting.'}], 'conclusion': 'Corrections are not verdicts.', 'linked': []}]
SEED = {'people': people, 'actions': actions, 'thoughts': thoughts, 'sessions': sessions, 'meta': {'welcomed': True, 'lastExport': T - 3 * day, 'changes': 4}}

def page(b, theme, hour, w=412, h=915):
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2)
    ctx.add_init_script(f"""localStorage.setItem('kkr.v1', {json.dumps(json.dumps(SEED))}); localStorage.setItem('kkr.dev', JSON.stringify({{theme:'{theme}', random:false}}));""")
    pg = ctx.new_page()
    pg.clock.install(time=datetime(2026, 10, 10, hour, 20))
    pg.goto(BASE); pg.wait_for_selector('#app .hd'); pg.wait_for_timeout(200)
    return ctx, pg

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx, pg = page(b, 'forest', 9)
    shots = [('01_becoming', None)]
    pg.screenshot(path=f'{OUT}/01_becoming.png')
    pg.click('[data-act=openSession]'); pg.wait_for_timeout(200)
    pg.click('.wd >> nth=5'); pg.screenshot(path=f'{OUT}/02_session.png')
    pg.click('[data-act=report]'); pg.wait_for_timeout(300); pg.screenshot(path=f'{OUT}/03_report.png'); pg.go_back(); pg.go_back(); pg.wait_for_timeout(200)
    pg.click('.tl[data-act=thought] >> nth=0'); pg.wait_for_timeout(300); pg.screenshot(path=f'{OUT}/04_thought_sheet.png'); pg.go_back(); pg.wait_for_timeout(200)
    pg.click('[data-act=newSession]'); pg.wait_for_timeout(300); pg.screenshot(path=f'{OUT}/05_new_session.png'); pg.go_back(); pg.wait_for_timeout(200)
    pg.click('.tab[data-v=map]'); pg.wait_for_timeout(200); pg.screenshot(path=f'{OUT}/06_map.png')
    pg.click('.tab[data-v=people]'); pg.wait_for_timeout(200); pg.screenshot(path=f'{OUT}/07_people.png')
    pg.click('[data-act=person][data-id=mai]'); pg.wait_for_timeout(200); pg.screenshot(path=f'{OUT}/08_person.png')
    pg.click('[data-act=logAction]'); pg.wait_for_timeout(300); pg.fill('#aT', 'Brought soup when I was sick'); pg.click('[data-act=alv][data-v="3"]'); pg.screenshot(path=f'{OUT}/09_log_action.png'); pg.go_back(); pg.wait_for_timeout(200)
    pg.click('[data-act=traits]'); pg.wait_for_timeout(300); pg.screenshot(path=f'{OUT}/10_traits.png'); pg.go_back(); pg.go_back(); pg.wait_for_timeout(200)
    pg.click('[data-act=fab]'); pg.wait_for_timeout(300); pg.screenshot(path=f'{OUT}/11_add.png'); pg.go_back(); pg.wait_for_timeout(200)
    pg.click('.tab[data-v=settings]'); pg.wait_for_timeout(200); pg.screenshot(path=f'{OUT}/12_settings.png', full_page=True)
    ctx.close()
    # every theme at every time of day (header + first card)
    for th in ['earth', 'forest', 'sea', 'wind']:
        for name, hr in [('dawn', 6), ('day', 11), ('dusk', 17), ('night', 22)]:
            c, q = page(b, th, hr)
            q.screenshot(path=f'{OUT}/h_{th}_{name}.png', clip={'x': 0, 'y': 0, 'width': 412, 'height': 300})
            c.close()
    b.close()

# make a contact sheet of the 16 headers
from PIL import Image
ims = [[Image.open(f'{OUT}/h_{th}_{ph}.png') for ph in ['dawn', 'day', 'dusk', 'night']] for th in ['earth', 'forest', 'sea', 'wind']]
w, h = ims[0][0].size
sheet = Image.new('RGB', (w * 4 // 2, h * 4 // 2), 'white')
for r, row in enumerate(ims):
    for c, im in enumerate(row):
        sheet.paste(im.resize((w // 2, h // 2)), (c * w // 2, r * h // 2))
sheet.save(f'{OUT}/headers_all.png')
print('ok')

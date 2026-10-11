#!/usr/bin/env python3
"""Combines src/*.js and src/app.css into one self-contained public/kokoro.html."""
import os, re
R = os.path.dirname(os.path.abspath(__file__))
src = lambda f: open(os.path.join(R, 'src', f), encoding='utf-8').read()
js = '\n'.join(src(f) for f in ['data.js', 'scene.js', 'sync.js', 'remind.js', 'app.js', 'views.js'])
js = re.sub(r"^'use strict';\n", '', js, flags=re.M)
html = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#C9DFCB">
<meta name="color-scheme" content="light">
<title>Kokoro</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23C8452C'/%3E%3Ctext x='32' y='45' font-size='38' text-anchor='middle' fill='%23FFF6EC' font-family='serif'%3E%E5%BF%83%3C/text%3E%3C/svg%3E">
<style>
{src('app.css')}
</style>
</head>
<body>
<div id="banner" class="banner hidden" role="alert"></div>
<div id="app"></div>
<nav class="tabs" id="tabs" aria-label="Main"></nav>
<input type="file" id="file" accept="application/json,.json,text/plain" hidden>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>
'use strict';
(function(){{
{js}
start();
}})();
</script>
</body>
</html>
'''
os.makedirs(os.path.join(R, 'public'), exist_ok=True)
open(os.path.join(R, 'public', 'kokoro.html'), 'w', encoding='utf-8').write(html)
print('built public/kokoro.html', len(html), 'bytes')

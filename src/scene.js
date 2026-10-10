'use strict';
/* ===== scene.js — the misty-hills header, drawn once per theme and time of day ===== */
const THEMES = {
  earth: { sky: ['#EBC9A0', '#F7E9D4'], r: ['#E2B88E', '#CF946A', '#B0704C', '#7E4A33'], sun: '#C8452C', ac: '#B0532A', ac2: '#C99230', bg: '#F7F0E6', name: 'Earth' },
  forest: { sky: ['#C9DFCB', '#EFF4E7'], r: ['#AECBA8', '#84AC82', '#5C8C61', '#3B6948'], sun: '#FFFDF4', ac: '#3B7A4D', ac2: '#C6613A', bg: '#F2F4EC', name: 'Forest' },
  sea: { sky: ['#B8DCE8', '#EDF6F4'], r: ['#A3CEDC', '#74B2C8', '#4690B0', '#256A8C'], sun: '#FFFFFF', ac: '#1D7898', ac2: '#E0784E', bg: '#EEF4F4', name: 'Sea' },
  wind: { sky: ['#CFDBF0', '#F4F2F8'], r: ['#C3CEE6', '#A6B4D7', '#8894C2', '#6772A6'], sun: '#FFFFFF', ac: '#4569B3', ac2: '#D9A32E', bg: '#F1F2F7', name: 'Wind' }
};
const PHASES = {
  dawn: { sky: ['#EDB9AC', '#FAE3CF'], tint: '#F2B3A0', k: 0.22 },
  dusk: { sky: ['#D98A7E', '#F4C9A6'], tint: '#6A3E62', k: 0.42 },
  night: { sky: ['#16203D', '#34406A'], tint: '#111933', k: 0.66 }
};
function phaseOf(d) { const h = d.getHours(); if (h >= 5 && h < 8) return 'dawn'; if (h >= 8 && h < 16) return 'day'; if (h >= 16 && h < 19) return 'dusk'; return 'night'; }
function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function ridge(yBase, amp, seed, freq, W = 800, H = 440) {
  const r = rng(seed), p = [r() * 6, r() * 6];
  let d = `M0 ${H} L`;
  for (let x = 0; x <= W; x += 5) {
    const y = yBase - amp * (0.7 * Math.sin(x * freq + p[0]) + 0.3 * Math.sin(x * freq * 2.1 + p[1]));
    d += `${x} ${y.toFixed(1)} L`;
  }
  return d + `${W} ${H}Z`;
}
function mixHex(a, b, k) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = s => [(s >> 16) & 255, (s >> 8) & 255, s & 255];
  const A = ch(pa), B = ch(pb);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, '0')).join('');
}
const RIDGES = [[246, 26, .0085], [286, 22, .011], [326, 18, .014], [366, 14, .018]];
let SCENE_KEY = '', SCENE_URL = '';
function sceneURL(theme, phase, preview) {
  const key = theme + '|' + phase;
  if (!preview && key === SCENE_KEY) return SCENE_URL;
  const t = THEMES[theme], P = PHASES[phase];
  const sky = P ? P.sky : t.sky;
  const rc = t.r.map(c => P ? mixHex(c, P.tint, P.k) : c);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 440" preserveAspectRatio="xMidYMax slice">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient>` +
    `<linearGradient id="m" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="${phase === 'night' ? .12 : .35}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>` +
    `<rect width="800" height="440" fill="url(#g)"/>`;
  if (phase === 'night') {
    const r = rng(7);
    for (let i = 0; i < 46; i++) s += `<circle cx="${(r() * 800).toFixed(0)}" cy="${(110 + r() * 150).toFixed(0)}" r="${(0.6 + r() * 1.3).toFixed(1)}" fill="#fff" opacity="${(0.35 + r() * 0.55).toFixed(2)}"/>`;
    s += `<circle cx="430" cy="205" r="26" fill="#F4F1E4"/><circle cx="441" cy="198" r="24" fill="${sky[0]}"/>`;
  } else {
    const sun = phase === 'dusk' || phase === 'dawn' ? (theme === 'earth' ? t.sun : '#FFF4E4') : t.sun;
    s += `<circle cx="430" cy="205" r="30" fill="${sun}"/>`;
    s += `<path d="M486 258 q7 -5 14 0 q7 -5 14 0" stroke="#3B4654" stroke-width="2" fill="none" opacity=".45"/><path d="M520 244 q5 -4 10 0 q5 -4 10 0" stroke="#3B4654" stroke-width="2" fill="none" opacity=".4"/>`;
  }
  RIDGES.forEach((q, i) => {
    s += `<path d="${ridge(q[0], q[1], 11 + i * 7, q[2])}" fill="${rc[i]}"/>`;
    if (i < 3) s += `<rect x="0" y="${q[0] + 4}" width="800" height="44" fill="url(#m)"/>`;
  });
  s += '</svg>';
  const url = 'data:image/svg+xml,' + encodeURIComponent(s);
  if (!preview) { SCENE_KEY = key; SCENE_URL = url; }
  return url;
}

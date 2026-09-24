'use strict';
//  ============================================================
//  HUD LAYOUT — does anything on the phone's screen sit on anything else?
//  ============================================================
//  Lays the game out at a phone's size, upright and on its side, with the
//  phone's safe areas (the notch, the home bar) standing in for env(), which
//  a desktop browser leaves at zero. Then measures the HUD: text by its
//  glyphs (a line's box is wider than its words), round buttons as circles,
//  the compass by the part its mask leaves opaque (it fades out over its
//  outer 18% each side), the rest as boxes — and lists every pair that overlaps.
//
//    node lab/tools/hud_layout.js [game.html]      (default: index.html)
//    HUD_OUT=dir …   also saves a screenshot of each layout
//
//  The phone is an iPhone 14 (390 × 844 points; safe areas 47 at the notch,
//  34 / 21 at the home bar), which is what the first real-device test used.

const fs = require('fs');
const path = require('path');
const { openRoom, sleep, CACHE } = require('../test/harness/page.js');

const SRC = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'index.html'));
const OUT = process.env.HUD_OUT || null;
const LAYOUTS = [
  { name: 'portrait', viewport: { width: 390, height: 844 }, safe: { top: 47, bottom: 34, left: 0, right: 0 } },
  { name: 'landscape', viewport: { width: 844, height: 390 }, safe: { top: 0, bottom: 21, left: 47, right: 47 } },
];
//  what is on screen while playing on a phone; [selector, how to measure it]
const PARTS = [
  ['#net-status', 'text'], ['#net-list', 'text'], ['#compass', 'faded'], ['#m-help', 'text'], ['#meta > div:last-child', 'text'],
  ['#minimap', 'box'], ['#hp-label', 'text'], ['#hp-bar', 'box'], ['#kd', 'text'], ['#ammo', 'text'],
  ['#b-view', 'box'], ['#b-mode', 'box'], ['#gear', 'circle'],
  ['#stick', 'circle'], ['#jump', 'circle'], ['#fire', 'circle'], ['#cloak', 'circle'], ['#chatbtn', 'circle'],
  ['#scopebtn', 'circle'], ['#reloadbtn', 'circle'],
];

//  env(safe-area-inset-*) → a variable the tool can set
function phoneCopy() {
  const s = fs.readFileSync(SRC, 'utf8').replace(/env\(safe-area-inset-(top|bottom|left|right)\)/g, 'var(--safe-$1, 0px)');
  const f = path.join(CACHE, 'hud_layout.html');
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(f, s);
  return f;
}

function measure(parts) {
  const out = [];
  for (const [sel, how] of parts) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const cs = getComputedStyle(el);
    let hidden = false;
    for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e); if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity === 0) hidden = true; }
    if (hidden) continue;
    if (how === 'text') {
      const r = document.createRange(); r.selectNodeContents(el);
      for (const q of r.getClientRects()) if (q.width > 1 && q.height > 1) out.push({ sel, shape: 'box', x0: q.left, y0: q.top, x1: q.right, y1: q.bottom });
    } else {
      const q = el.getBoundingClientRect();
      if (q.width < 2 || q.height < 2) continue;
      if (how === 'circle' && cs.borderRadius.startsWith('50%')) out.push({ sel, shape: 'circle', cx: (q.left + q.right) / 2, cy: (q.top + q.bottom) / 2, r: q.width / 2 });
      else if (how === 'faded') { const t = q.width * 0.18; out.push({ sel, shape: 'box', x0: q.left + t, y0: q.top, x1: q.right - t, y1: q.bottom }); }
      else out.push({ sel, shape: 'box', x0: q.left, y0: q.top, x1: q.right, y1: q.bottom });
    }
  }
  return out;
}

//  how far two shapes overlap, in points (0: they do not)
function overlap(a, b) {
  const boxBox = (p, q) => Math.max(0, Math.min(Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0), Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0)));
  const circBox = (c, q) => { const nx = Math.max(q.x0, Math.min(c.cx, q.x1)), ny = Math.max(q.y0, Math.min(c.cy, q.y1)); return Math.max(0, c.r - Math.hypot(c.cx - nx, c.cy - ny)); };
  if (a.shape === 'box' && b.shape === 'box') return boxBox(a, b);
  if (a.shape === 'circle' && b.shape === 'circle') return Math.max(0, a.r + b.r - Math.hypot(a.cx - b.cx, a.cy - b.cy));
  return a.shape === 'circle' ? circBox(a, b) : circBox(b, a);
}

(async () => {
  process.env.LAB_GAME = phoneCopy();
  const room = await openRoom();
  let total = 0;
  try {
    for (const L of LAYOUTS) {
      const P = await room.player({ room: 'hud-' + L.name, nick: '旅人-3ph', viewport: L.viewport, render: !!OUT });
      await P.eval((s) => { for (const k in s) document.documentElement.style.setProperty('--safe-' + k, s[k] + 'px'); }, L.safe);
      await P.join();
      //  no fading in: measure what is there once it is all shown
      await P.eval(() => { for (const id of ['hud', 'touch']) document.getElementById(id).style.transition = 'none'; });
      await P.eval(() => window.__t.ev("mode = 'mobile'; applyMode(); 1"));
      await P.page.waitForFunction(() => document.querySelector('#hud.live') && document.querySelector('#touch.live'), null, { timeout: 60000 });
      await sleep(500);
      const shapes = await P.eval(measure, PARTS);
      const hits = [];
      for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++) {
        if (shapes[i].sel === shapes[j].sel) continue;
        const d = overlap(shapes[i], shapes[j]);
        if (d > 0.5) hits.push([shapes[i].sel, shapes[j].sel, d]);
      }
      //  one line per pair, the deepest overlap of any of their pieces
      const worst = new Map();
      for (const [a, b, d] of hits) { const k = a + '  ×  ' + b; worst.set(k, Math.max(worst.get(k) || 0, d)); }
      console.log('\n' + L.name + ' ' + L.viewport.width + '×' + L.viewport.height + ' (safe ' + JSON.stringify(L.safe) + ')');
      if (!worst.size) console.log('  nothing overlaps');
      for (const [k, d] of worst) console.log('  ' + k.padEnd(44) + d.toFixed(0) + ' pt');
      total += worst.size;
      if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await P.page.screenshot({ path: path.join(OUT, 'hud-' + L.name + '.png') }); }
      const errs = P.errors.slice(); await P.close();
      if (errs.length) console.log('  page errors: ' + errs.slice(0, 3).join(' | '));
    }
  } finally { await room.close(); }
  console.log('\n' + total + ' overlapping pair' + (total === 1 ? '' : 's') + '\n');
})().catch((e) => { console.error(e); process.exit(2); });

'use strict';
//  ============================================================
//  lab/tools/gor_trace.js — what the demogorgons do, to the last digit
//  ============================================================
//  As lab/tools/dog_trace.js, for the other side's tall ones: updateGorgons
//  run alone on the other side for a stretch of simulated time, Math.random
//  seeded and the clock stepped by hand inside one synchronous call, and a
//  fingerprint of every gorgon's state along the way. Two copies of the game
//  that fingerprint the same run them the same.
//
//    node lab/tools/gor_trace.js                   this index.html
//    LAB_GAME=/path/to/old.html node lab/tools/gor_trace.js
//    ... --out file.json                           and every sample, for a diff
//
//  The scene: a player standing still (then moving on), one gorgon set on
//  them from 25 m — it chases, goes round, swings; shot from across the street
//  (it breaks off to flank), hit hard mid-swing, driven into its rage, killed;
//  one sworn to a flayer and one to VECNA (props: positions only), a shot the
//  whole district hears.

const fs = require('fs');
const { openRoom } = require('../test/harness/page.js');

const SCENE = `(() => {
  let a = 0x6d2b79f5;
  const rnd = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const R = Math.random, gwd = camera.getWorldDirection, nt = notify;
  Math.random = rnd; camera.getWorldDirection = (v) => v.set(0, 0, -1); notify = () => {};
  const out = [];
  try {
    clearGorgons(); gorsOn = false; gorFrame = 0; gorHitCd = 0; gorBind = 0;
    if (typeof GORS === 'object') GORS.spawnCd = 0; else gorSpawnCd = 0;          // (shared/gorgons.js, or before it)
    wState = WS.BACK; buildWrecks();
    cityT = 2000; p.set(4, EYE, 6); yaw = 0.3; dead = false; cloak = 0;
    const F = flayers[0] || (flayers[0] = { slot: 0 });
    Object.assign(F, { slot: 0, live: true, dead: false, x: 60, z: 30, y: 0, hd: 1.2, sp: 1.1 });
    Object.assign(vec, { live: true, dead: false, awake: true, x: -70, z: -40, y: 0, hd: -0.4, sp: 0.8 });
    const near = (x, z, r, k) => { for (let q = 0; q < 24; q++) { const a2 = k * 1.1 + q * 0.26, sx = x + Math.sin(a2) * r, sz = z + Math.cos(a2) * r; if (clearAt(sx, sz, 1.6)) return [sx, sz]; } return [x, z]; };
    const put = (g, s, fx, fz) => { g.x = g.rx = s[0]; g.z = g.rz = s[1]; g.y = supportHeight(s[0], s[1], 1); g.hd = Math.atan2(fx - s[0], fz - s[1]); };
    const DT = 1 / 30;
    let g0 = null;
    for (let i = 0; i < 2400; i++) {
      cityT += DT; hp = HP_MAX; dead = false;
      if (i === 150) {
        const up = gorgons.filter((g) => g.live && !g.dead);
        g0 = up[0];
        if (g0) { put(g0, near(p.x, p.z, 25, 0), p.x, p.z); g0.st = 'wander'; g0.stT = 0; g0.atkCd = 0; }
        if (up[1]) { up[1].lord = 'mf'; up[1].lordSlot = 0; put(up[1], near(F.x, F.z, 14, 1), F.x, F.z); }
        if (up[2]) { up[2].lord = 'vec'; up[2].lordSlot = -1; put(up[2], near(vec.x, vec.z, 34, 2), vec.x, vec.z); }
      }
      if (g0 && i === 330) hurtGorgon(g0, 20, g0.x + 30, g0.z);             // from across the street: it goes round
      if (g0 && i === 480) hurtGorgon(g0, 80, p.x, p.z);                    // a heavy hit: any swing is broken
      if (g0 && i === 600) { while (g0.hp > 420 * 0.3 + 1) g0.hp -= 20; hurtGorgon(g0, 20, p.x, p.z); }   // into its rage
      if (i === 900) dogNoise(p.x, p.z, 1.0, 'shot');
      if (g0 && i === 1100) { while (!g0.dead) hurtGorgon(g0, 20, p.x, p.z); }
      if (i === 1300) p.set(40, EYE, 6);
      updateGorgons(DT);
      if (i % 15 === 14) out.push(gorgons.map((g) => g.live ? [g.slot, +g.x.toFixed(4), +g.z.toFixed(4), +g.y.toFixed(3), Math.round(g.hp * 100) / 100, g.st, g.enraged ? 1 : 0, g.atk ? g.atk.kind : 0, g.lord || 0, g.dead ? 1 : 0] : 0));
    }
  } finally { Math.random = R; camera.getWorldDirection = gwd; notify = nt; }
  return JSON.stringify(out);
})()`;

(async () => {
  const room = await openRoom();
  try {
    const A = await room.player({ room: 'gtrace', nick: 'T' });
    await A.join();
    await new Promise((r) => setTimeout(r, 2500));
    await A.eval(() => { window.__t.noRender(); });
    const s = await A.eval((src) => window.__t.ev(src), SCENE);
    const samples = JSON.parse(s);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    const seen = {}, kinds = {};
    for (const smp of samples) for (const g of smp.filter(Boolean)) { seen[g[5]] = (seen[g[5]] || 0) + 1; if (g[7]) kinds[g[7]] = 1; }
    console.log('states seen ' + JSON.stringify(seen) + '; swings ' + Object.keys(kinds).join(','));
    console.log('fingerprint ' + h.toString(16) + ' (' + samples.length + ' samples, ' + s.length + ' bytes)');
    const i = process.argv.indexOf('--out');
    if (i > 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify(samples));
    if (A.errors.length) console.log('page errors: ' + A.errors.slice(0, 3).join(' | '));
  } finally {
    await room.close();
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });

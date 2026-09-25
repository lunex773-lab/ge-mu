'use strict';
//  ============================================================
//  lab/tools/dog_trace.js — what the dogs do, to the last digit
//  ============================================================
//  Runs the game's dogs (updateDogs, alone on the other side) for a stretch
//  of simulated time with Math.random seeded and the clock stepped by hand,
//  inside one synchronous call — so nothing else in the page can get in
//  between — and prints a fingerprint of every dog's state along the way.
//  Two copies of the game that fingerprint the same run the dogs the same:
//  moving their code (shared/dogs.js) must not change a single step.
//
//    node lab/tools/dog_trace.js                   this index.html
//    LAB_GAME=/path/to/old.html node lab/tools/dog_trace.js
//    ... --out file.json                           and every sample, for a diff
//
//  The scene: a player standing still at a crossing, who fires once (every
//  dog in the district hears it), wounds one dog and kills another; a flayer
//  and VECNA standing about (props: their positions only) with a few dogs
//  sworn to each, and a gorgon the others keep clear of.

const fs = require('fs');
const { openRoom } = require('../test/harness/page.js');

const SCENE = `(() => {
  let a = 0x2545F491;
  const rnd = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const R = Math.random, gwd = camera.getWorldDirection;
  Math.random = rnd; camera.getWorldDirection = (v) => v.set(0, 0, -1);
  const out = [];
  try {
    clearDogs(); dogsOn = false; dogAiFrame = 0; dogHitCd = 0; dogNoiseAcc = 0;
    if (typeof DOGS === 'object') { DOGS.spawnCd = 0; DOGS.repack = 0; DOGS.roles = 0; }      // (shared/dogs.js)
    else { dogSpawnCd = 0; dogRepack = 0; dogRoles = 0; dogStepAcc = 0; }                      // (before it)
    wState = WS.BACK; buildWrecks();
    cityT = 1000; p.set(4, EYE, 6); _dogPX = p.x; _dogPZ = p.z; dead = false; cloak = 0;
    //  the props
    const F = flayers[0] || (flayers[0] = { slot: 0 });
    Object.assign(F, { slot: 0, live: true, dead: false, x: 60, z: 30, y: 0, hd: 1.2, sp: 1.1 });
    Object.assign(vec, { live: true, dead: false, awake: true, x: -70, z: -40, y: 0, hd: -0.4, sp: 0.8 });
    const G = gorgons[0] || (gorgons[0] = { slot: 0 });
    Object.assign(G, { slot: 0, live: true, dead: false, x: 20, z: -18, y: 0, lord: null, lordSlot: -1 });
    const DT = 1 / 30;
    //  a clear spot r m from (x, z), the k-th way round
    const near = (x, z, r, k) => { for (let q = 0; q < 24; q++) { const a = k * 1.1 + q * 0.26, sx = x + Math.sin(a) * r, sz = z + Math.cos(a) * r; if (clearAt(sx, sz, 1.2)) return [sx, sz]; } return [x, z]; };
    const put = (d, s, fx, fz) => { d.x = d.rx = s[0]; d.z = d.rz = s[1]; d.y = supportHeight(s[0], s[1], 1); d.hd = Math.atan2(fx - s[0], fz - s[1]); };
    for (let i = 0; i < 1350; i++) {
      cityT += DT; hp = HP_MAX;
      //  three sworn to the flayer and three to VECNA, beside them; six more around the player, facing in
      if (i === 90) { let n = 0; for (const d of dogs) if (d.live && !d.dead && n < 12) {
        if (n < 3) { d.lord = 'mf'; d.lordSlot = 0; put(d, near(F.x, F.z, 12, n), F.x, F.z); }
        else if (n < 6) { d.lord = 'vec'; d.lordSlot = -1; put(d, near(vec.x, vec.z, 34, n), vec.x, vec.z); }
        else put(d, near(p.x, p.z, 9 + (n % 3) * 2.5, n), p.x, p.z);
        n++; } }
      if (i === 150) dogNoise(p.x, p.z, 1.0, 'shot');
      if (i === 240 || i === 330) {
        let best = null, bd = 1e9;
        for (const d of dogs) { if (!d.live || d.dead) continue; const q = Math.hypot(d.x - p.x, d.z - p.z); if (q < bd) { bd = q; best = d; } }
        if (best) { if (i === 240) hurtDog(best, 20, p.x, p.z); else killDog(best); }
      }
      if (i === 600) p.set(40, EYE, 6);
      updateDogs(DT);
      if (i % 45 === 44) out.push(dogs.map((d) => d.live ? [d.slot, +d.x.toFixed(4), +d.z.toFixed(4), +d.y.toFixed(3), Math.round(d.hp * 100) / 100, d.st, d.pack, d.role, d.lord || 0, d.dead ? 1 : 0] : 0));
    }
  } finally { Math.random = R; camera.getWorldDirection = gwd; }
  return JSON.stringify(out);
})()`;

(async () => {
  const room = await openRoom();
  try {
    const A = await room.player({ room: 'trace', nick: 'T' });
    await A.join();
    await new Promise((r) => setTimeout(r, 2500));
    await A.eval(() => { window.__t.noRender(); });
    const s = await A.eval((src) => window.__t.ev(src), SCENE);
    const samples = JSON.parse(s);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    const last = samples[samples.length - 1].filter(Boolean);
    const st = {}; for (const d of last) st[d[5]] = (st[d[5]] || 0) + 1;
    console.log('dogs up at the end ' + last.length + ', states ' + JSON.stringify(st));
    console.log('fingerprint ' + h.toString(16) + ' (' + samples.length + ' samples, ' + s.length + ' bytes)');
    const i = process.argv.indexOf('--out');
    if (i > 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify(samples));
    if (A.errors.length) console.log('page errors: ' + A.errors.slice(0, 3).join(' | '));
  } finally {
    await room.close();
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });

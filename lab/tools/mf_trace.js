'use strict';
//  ============================================================
//  lab/tools/mf_trace.js — what the mind flayer does, to the last digit
//  ============================================================
//  As lab/tools/gor_trace.js, for the commander: updateFlayers run alone on
//  the other side for a stretch of simulated time, Math.random seeded and the
//  clock stepped by hand inside one synchronous call, and a fingerprint of
//  every flayer's state along the way — and of what it does to the world: the
//  player's health and where it knocks them, the wrecks it throws, the escort
//  it calls and commands. Two copies of the game that fingerprint the same run
//  it the same.
//
//    node lab/tools/mf_trace.js                    this index.html
//    LAB_GAME=/path/to/old.html node lab/tools/mf_trace.js
//    ... --out file.json                           and every sample, for a diff
//
//  The scene: one arrives (and calls its escort); it is set on a player
//  standing still from 42 m — it roars, closes, throws, swings, stamps, sweeps
//  and lashes; the player walks off into throwing range and cloaks for a
//  while; it is shot from far out of its sight (it sends everything); linked
//  minions are hurt (it bleeds); it is driven under a third (it calls all it
//  may, and walks off); VECNA takes it (props: a position), then falls; it is
//  killed, lies there, is cleared, and the next one arrives.

const fs = require('fs');
const { openRoom } = require('../test/harness/page.js');

const SCENE = `(() => {
  let a = 0x51ed27ab;
  const rnd = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const R = Math.random, gwd = camera.getWorldDirection, nt = notify;
  Math.random = rnd; camera.getWorldDirection = (v) => v.set(0, 0, -1); notify = () => {};
  const out = [];
  const S = typeof MFS === 'object' ? MFS : null;                     // (shared/flayers.js, or before it)
  const setCd = (v) => { if (S) S.spawnCd = v; else mfSpawnCd = v; };
  const thrown = () => (S ? S.thrown : mfThrown);
  try {
    clearFlayers(); mfOn = false; mfFrame = 0; if (S) S.thrown = null; else mfThrown = null;
    clearDogs(); clearGorgons();
    wState = WS.BACK; buildWrecks();
    Object.assign(vec, { live: false, dead: false, awake: false });
    cityT = 3000; p.set(4, EYE, 6); yaw = 0.3; dead = false; cloak = 0; hp = HP_MAX; camShake = 0;
    setCd(0);
    const near = (x, z, r, k) => { for (let q = 0; q < 24; q++) { const a2 = k * 1.1 + q * 0.26, sx = x + Math.sin(a2) * r, sz = z + Math.cos(a2) * r; if (clearAt(sx, sz, 2.5)) return [sx, sz]; } return [x, z]; };
    const DT = 1 / 30;
    let F0 = null, dmg = 0;
    const r4 = (v) => Math.round(v * 1e4) / 1e4, r2 = (v) => Math.round(v * 100) / 100;
    for (let i = 0; i < 3900; i++) {
      cityT += DT;
      if (i === 90) {
        F0 = flayers.find((m) => m.live && !m.dead);
        if (F0) {
          const s = near(p.x, p.z, 42, 0);
          F0.x = F0.rx = s[0]; F0.z = F0.rz = s[1]; F0.y = supportHeight(s[0], s[1], 1); F0.hd = Math.atan2(p.x - s[0], p.z - s[1]);
          F0.st = 'wander'; F0.stT = 0; F0.atkCd = 0; F0.summonT = 200;
        }
        setCd(1e9);
      }
      //  (in front of it, r out, somewhere a player could stand)
      const front = (r) => { for (let q = 0; q < 30; q++) { const a2 = F0.hd + (q % 2 ? 1 : -1) * Math.floor((q + 1) / 2) * 0.12, sx = F0.x + Math.sin(a2) * r, sz = F0.z + Math.cos(a2) * r; if (clearAt(sx, sz, 1.0)) return [sx, sz]; } return [F0.x + Math.sin(F0.hd) * r, F0.z + Math.cos(F0.hd) * r]; };
      if (F0 && i === 760) { const s = front(23); p.set(s[0], EYE, s[1]); }
      if (F0 && i === 880) { const s = front(13.5); p.set(s[0], EYE, s[1]); }
      if (F0 && i === 1020) { const s = front(12); p.set(s[0], EYE, s[1]); }
      if (F0 && i === 1150) { const s = near(F0.x, F0.z, 58, 3); p.set(s[0], EYE, s[1]); }
      if (i === 1270) cloak = 5;
      if (i === 1350) cloak = 0;
      if (F0 && i === 1450) hurtFlayer(F0, 20, F0.x + 150, F0.z + 20);        // from far out of its sight
      if (F0 && i === 1550) for (let q = 0; q < 6; q++) mfShareDamage(F0.x + 10, F0.z - 6, 20);
      if (F0 && i === 1700) { if (F0.atk && F0.atk.kind !== 'throw') { F0.atk = null; F0.st = 'track'; } F0.hp = Math.min(F0.hp, 4200 * 0.3 + 5); hurtFlayer(F0, 20, p.x, p.z); }
      if (F0 && i === 2250) { Object.assign(vec, { live: true, dead: false, awake: true, x: F0.x + 30, z: F0.z - 20, y: 0, hd: 0.5, sp: 0.6 }); F0.lord = 'vec'; F0.lordSlot = -1; }
      if (i === 2450) vec.dead = true;
      if (F0 && i === 2550) { while (!F0.dead) hurtFlayer(F0, 400, p.x, p.z); }
      if (i === 3250) setCd(0);
      if (i === 3300) {                                                     // and the next one, set on them from close by
        F0 = flayers.find((m) => m.live && !m.dead);
        if (F0) { const s = near(p.x, p.z, 14, 5); F0.x = F0.rx = s[0]; F0.z = F0.rz = s[1]; F0.y = supportHeight(s[0], s[1], 1); F0.hd = Math.atan2(p.x - s[0], p.z - s[1]); F0.atkCd = 0; F0.summonT = 200; }
        setCd(1e9);
      }
      if (F0 && !F0.dead && (i === 3500 || i === 3700)) {                   // (a swipe, whatever the dice say)
        const s = front(10); p.set(s[0], EYE, s[1]);
        if (!F0.atk) { if (S) FL.startAtk(S, F0, 'swipe'); else mfStartAtk(F0, 'swipe'); }
      }
      updateFlayers(DT);
      dmg += HP_MAX - hp; hp = HP_MAX; dead = false;
      if (i % 15 === 14) {
        const T = thrown();
        let wsum = 0; for (const w of wrecks) if (w) wsum += w.x * 3 + w.z * 7 + w.y * 11 + (w.thrown ? 13 : 0);
        out.push([
          flayers.map((m) => m.live ? [m.slot, r4(m.x), r4(m.z), r4(m.y), r4(m.hd), r2(m.hp), m.st, m.atk ? m.atk.kind + m.atk.leg : 0, m.panicked ? 1 : 0, m.dead ? 1 : 0,
            m.lord || 0, m.hasT ? 1 : 0, r2(m.tx), r2(m.tz), r2(m.summonT), r4(m.taint || 0), r4(m.maw), r4(m.headYaw), r4(m.rear), r4(m.swell), r4(m.stagger), r4(m.gaitPh)] : 0),
          r4(p.x), r4(p.z), Math.round(dmg), r4(camShake), T ? [T.k, r2(T.x), r2(T.y), r2(T.z)] : 0, r2(wsum),
          dogs.filter((d) => d.live).map((d) => [d.slot, d.lord || 0, d.lordSlot, d.st, d.hasT ? 1 : 0, r2(d.tx), r2(d.tz)]),
          gorgons.filter((g) => g.live).map((g) => [g.slot, g.lord || 0, g.lordSlot, g.st, g.hasT ? 1 : 0, r2(g.tx), r2(g.tz)]),
        ]);
        camShake = 0;
      }
    }
  } finally { Math.random = R; camera.getWorldDirection = gwd; notify = nt; }
  return JSON.stringify(out);
})()`;

(async () => {
  const room = await openRoom();
  try {
    const A = await room.player({ room: 'mftrace', nick: 'T' });
    await A.join();
    await new Promise((r) => setTimeout(r, 2500));
    await A.eval(() => { window.__t.noRender(); });
    const s = await A.eval((src) => window.__t.ev(src), SCENE);
    const samples = JSON.parse(s);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    const seen = {}, kinds = {};
    let summoned = 0;
    for (const smp of samples) {
      for (const m of smp[0].filter(Boolean)) { seen[m[6]] = (seen[m[6]] || 0) + 1; if (m[7]) kinds[String(m[7]).replace(/\d/g, '')] = 1; }
      summoned = Math.max(summoned, smp[7].length + smp[8].length);
    }
    console.log('states seen ' + JSON.stringify(seen) + '; attacks ' + Object.keys(kinds).join(',') + '; most minions ' + summoned +
      '; damage taken ' + samples[samples.length - 1][3]);
    console.log('fingerprint ' + h.toString(16) + ' (' + samples.length + ' samples, ' + s.length + ' bytes)');
    const i = process.argv.indexOf('--out');
    if (i > 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify(samples));
    if (A.errors.length) console.log('page errors: ' + A.errors.slice(0, 3).join(' | '));
  } finally {
    await room.close();
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });

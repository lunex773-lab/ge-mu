'use strict';
//  ============================================================
//  lab/tools/vec_trace.js — what VECNA does, to the last digit
//  ============================================================
//  As lab/tools/mf_trace.js, for the king: updateVecna run alone on the
//  other side for a stretch of simulated time (and his grip on the player,
//  updatePsyHold, while he has one), Math.random seeded and the clock
//  stepped by hand inside one synchronous call, and a fingerprint of him and
//  of what he does to the world: the player's health and where he throws
//  them, the street he lifts, circles and hurls, the court he claims,
//  commands, summons and carries, the psychic pressure and what his mind does
//  to the player's eyes. Two copies of the game that fingerprint the same run
//  him the same.
//
//    node lab/tools/vec_trace.js                   this index.html
//    LAB_GAME=/path/to/old.html node lab/tools/vec_trace.js
//    ... --out file.json                           and every sample, for a diff
//
//  The scene: he arrives far off; he is set down 70 m from a player standing
//  still, with a court about him (dogs, a gorgon, a flayer: props he commands);
//  he wakes, watches, lifts the street, commands, and walks in; the player
//  closes (his arm), backs off (the street is thrown at them); he is cut
//  through every phase (each turning over with the world bent round him;
//  from the second his mind reaches for you); shot from far off he is simply
//  behind you, his court with him; he dies, lies there, is cleared, and
//  comes again.

const fs = require('fs');
const { openRoom } = require('../test/harness/page.js');

const SCENE = `(() => {
  let a = 0x3b9d4e1f;
  const rnd = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const R = Math.random, gwd = camera.getWorldDirection, nt = notify;
  Math.random = rnd; camera.getWorldDirection = (v) => v.set(0, 0, -1); notify = () => {};
  const out = [];
  const S = typeof VS === 'object' ? VS : null;                        // (shared/vecna.js, or before it)
  const setCd = (v) => { if (S) S.spawnCd = v; else vecSpawnCd = v; };
  const flying = () => (S ? S.thrown : vecThrown);
  const r4 = (v) => Math.round(v * 1e4) / 1e4, r2 = (v) => Math.round(v * 100) / 100;
  try {
    clearVecna(); vecOn = false; vecFrame = 0; flying().length = 0;
    clearFlayers(); clearDogs(); clearGorgons();
    wState = WS.BACK; buildWrecks();
    cityT = 4000; p.set(4, EYE, 6); yaw = 0.3; dead = false; cloak = 0; hp = HP_MAX; camShake = 0; vy = 0;
    psyLevelWant = 0; psyEchoT = 0; psyLevel = 0; if (typeof psyWarpT !== 'undefined') psyWarpT = 0;
    setCd(0);
    const near = (x, z, r, k, c) => { for (let q = 0; q < 30; q++) { const a2 = k * 1.1 + q * 0.26, sx = x + Math.sin(a2) * r, sz = z + Math.cos(a2) * r; if (clearAt(sx, sz, c || 2.5)) return [sx, sz]; } return [x, z]; };
    const DT = 1 / 30;
    let dmg = 0;
    const cut = (f) => { while (vec.hp > V_HP * f) vec.hp -= 50; hurtVecna(20, p.x, p.z); };
    for (let i = 0; i < 3900; i++) {
      cityT += DT;
      if (i === 60 && vec.live) {
        //  set down 70 m off, facing the player, a court about him
        const s = near(p.x, p.z, 70, 0, 3);
        vec.x = vec.rx = s[0]; vec.z = vec.rz = s[1]; vec.y = supportHeight(s[0], s[1], 1); vec.hd = Math.atan2(p.x - s[0], p.z - s[1]);
        setCd(1e9);
        for (let q = 0; q < 3; q++) { const d = DG.spawnDog(DOGS); if (d) { const t = near(vec.x, vec.z, 40 + q * 6, q + 2, 1.2); d.x = d.rx = t[0]; d.z = d.rz = t[1]; d.st = 'wander'; } }
        { const t = near(vec.x, vec.z, 55, 7, 1.4); GR.spawnGorgon(GORS, { x: t[0], z: t[1] }); }
        { const t = near(vec.x, vec.z, 80, 9, 2.5); const m = spawnFlayer({ x: t[0], z: t[1] }); if (m) { m.escorted = true; m.summonT = 999; } }
      }
      if (i === 900) { const s = near(vec.x, vec.z, 8, 4, 1.2); p.set(s[0], EYE, s[1]); }
      if (i === 1150) cut(0.80);
      if (i === 1300) { const s = near(vec.x, vec.z, 24, 5, 1.2); p.set(s[0], EYE, s[1]); }
      if (i === 1500) cut(0.58);
      if (i === 2000) { vec.blinkCd = 0; hurtVecna(20, vec.x + 120, vec.z + 30); }
      if (i === 2150) { const s = near(vec.x, vec.z, 20, 6, 1.2); p.set(s[0], EYE, s[1]); }
      if (i === 2300) cut(0.39);
      if (i === 2550) cut(0.17);
      if (i === 2800) { while (!vec.dead) hurtVecna(400, p.x, p.z); }
      if (i === 3650) setCd(0);
      if (typeof psyHold !== 'undefined' && psyHold) updatePsyHold(DT);     // (the grip, before his mind replaced it)
      else { p.y = supportHeight(p.x, p.z, 1) + EYE; vy = 0; }
      updateVecna(DT);
      dmg += HP_MAX - hp; hp = HP_MAX; dead = false;
      if (i % 15 === 14) {
        let wsum = 0; for (const w of wrecks) if (w) wsum += w.x * 3 + w.z * 7 + w.y * 11 + (w.thrown ? 13 : 0) + (w.held ? 17 : 0);
        const v = vec;
        out.push([
          v.live ? [r4(v.x), r4(v.z), r4(v.y), r4(v.hd), r2(v.hp), v.st, v.phase, v.awake ? 1 : 0, v.dead ? 1 : 0, v.atk ? v.atk.kind + v.atk.side + ':' + r2(v.atk.t) : 0,
            (v.orbit || []).map((o) => [o.k, r4(o.a), r2(o.r), r2(o.h), r4(o.rise), r4(o.roll)]), r2(v.tx), r2(v.tz), v.hasT ? 1 : 0, r4(v.vuln), r4(v.stagger),
            r4(v.hover), r4(v.flare), r4(v.arch), r4(v.armUp[0]), r4(v.armUp[1]), r4(v.armExt[0]), r4(v.armExt[1]), r4(v.grip), r4(v.spread), r4(v.maw),
            r4(v.headYaw), r4(v.headPitch), r4(v.lean), r4(v.gaitPh), r2(v.blinkCd), r2(v.summonCd), r2(v.cmdT), r2(v.mentalT), r2(v.atkCd)] : 0,
          r4(p.x), r4(p.z), r4(p.y), Math.round(dmg), r4(camShake), r4(psyLevelWant), r4(psyEchoT),
          typeof psyHold !== 'undefined' ? (psyHold ? psyHold.ph : 0) : r2(psyWarpT),
          flying().map((T) => [T.k, r2(T.x), r2(T.y), r2(T.z)]), r2(wsum),
          dogs.filter((d) => d.live).map((d) => [d.slot, d.lord || 0, d.st, d.hasT ? 1 : 0, r2(d.tx), r2(d.tz), r2(d.x), r2(d.z)]),
          gorgons.filter((g) => g.live).map((g) => [g.slot, g.lord || 0, g.st, g.hasT ? 1 : 0, r2(g.tx), r2(g.tz), r2(g.x), r2(g.z)]),
          flayers.filter((m) => m.live).map((m) => [m.slot, m.lord || 0, m.st, m.hasT ? 1 : 0, m.panicked ? 1 : 0, r2(m.tx), r2(m.tz)]),
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
    const A = await room.player({ room: 'vectrace', nick: 'T' });
    await A.join();
    await new Promise((r) => setTimeout(r, 2500));
    await A.eval(() => { window.__t.noRender(); });
    const s = await A.eval((src) => window.__t.ev(src), SCENE);
    const samples = JSON.parse(s);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    const seen = {}, kinds = {}, grips = {};
    let orbit = 0, court = 0;
    for (const smp of samples) {
      const v = smp[0];
      if (v) { seen[v[5]] = (seen[v[5]] || 0) + 1; if (v[9]) kinds[String(v[9]).replace(/[\d:.]/g, '')] = 1; orbit = Math.max(orbit, v[10].length); }
      if (smp[8]) grips[typeof smp[8] === 'number' ? 'bent' : smp[8]] = 1;
      court = Math.max(court, smp[11].filter((d) => d[1] === 'vec').length + smp[12].filter((g) => g[1] === 'vec').length);
    }
    console.log('states seen ' + JSON.stringify(seen) + '; attacks ' + Object.keys(kinds).join(',') + '; most in orbit ' + orbit + '; his court ' + court +
      '; the grip / his mind ' + (Object.keys(grips).join(',') || '-') + '; damage taken ' + samples[samples.length - 1][4]);
    console.log('fingerprint ' + h.toString(16) + ' (' + samples.length + ' samples, ' + s.length + ' bytes)');
    const i = process.argv.indexOf('--out');
    if (i > 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify(samples));
    if (A.errors.length) console.log('page errors: ' + A.errors.slice(0, 3).join(' | '));
  } finally {
    await room.close();
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });

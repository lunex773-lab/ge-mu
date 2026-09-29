'use strict';
//  ============================================================
//  SYNC PROBE — do two screens show the other side as the room has it?
//  ============================================================
//  Two real games in one room (the harness's room server, the room's real
//  code), both over on the other side a few metres apart, the dogs and the
//  gorgons (and, with --all, the flayer and VECNA) hunting them. Ten times a
//  second it reads, at the same moment, where the room has each creature and
//  where each screen draws it, and what each is doing; at the end:
//
//    - how far each screen is from the room (mean / 95th / most), and from each other
//    - how far behind the room each screen is (the delay that best explains
//      what it draws), and what is left over once that is taken out — the
//      part that is not lateness but a different story
//    - how often a screen shows a different state, or no swing while the
//      room's gorgon is swinging
//
//    node lab/tools/sync_probe.js [--secs 20] [--lagA 0] [--lagB 0] [--jitter 0] [--all]
//
//  --lagA / --lagB: that player's link, each way, in ms; --jitter: up to this
//  much more, at random (in order, as a WebSocket).

const { openRoom, sleep } = require('../test/harness/page.js');
const GOR = require('../../shared/gorgons.js');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? +process.argv[i + 1] : d; };
const SECS = arg('secs', 20), LAGA = arg('lagA', 0), LAGB = arg('lagB', 0), JIT = arg('jitter', 0);
const ALL = process.argv.includes('--all');
const ev = (P, src) => P.eval((s) => window.__t.ev(s), src);
async function until(P, src, secs) {
  for (let i = 0; i < secs * 10; i++) { if (await ev(P, src)) return true; await sleep(100); }
  return false;
}
const STAND = (x, z) => `(() => { carHitCd = 1e9; for (let r = 0; r < 60; r += 2) for (let k = 0; k < 12; k++) { const sx = ${x} + Math.sin(k * 0.52) * r, sz = ${z} + Math.cos(k * 0.52) * r;
  if (clearAt(sx, sz, 3)) { p.set(sx, EYE, sz); vy = 0; publishState(true); return JSON.stringify([sx, sz]); } } return null; })()`;
//  what a screen draws: [kind, slot, x, z, state, swinging]
const SEEN = `JSON.stringify([].concat(
  dogs.filter((d) => d.live && !d.dead).map((d) => ['d', d.slot, +d.x.toFixed(2), +d.z.toFixed(2), d.st, d.st === 'attack' ? 1 : 0]),
  gorgons.filter((g) => g.live && !g.dead).map((g) => ['g', g.slot, +g.x.toFixed(2), +g.z.toFixed(2), g.st, g.atk ? 1 : 0]),
  flayers.filter((m) => m.live && !m.dead).map((m) => ['m', m.slot, +m.x.toFixed(2), +m.z.toFixed(2), m.st, m.atk ? 1 : 0]),
  vec.live && !vec.dead ? [['v', 0, +vec.x.toFixed(2), +vec.z.toFixed(2), vec.st, vec.atk ? 1 : 0]] : []))`;

function q(a, f) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * f))]; }
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

(async () => {
  const room = await openRoom({ creatures: true });
  try {
    const A = await room.player({ room: 'sync', nick: 'Aki' });
    const B = await room.player({ room: 'sync', nick: 'Ben' });
    A.setLag(LAGA, JIT); B.setLag(LAGB, JIT);
    await A.join(); await sleep(2000);
    await ev(A, `window.__t.noRender(); ${ALL ? '' : 'MFS.holdSpawn = true; MFS.spawnCd = 1e9; VS.holdSpawn = true;'} 1`);
    await ev(A, 'setWorld(WS.BACK); 1');
    const at = JSON.parse(await ev(A, STAND(11, 10)));
    await until(A, 'dogs.filter((d) => d.live).length >= 30', 40);
    await B.join();
    await until(A, 'MP.srvOwns.d', 15); await until(B, 'MP.srvOwns.d', 15);
    await ev(B, 'window.__t.noRender(); setWorld(WS.BACK); 1');
    JSON.parse(await ev(B, STAND(at[0] + 5, at[1])));
    const R = room.rooms.get('sync').relay, RD = R.creatures.dogs;
    if (!ALL) { RD.M.holdSpawn = true; RD.M.spawnCd = 1e9; RD.V.holdSpawn = true; }
    for (let i = 0; i < 3; i++) GOR.spawnGorgon(RD.G, { x: at[0] + 40 + i * 8, z: at[1] + 20 });
    //  --near: the flayer and VECNA put down close, awake (to see their swings on both screens)
    if (process.argv.includes('--near')) {
      const FL = require('../../shared/flayers.js'), VC = require('../../shared/vecna.js');
      if (!RD.M.flayers.some((m) => m.live)) FL.spawnFlayer(RD.M, { x: at[0] + 45, z: at[1] - 30 });
      if (!RD.V.vec.live) VC.spawnVecna(RD.V, { x: at[0] - 40, z: at[1] + 30 });
      const v = RD.V.vec; v.awake = true; v.st = 'hunt'; v.stT = 0;
    }
    const ids = [...R.players.keys()];
    const immortal = () => { for (const id of ids) { const pl = R.players.get(id); if (pl) { pl.hp = 1e6; pl.dead = false; } } };
    await sleep(3000);

    //  the room's positions, kept with their time, to find how late each screen is
    const hist = [];                             // [t, Map(key → [x, z, st, swing])]
    const roomNow = () => {
      const m = new Map();
      for (const d of RD.dogs) if (d.live && !d.dead) m.set('d' + d.slot, [d.x, d.z, d.st, d.st === 'attack' ? 1 : 0]);
      for (const g of RD.gorgons) if (g.live && !g.dead) m.set('g' + g.slot, [g.x, g.z, g.st, g.atk ? 1 : 0]);
      for (const f of RD.flayers) if (f.live && !f.dead) m.set('m' + f.slot, [f.x, f.z, f.st, f.atk ? 1 : 0]);
      const v = RD.vec; if (v.live && !v.dead) m.set('v0', [v.x, v.z, v.st, v.atk ? 1 : 0]);
      return m;
    };
    const samples = { A: [], B: [] };            // [t, seen[]]
    const t0 = Date.now();
    //  They walk a circle each (4 m/s, set every frame, as a player moves), and
    //  fire now and then: the district hears them. Each page also keeps, every
    //  frame, where it draws the other player and the creatures near it (for
    //  how smooth that is), and counts what it sends and receives, by kind.
    const INSTALL = (cx, cz, ph) => `(() => {
      const W = window.__probe = { rec: [], up: {}, down: {}, t0: Date.now() };
      const f = updatePeers; updatePeers = function (dt, now) {
        const a = ${ph} + (Date.now() - W.t0) / 1000 * 4 / 14, x = ${cx} + Math.sin(a) * 14, z = ${cz} + Math.cos(a) * 14;
        if (clearAt(x, z, 1)) p.set(x, EYE, z);
        if (Math.random() < 0.004) MP.client.publish(mtopic('shot'), JSON.stringify({ id: MP.id }));
        const r = f(dt, now);
        const row = [Date.now(), +p.x.toFixed(3), +p.z.toFixed(3)];
        for (const q of MP.peers.values()) row.push(+q.cur.x.toFixed(3), +q.cur.z.toFixed(3));
        const c = [];
        for (const d of dogs) if (d.live && !d.dead && Math.hypot(d.x - p.x, d.z - p.z) < 60) c.push('d' + d.slot, +d.x.toFixed(3), +d.z.toFixed(3));
        for (const g of gorgons) if (g.live && !g.dead && Math.hypot(g.x - p.x, g.z - p.z) < 60) c.push('g' + g.slot, +g.x.toFixed(3), +g.z.toFixed(3));
        row.push(c); W.rec.push(row);
        return r;
      };
      const on = onNet; onNet = function (t, msg, bytes) { let k = t.slice(t.lastIndexOf('/') + 1); if (/^p0/.test(k)) k = 'state'; const e = W.down[k] || (W.down[k] = [0, 0]); e[0]++; e[1] += bytes; return on(t, msg, bytes); };
      const c = MP.client, pub = c.publish, pre = mtopic('');
      c.publish = function (t, pl) { let k = t.slice(pre.length); if (k.slice(0, 6) === 'state/') k = 'state'; const e = W.up[k] || (W.up[k] = [0, 0]); e[0]++; e[1] += String(pl).length + k.length + 12; return pub.apply(this, arguments); };
      return 1; })()`;
    await Promise.all([ev(A, INSTALL(at[0], at[1], 0)), ev(B, INSTALL(at[0], at[1], 3))]);
    while (Date.now() - t0 < SECS * 1000) {
      immortal();
      const tR = Date.now(); hist.push([tR, roomNow()]);
      const [sa, sb] = await Promise.all([ev(A, SEEN), ev(B, SEEN)]);
      const tS = Date.now();
      samples.A.push([(tR + tS) / 2, JSON.parse(sa)]); samples.B.push([(tR + tS) / 2, JSON.parse(sb)]);
      await sleep(100);
    }
    const probeOf = (P) => ev(P, 'JSON.stringify(window.__probe)').then((s) => JSON.parse(s));
    const [PA, PB] = await Promise.all([probeOf(A), probeOf(B)]);
    const pos = await Promise.all([ev(A, 'JSON.stringify([p.x, p.z])'), ev(B, 'JSON.stringify([p.x, p.z])')]).then((a) => a.map((s) => JSON.parse(s)));
    //  the room's word at time t (the nearest sample at or before)
    const roomAt = (t) => { let lo = 0; for (let i = 0; i < hist.length; i++) if (hist[i][0] <= t) lo = i; return hist[lo][1]; };
    const near = (x, z) => pos.some((pp) => Math.hypot(pp[0] - x, pp[1] - z) < 70);
    function score(who, delay) {
      const err = [], stDiff = [0, 0], swingMiss = { g: [0, 0], m: [0, 0], v: [0, 0] };
      for (const [t, seen] of samples[who]) {
        const Rm = roomAt(t - delay);
        for (const [k, slot, x, z, st, sw] of seen) {
          const r = Rm.get(k + slot); if (!r || !near(r[0], r[1])) continue;
          err.push(Math.hypot(r[0] - x, r[1] - z));
          stDiff[1]++; if (r[2] !== st) stDiff[0]++;
          if (swingMiss[k] && r[3]) { swingMiss[k][1]++; if (!sw) swingMiss[k][0]++; }
        }
      }
      return { err, stDiff, swingMiss };
    }
    const report = {};
    for (const who of ['A', 'B']) {
      const now = score(who, 0);
      let best = 0, bestM = mean(now.err);
      for (let d = 50; d <= 1200; d += 50) { const m = mean(score(who, d).err); if (m < bestM) { bestM = m; best = d; } }
      const late = score(who, best);
      report[who] = {
        lag: who === 'A' ? LAGA : LAGB,
        vsRoom: { mean: +mean(now.err).toFixed(2), p95: +q(now.err, 0.95).toFixed(2), max: +q(now.err, 1).toFixed(2), n: now.err.length },
        behindMs: best,
        leftOver: { mean: +mean(late.err).toFixed(2), p95: +q(late.err, 0.95).toFixed(2), max: +q(late.err, 1).toFixed(2) },
        stateDiffers: +(now.stDiff[0] / Math.max(1, now.stDiff[1])).toFixed(3),
        stateDiffersLate: +(late.stDiff[0] / Math.max(1, late.stDiff[1])).toFixed(3),
        swingUnseen: Object.fromEntries(Object.entries(late.swingMiss).map(([k, v]) => [k, v[0] + '/' + v[1]])),
      };
    }
    //  the two screens against each other, at the same moments
    const ab = [];
    for (let i = 0; i < Math.min(samples.A.length, samples.B.length); i++) {
      const mb = new Map(samples.B[i][1].map((s) => [s[0] + s[1], s]));
      for (const s of samples.A[i][1]) { const o = mb.get(s[0] + s[1]); if (o && near(s[2], s[3])) ab.push(Math.hypot(o[2] - s[2], o[3] - s[3])); }
    }
    report.AvsB = { mean: +mean(ab).toFixed(2), p95: +q(ab, 0.95).toFixed(2), max: +q(ab, 1).toFixed(2), n: ab.length };
    report.room = { sentKB: +(RD.bytes / 1024).toFixed(1), words: RD.sent, secs: SECS };
    //  The other player as drawn here, against where they really were (their own
    //  page's record, the same clock): how far behind, and how steadily it moves.
    //  Smoothness: the frame-to-frame change in drawn speed (m/s), the mean of its
    //  size — for the other player (who walks at a steady 4 m/s) and for the
    //  creatures near (against their own speed a few frames either side).
    const speeds = (pts) => { const s = []; for (let i = 1; i < pts.length; i++) { const dt = (pts[i][0] - pts[i - 1][0]) / 1000; if (dt > 0.004) s.push([pts[i][0], Math.hypot(pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]) / dt]); } return s; };
    const wobble = (sp) => { const w = []; for (let i = 3; i < sp.length - 3; i++) { const m = sp.slice(i - 3, i + 4).map((q) => q[1]).sort((a, b) => a - b)[3]; if (m > 0.8) w.push(Math.abs(sp[i][1] - m)); } return w; };
    const peerOf = (Pme, Pother) => {
      const drawn = Pme.rec.filter((r) => r.length > 4).map((r) => [r[0], r[3], r[4]]);
      const truth = Pother.rec.map((r) => [r[0], r[1], r[2]]);
      const at = (t) => { let lo = 0, hi = truth.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (truth[m][0] <= t) lo = m; else hi = m; } return truth[lo]; };
      let best = 0, bestE = 1e9;
      for (let d = 0; d <= 800; d += 10) { const e = mean(drawn.map((q) => { const o = at(q[0] - d); return Math.hypot(o[1] - q[1], o[2] - q[2]); })); if (e < bestE) { bestE = e; best = d; } }
      const sp = speeds(drawn), w = wobble(sp);
      return { behindMs: best, leftOver: +bestE.toFixed(2), wobble: +mean(w).toFixed(2), wobbleP95: +q(w, 0.95).toFixed(2), frames: drawn.length };
    };
    const creatureWobble = (Pme) => {
      const by = new Map();
      for (const r of Pme.rec) { const c = r[r.length - 1]; for (let i = 0; i < c.length; i += 3) { if (!by.has(c[i])) by.set(c[i], []); by.get(c[i]).push([r[0], c[i + 1], c[i + 2]]); } }
      const w = []; for (const pts of by.values()) w.push(...wobble(speeds(pts)));
      return { wobble: +mean(w).toFixed(2), wobbleP95: +q(w, 0.95).toFixed(2), n: w.length };
    };
    report.peer = { AseesB: peerOf(PA, PB), BseesA: peerOf(PB, PA) };
    report.creatureSmooth = { A: creatureWobble(PA), B: creatureWobble(PB) };
    const secs = (Date.now() - PA.t0) / 1000;
    const rate = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1][1] - a[1][1]).map(([k, [n, b]]) => [k, (n / secs).toFixed(1) + ' msg/s ' + (b / secs / 1024).toFixed(2) + ' KB/s']));
    const tot = (o) => { let n = 0, b = 0; for (const [m, k] of Object.values(o)) { n += m; b += k; } return (n / secs).toFixed(1) + ' msg/s ' + (b / secs / 1024).toFixed(2) + ' KB/s'; };
    report.net = { A: { up: tot(PA.up), down: tot(PA.down), downBy: rate(PA.down), upBy: rate(PA.up) }, B: { up: tot(PB.up), down: tot(PB.down) } };
    report.errors = A.errors.concat(B.errors).slice(0, 5);
    console.log(JSON.stringify(report, null, 1));
  } finally {
    await room.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });

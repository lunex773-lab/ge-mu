'use strict';
//  ============================================================
//  PHASE 3 — AGAINST THE REAL GAME
//  ============================================================
//  phase3.test.js checks the sensor against a toy world. This checks the
//  adapter against the real one: the actual `p`, `MP.peers` and `rayCity` of
//  a running index.html, two players in one room.
//
//  The plan's verification for Phase 3 is "既存AIが変わらないこと". Nothing in
//  index.html has changed, so that is true by construction; what can still be
//  broken is the promise that *observing* the game does not change it once
//  the observer is plugged in. So: snapshot the game, observe it five hundred
//  times with no frame in between, snapshot it again, and compare — and count
//  every Math.random call made while doing it.
//
//  Needs Playwright and Chromium (both preinstalled here). Run:
//    node lab/test/phase3.game.test.js

const { openRoom, sleep } = require('./harness/page.js');

const results = [];
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  results.push((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '\n         ' + detail : ''));
}

//  Installed into the page: the adapter, the sensor and a virtual boss body,
//  wired to the live game through the hooks.
const INSTALL = () => {
  const T = window.__t, L = window.__lab;
  const { makeGameAdapter } = L.require('game_adapter.js');
  const { SensorLayer } = L.require('sensors.js');
  const W = L.require('worldstate.js');
  const G = {
    now: () => T.cityT, p: T.p, EYE: T.EYE, yaw: () => T.yaw, hp: () => T.hp, HP_MAX: T.HP_MAX,
    dead: () => T.dead, cloak: () => T.cloak > 0, world: () => T.wState, MP: T.MP,
    rayCity: T.rayCity, rayWrecks: T.rayWrecks, WS_BACK: T.WS.BACK, Vec3: THREE.Vector3, clearAt: T.clearAt,
  };
  const A = makeGameAdapter(G);
  const S = new SensorLayer({ strict: true });
  const boss = { x: T.p.x + 12, y: 0, z: T.p.z + 12, hd: 0, vx: 0, vz: 0, hp: 5000, hpMax: 5000, cd: 0, state: 0, alt: 0, world: 0 };
  const face = () => { boss.hd = Math.atan2(T.p.x - boss.x, T.p.z - boss.z); };
  window.__p3 = { T, A, S, W, boss, face,
    tick() { const ws = S.sense(A.observe(boss, 0)); A.drain(); return ws; } };
  return true;
};

//  Everything an observer could conceivably disturb, flattened to numbers.
const SNAPSHOT = () => {
  const T = window.__t, out = [];
  const r = (v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);
  out.push(r(T.p.x), r(T.p.y), r(T.p.z), r(T.yaw), r(T.hp), T.dead, r(T.cloak), T.wState, r(T.cityT));
  T.MP.peers.forEach((pr, id) => out.push(id, r(pr.cur.x), r(pr.cur.y), r(pr.cur.z), r(pr.yaw), pr.hp, pr.dead, pr.inv, pr.w));
  for (const m of T.monkeyPeds) out.push(r(m.wx), r(m.wz), m.hp, m.aggro, r(m.hd || 0));
  for (const d of T.dogs) out.push(d.live, r(d.x), r(d.z), d.hp, d.st);
  const g = T.rift; out.push(g.present, r(g.x), r(g.z), g.seed);
  return JSON.stringify(out);
};

(async () => {
  const room = await openRoom();
  try {
    const A = await room.player({ room: 'p3', nick: 'A' });
    const B = await room.player({ room: 'p3', nick: 'B' });
    await A.join(); await B.join();
    await sleep(3500);
    await A.eval(INSTALL);

    // ---- the other player shows up where they actually are --------------
    const seen = await A.eval(() => {
      const o = window.__p3.A.observe(window.__p3.boss, 0);
      return o.bodies.map((b) => ({ id: b.id, x: b.x, y: b.y, z: b.z }));
    });
    const bTruth = await B.eval(() => ({ id: window.__t.MP.id, x: window.__t.p.x, y: window.__t.p.y - window.__t.EYE, z: window.__t.p.z }));
    const bSeen = seen.find((q) => q.id === bTruth.id);
    check('the other player is observed, near where they really stand',
      bSeen && Math.hypot(bSeen.x - bTruth.x, bSeen.z - bTruth.z) < 1.5 && Math.abs(bSeen.y - bTruth.y) < 0.5,
      'seen ' + JSON.stringify(bSeen) + ' truth ' + JSON.stringify(bTruth));
    check('the local player is observed as a body too', seen.length === 2, JSON.stringify(seen.map((q) => q.id)));

    // ---- observing changes nothing ---------------------------------------
    const purity = await A.eval((SNAP) => {
      const snap = new Function('return (' + SNAP + ')()');
      const P = window.__p3;
      const real = Math.random; let calls = 0;
      const before = snap();
      Math.random = () => { calls++; return real(); };
      let ok = true;
      try {
        for (let i = 0; i < 500; i++) {
          P.boss.x += 0.3; P.face();
          P.A.noteShot(P.T.MP.id, P.T.p.x, P.T.p.y, P.T.p.z);
          if (i % 10 === 0) P.A.noteHit('self', P.T.MP.id, 20, 100);
          P.tick();
        }
      } catch (e) { ok = e.message; }
      finally { Math.random = real; }
      const after = snap();
      return { same: before === after, calls, ok, len: before.length };
    }, SNAPSHOT.toString());
    check('observing the game 500 times leaves it byte-for-byte unchanged', purity.same && purity.ok === true,
      'same=' + purity.same + ' error=' + purity.ok + ' (' + purity.len + ' chars of state compared)');
    check('and draws nothing from the game\'s Math.random stream', purity.calls === 0, purity.calls + ' calls');

    // ---- line of sight agrees with the game's own check ------------------
    //  The reference is vecSee's arithmetic, copied: eye 0.6 below the top of
    //  a 5.1 m body, aimed at half a metre under the player's eyes, blocked if
    //  the city is hit short of the target by more than 0.6 m.
    const los = await A.eval(() => {
      const P = window.__p3, T = P.T, p = T.p;
      const eye = new THREE.Vector3(), dir = new THREE.Vector3();
      let agree = 0, n = 0, blocked = 0, tries = 0;
      const saved = { x: P.boss.x, z: P.boss.z };
      while (n < 300 && tries < 5000) {
        tries++;
        const a = (tries * 2.39996) % 6.2832, d = 15 + (tries * 37 % 85);
        const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
        if (!T.clearAt(x, z, 1.0)) continue;                  // stand it in the street, not in a wall
        P.boss.x = x; P.boss.z = z; P.face();
        P.S.tracks.clear(); P.S.target = null;               // judge this sighting alone
        const ws = P.tick();
        const mine = ws.get('player_visible') > 0 ? 1 : 0;
        eye.set(x, 0 + 3.9, z);
        dir.set(p.x - eye.x, (p.y - 0.5) - eye.y, p.z - eye.z);
        const len = dir.length(); dir.normalize();
        const ref = T.rayCity(eye, dir) < len - 0.6 ? 0 : 1;
        if (mine === ref) agree++;
        if (!ref) blocked++;
        n++;
      }
      P.boss.x = saved.x; P.boss.z = saved.z;
      return { agree, n, blocked };
    });
    check('line of sight agrees with the game\'s own ray check',
      los.n >= 250 && los.agree / los.n >= 0.98,
      los.agree + ' of ' + los.n + ' positions agree');
    check('and the comparison is not vacuous — walls really do block some of them',
      los.blocked > los.n * 0.1 && los.blocked < los.n * 0.9, los.blocked + ' of ' + los.n + ' blocked');

    // ---- the avatar's facing is read the game's way ----------------------
    const facing = await A.eval(() => {
      const P = window.__p3, T = P.T, p = T.p;
      // somewhere in the street 12 m away that can actually see the player
      const eye = new THREE.Vector3(), dir = new THREE.Vector3();
      let spot = null;
      for (let i = 0; i < 64 && !spot; i++) {
        const a = i * 0.39, x = p.x + Math.sin(a) * 12, z = p.z + Math.cos(a) * 12;
        if (!T.clearAt(x, z, 1.0)) continue;
        eye.set(x, 3.9, z); dir.set(p.x - x, p.y - 0.53 - 3.9, p.z - z);
        const len = dir.length(); dir.normalize();
        if (!(T.rayCity(eye, dir) < len - 0.6)) spot = { x, z };
      }
      if (!spot) return { skipped: true };
      P.boss.x = spot.x; P.boss.z = spot.z; P.face();
      const old = T.yaw;
      // the camera looks along (-sin yaw, -cos yaw), so to look along d: yaw = atan2(-dx, -dz)
      const dx = spot.x - p.x, dz = spot.z - p.z;
      P.S.tracks.clear(); P.S.target = null;
      T.yaw = Math.atan2(-dx, -dz); const toward = P.tick().get('player_facing_me');
      P.S.tracks.clear(); P.S.target = null;
      T.yaw = Math.atan2(dx, dz); const away = P.tick().get('player_facing_me');
      T.yaw = old;
      return { toward, away, spot };
    });
    check('a player looking at it reads as facing it; looking away does not',
      facing.toward > 0.95 && facing.away === 0, JSON.stringify(facing));

    // ---- a live run: every tick valid ------------------------------------
    const live = await A.eval(async () => {
      const P = window.__p3;
      const probs = []; let ticks = 0;
      P.S.tracks.clear(); P.S.target = null;
      await new Promise((res) => {
        const id = setInterval(() => {
          P.face();
          const w = P.tick();
          const bad = P.W.validate(w);
          if (bad.length) probs.push(bad.join(','));
          if (++ticks >= 40) { clearInterval(id); res(); }
        }, 100);
      });
      return { ticks, probs: probs.slice(0, 3), known: P.S.ws.get('players_known'), target: P.S.target && P.S.target.id };
    });
    check('40 live ticks over 4 s of real frames, every WorldState valid', live.probs.length === 0,
      JSON.stringify(live));

    // ---- the cost, in the real city --------------------------------------
    //  performance.now() is coarsened to 100 µs in a page, too blunt to time
    //  one tick, so ticks are timed in bulk — and since the sight rays are the
    //  cost, the worst case is built from the most rays a tick may cast
    //  (the one it attends to, plus the quota for everyone else) times what
    //  one of those rays really costs here, measured on the same geometry.
    const cost = await A.eval(() => {
      const P = window.__p3, T = P.T, p = T.p;
      P.boss.x = p.x + 9; P.boss.z = p.z + 9; P.face();
      for (let i = 0; i < 50; i++) P.tick();
      let maxRays = 0;
      const N = 2000, t0 = performance.now();
      for (let i = 0; i < N; i++) { const r0 = P.S.probes; P.tick(); maxRays = Math.max(maxRays, P.S.probes - r0); }
      const perTick = (performance.now() - t0) / N;
      const eye = new THREE.Vector3(P.boss.x, 3.9, P.boss.z), rd = new THREE.Vector3();
      rd.set(p.x - eye.x, p.y - 0.53 - eye.y, p.z - eye.z).normalize();
      const M = 4000, t1 = performance.now();
      for (let i = 0; i < M; i++) T.rayCity(eye, rd);
      const perRay = (performance.now() - t1) / M;
      return { perTick, perRay, maxRays, budget: 1 + P.S.o.losQuota };
    });
    const worst = cost.perTick + (cost.budget - cost.maxRays) * cost.perRay;
    check('the worst tick fits a phone: under 0.25 ms here, so ~2 ms at 8x slower',
      worst < 0.25, 'average tick ' + (cost.perTick * 1000).toFixed(0) + ' µs with ' + cost.maxRays
      + ' sight ray(s); a ray costs ' + (cost.perRay * 1000).toFixed(1) + ' µs; with the full budget of '
      + cost.budget + ' rays the worst tick is ~' + (worst * 1000).toFixed(0) + ' µs');

    const errs = A.errors.concat(B.errors);
    check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await A.close(); await B.close();
  } finally {
    await room.close();
  }
  console.log('\nPHASE 3 — against the real game\n');
  console.log(results.join('\n'));
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

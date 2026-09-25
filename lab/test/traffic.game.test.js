'use strict';
//  ============================================================
//  THE DAY SIDE'S TRAFFIC, RUN BY THE ROOM — the real game
//  ============================================================
//  The real game, with the room running the cars, the Ferraris and the
//  crowd once two are here (server/traffic.js, shared/traffic.js — the
//  room's real code, in this process, as the harness runs it). Checked:
//
//    - alone, the player's game runs the traffic, as it always has
//    - a second player arrives: the room carries on from the host's game's
//      traffic — the host sees nothing change — and both see the same cars
//      and the same people, and the same lights
//    - a walker shot by one is gone from the other's screen, and the body
//      lies there on both
//    - what it costs: each game's time on the traffic, and what it receives
//    - the second player leaves: the traffic is given back, and carries on
//
//    node lab/test/traffic.game.test.js     (about two minutes)

const { openRoom, sleep } = require('./harness/page.js');

const results = [];
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  const line = (ok ? '  ok   ' : '  FAIL ') + name + (detail ? '\n         ' + detail : '');
  results.push(line); console.log(line);
}
const ev = (P, src) => P.eval((s) => window.__t.ev(s), src);
async function until(P, src, secs) {
  for (let i = 0; i < secs * 10; i++) { if (await ev(P, src)) return true; await sleep(100); }
  return false;
}
const CARS = 'JSON.stringify(cars.map((c) => [+c.rx.toFixed(2), +c.rz.toFixed(2)]))';
//  how long updateCity takes here, a frame (drawing off, as lab/tools/profile_game.js measures)
const TIMING = `(() => { const S = window.__S = { on: false, t: [] };
  const f = updateCity; updateCity = function (dt) { const t0 = performance.now(); const r = f(dt); if (S.on) S.t.push(performance.now() - t0); return r; };
  return 1; })()`;
async function cityCost(P, secs) {
  await ev(P, 'window.__S.t = []; window.__S.on = true; 1'); await sleep(secs * 1000);
  //  the mean of the middle eight tenths of the frames (a plain mean is pulled about by the odd
  //  collection or a busy moment on this machine; the page's clock is too coarse for one frame's middle)
  const t = JSON.parse(await ev(P, 'window.__S.on = false; JSON.stringify(window.__S.t)')).sort((a, b) => a - b);
  const mid = t.slice(Math.floor(t.length * 0.1), Math.ceil(t.length * 0.9));
  return mid.reduce((a, b) => a + b, 0) / Math.max(1, mid.length) * 1000;
}

(async () => {
  const room = await openRoom({ creatures: true });
  try {
    const A = await room.player({ room: 'traffic', nick: 'Aki' });
    //  (B's page is open from the start, so both measurements of A's time are
    //  taken with the same two pages running on this machine)
    const B = await room.player({ room: 'traffic', nick: 'Ben' });
    await ev(B, 'window.__t.noRender(); 1');
    await A.join(); await sleep(2500);
    await ev(A, 'window.__t.noRender(); 1');
    await ev(A, TIMING);
    check('alone, the player\'s game runs the traffic, as it always has', await ev(A, 'trafficSim()'));
    //  stand by a busy crossing in the open (and back there to measure it again, told it: the same street, the same cars about)
    const CROSSING = `(() => { for (let x = 4; x < 60; x += 2) if (clearAt(x, 6, 1)) { p.set(x, EYE, 6); publishState(true); return 1; } return 0; })()`;
    await ev(A, CROSSING);
    await sleep(1000);
    const ownUs = await cityCost(A, 6);

    // ---- a second player: the room carries on from the host's traffic ----------------
    await ev(A, `(() => { const f = onRoomOwns; onRoomOwns = function (m) {
      if (m.t && !MP.srvOwns.t) { window.__atTake = JSON.parse(${CARS}); window.__atTakeT = performance.now(); } return f(m); }; return 1; })()`);
    await B.join();
    const taken = (await until(A, 'MP.srvOwns.t && !trafficSim()', 10)) && (await until(B, 'MP.srvOwns.t', 10));
    const RT = room.rooms.get('traffic').relay.creatures.traffic;
    const at = JSON.parse(await ev(A, 'JSON.stringify(window.__atTake || [])'));
    await sleep(600);
    //  (how long it has really been: waiting on both screens to say so takes a while, more on a busy machine)
    const [after, since] = JSON.parse(await ev(A, `JSON.stringify([${CARS.replace('JSON.stringify(', '(')}, (performance.now() - window.__atTakeT) / 1000])`));
    const jump = after.map(([x, z], k) => Math.hypot(x - at[k][0], z - at[k][1]) - since * (RT.T.cars[k].speed + 4));
    const worst = jump.indexOf(Math.max(...jump)), wc = RT.T.cars[worst];
    check('a second player arrives: the room carries on from the host\'s traffic, and the host sees nothing jump', taken && at.length === 140 && Math.max(...jump) < 1,
      'the most any car moved in the ' + since.toFixed(2) + ' s after, beyond what its speed would take it: ' + Math.max(0, Math.max(...jump)).toFixed(2) + ' m' +
      (Math.max(...jump) >= 1 ? ' (car ' + worst + ': ' + JSON.stringify(at[worst]) + ' → ' + JSON.stringify(after[worst]) + ', the room has it at ' + [wc.rx.toFixed(1), wc.rz.toFixed(1)] + ' going ' + wc.speed.toFixed(1) + ' m/s; the room took it at ' + JSON.stringify(RT.tookAt && RT.tookAt[worst]) + ')' : ''));
    //  B beside A: the same cars, the same people, the same lights
    await ev(B, `(() => { p.set(${await ev(A, 'p.x')} + 3, EYE, ${await ev(A, 'p.z')}); publishState(true); return 1; })()`);
    await sleep(3000);
    const near = (P) => ev(P, `JSON.stringify({ cars: cars.map((c) => Math.hypot(c.rx - p.x, c.rz - p.z) < 120 ? [c.k, c.rx, c.rz] : null).filter(Boolean),
      walkers: traffic.walkers.map((e) => Math.hypot(e.rx - p.x, e.rz - p.z) < 100 ? [e.hidx, e.rx, e.rz] : null).filter(Boolean),
      light: [0, 1, 2].map((k) => JSON.stringify(phaseAt(k, 0))).join(), t: +sigT().toFixed(2) })`);
    const [na, nb] = [JSON.parse(await near(A)), JSON.parse(await near(B))];
    //  (each one A has near it, where B has it: B knows every one of them)
    const allB = JSON.parse(await ev(B, 'JSON.stringify({ cars: cars.map((c) => [c.k, c.rx, c.rz]), walkers: traffic.walkers.map((e) => [e.hidx, e.rx, e.rz]) })'));
    nb.cars = allB.cars; nb.walkers = allB.walkers;
    const gap = (xs, ys) => xs.map(([k, x, z]) => { const o = ys.find((q) => q[0] === k); return o ? Math.hypot(o[1] - x, o[2] - z) : 99; });
    const gc = gap(na.cars, nb.cars), gw = gap(na.walkers, nb.walkers);
    //  (near them each game is told within 0.3 m; read one after the other, a car moves a little between)
    check('both see the same cars and the same people', na.cars.length > 3 && na.walkers.length > 3 && Math.max(...gc) < 2.5 && Math.max(...gw) < 1.5,
      na.cars.length + ' cars within 120 m, the furthest apart ' + Math.max(...gc).toFixed(2) + ' m; ' + na.walkers.length + ' walkers within 100 m, ' + Math.max(...gw).toFixed(2) + ' m');
    check('and the same lights', Math.abs(na.t - nb.t) < 0.5 && Math.abs(na.t - RT.t) < 0.8, 'clocks: A ' + na.t + ' s, B ' + nb.t + ' s, the room ' + RT.t.toFixed(2) + ' s');

    // ---- a walker shot ---------------------------------------------------------------
    //  (A walks up to the nearest walker it can see from 10 m, B beside A)
    const k = await ev(A, `(() => { const byD = traffic.walkers.slice().sort((a, b) => Math.hypot(a.rx - p.x, a.rz - p.z) - Math.hypot(b.rx - p.x, b.rz - p.z));
      const ro = new THREE.Vector3(), rd = new THREE.Vector3();
      for (const e of byD) for (let q = 0; q < 16; q++) { const a = q * 0.39, x = e.rx + Math.sin(a) * 10, z = e.rz + Math.cos(a) * 10;
        if (!clearAt(x, z, 0.8)) continue;
        ro.set(x, EYE, z); rd.set(e.rx - x, 1.15 - EYE, e.rz - z); const L = rd.length(); rd.normalize();
        if (rayCity(ro, rd, L) < L - 0.3) continue;
        p.set(x, EYE, z); publishState(true); return e.hidx; }
      return -1; })()`);
    await ev(B, `(() => { p.set(${await ev(A, 'p.x')} + 2, EYE, ${await ev(A, 'p.z')}); publishState(true); return 1; })()`);
    await sleep(1500);
    const was = JSON.parse(await ev(B, `JSON.stringify([traffic.walkers[${k}].rx, traffic.walkers[${k}].rz, corpses.filter((c) => c.active).length])`));
    await ev(A, `(() => { const e = traffic.walkers[${k}]; for (const o of peds) if (o !== e) o.wx += 500; for (const m of monkeyPeds) { m.wx += 500; m.netX = m.wx; }
      const dx = e.wx - p.x, dz = e.wz - p.z; yaw = Math.atan2(-dx, -dz); pitch = Math.atan2(1.15 - p.y, Math.hypot(dx, dz)); return 1; })()`);
    await sleep(250);
    await ev(A, `new Promise((done) => { const e = traffic.walkers[${k}]; const aim = () => { const dx = e.wx - p.x, dz = e.wz - p.z; yaw = Math.atan2(-dx, -dz); pitch = Math.atan2(1.15 - p.y, Math.hypot(dx, dz)); };
      aim(); requestAnimationFrame(() => { aim(); requestAnimationFrame(() => { aim(); mode = 'mobile'; fireCd = 0; reloading = 0; ammo = Math.max(ammo, 5); fire(); done(1); }); }); })`);
    const gone = await until(B, `Math.hypot(traffic.walkers[${k}].rx - ${was[0]}, traffic.walkers[${k}].rz - ${was[1]}) > 20`, 3);
    const body = await until(B, `corpses.filter((c) => c.active).length > ${was[2]}`, 3);
    check('a walker one shoots is gone from the other\'s screen, and the body lies there on both', gone && body, 'walker ' + k + (room.rooms.get('traffic').relay.lastRefusal ? '; last refused: ' + room.rooms.get('traffic').relay.lastRefusal : ''));

    // ---- what it costs ---------------------------------------------------------------
    await ev(B, `(() => { window.__tv = 0; const f = onNet; onNet = function (t, msg, bytes) { if (t.slice(-3) === '/tv') window.__tv += bytes; return f(t, msg, bytes); }; return 1; })()`);
    await ev(A, CROSSING); await sleep(1000);
    const roomUs = await cityCost(A, 6);
    const tvBytes = await ev(B, 'window.__tv');
    check('each game\'s time on the traffic, told it rather than working it out: less', roomUs < ownUs * 0.85,
      'updateCity ' + ownUs.toFixed(0) + ' µs a frame working it out, ' + roomUs.toFixed(0) + ' µs told it (' + ((1 - roomUs / ownUs) * 100).toFixed(0) + '% less)');
    check('and what it receives for it: a few KB a second', tvBytes / 6 < 6000, (tvBytes / 6 / 1024).toFixed(2) + ' KB/s');

    // ---- given back --------------------------------------------------------------------
    const last = JSON.parse(await ev(A, CARS));
    await B.close();
    const back = await until(A, '!MP.srvOwns.t && trafficSim()', 10);
    await sleep(600);
    const now = JSON.parse(await ev(A, CARS));
    const moved = now.map(([x, z], i) => Math.hypot(x - last[i][0], z - last[i][1]));
    const going = moved.filter((d) => d > 0.3).length;
    check('the second player leaves: the traffic is given back, and carries on from where it was', back && Math.max(...moved) < 30 && going > 20,
      going + ' cars moving; the most any moved ' + Math.max(...moved).toFixed(1) + ' m (in about a second)');

    const errs = A.errors.concat(B.errors);
    check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  } finally {
    await room.close();
  }
  console.log('\nTHE DAY SIDE\'S TRAFFIC, RUN BY THE ROOM: ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

'use strict';
//  ============================================================
//  THE OTHER SIDE'S DOGS, RUN BY THE ROOM — the real game
//  ============================================================
//  The real game, with the room running the dogs once two are here
//  (server/dogs.js, shared/dogs.js — the room's real code, in this process,
//  as the harness runs it). Checked:
//
//    - alone, the player's game runs them, as it always has
//    - a second player arrives: the room carries on from the host's game's
//      dogs — the host sees nothing jump — and its game stops running them
//    - the second player crosses over: both see the same dogs
//    - they hunt the second player too (a host's game only ever hunted its
//      own player): the room decides the bite
//    - a dog one shoots is hurt on both screens, the room having judged it
//    - the host's flayer still runs in its game, and summons its escort:
//      the room makes the dogs, sworn to it, and everyone sees them
//    - what it costs: the host's game's time on the dogs, and what the
//      other receives for them
//    - the second player leaves: the dogs are given back, and carry on
//
//    node lab/test/dogs.game.test.js     (about two minutes)

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
const DOGS = 'JSON.stringify(dogs.map((d) => d.live ? [d.slot, +d.x.toFixed(2), +d.z.toFixed(2), d.hp, d.dead ? 1 : 0, d.lord || 0] : null))';
//  how long updateDogs takes here, a frame (drawing off)
const TIMING = `(() => { const S = window.__S = { on: false, s: 0, n: 0 };
  const f = updateDogs; updateDogs = function (dt) { const t0 = performance.now(); const r = f(dt); if (S.on) { S.s += performance.now() - t0; S.n++; } return r; };
  return 1; })()`;
async function dogCost(P, secs) {
  await ev(P, 'window.__S.s = 0; window.__S.n = 0; window.__S.on = true; 1'); await sleep(secs * 1000);
  const r = JSON.parse(await ev(P, 'window.__S.on = false; JSON.stringify(window.__S)'));
  return r.s / Math.max(1, r.n) * 1000;
}
//  stand somewhere clear, out of the traffic of the other side's wrecks
const STAND = (x, z) => `(() => { carHitCd = 1e9; for (let r = 0; r < 60; r += 2) for (let k = 0; k < 12; k++) { const sx = ${x} + Math.sin(k * 0.52) * r, sz = ${z} + Math.cos(k * 0.52) * r;
  if (clearAt(sx, sz, 3)) { p.set(sx, EYE, sz); vy = 0; publishState(true); return JSON.stringify([sx, sz]); } } return null; })()`;

(async () => {
  const room = await openRoom({ creatures: true });
  try {
    const A = await room.player({ room: 'dogs', nick: 'Aki' });
    const B = await room.player({ room: 'dogs', nick: 'Ben' });
    await ev(B, 'window.__t.noRender(); 1');
    await A.join(); await sleep(2000);
    await ev(A, 'window.__t.noRender(); mfHoldSpawn = true; vecHoldSpawn = true; gorHoldSpawn = true; 1');
    await ev(A, TIMING);
    await ev(A, 'setWorld(WS.BACK); 1');
    const at = JSON.parse(await ev(A, STAND(11, 10)));
    const stocked = await until(A, 'dogs.filter((d) => d.live).length >= 36', 40);
    check('alone, the player\'s game runs the dogs, as it always has', stocked && await ev(A, 'dogSim() && !MP.srvOwns.d'),
      await ev(A, 'dogs.filter((d) => d.live).length') + ' dogs up');

    // ---- a second player: the room carries on from the host's dogs ------------------
    await ev(A, `(() => { const f = onRoomOwns; onRoomOwns = function (m) {
      if (m.d && !MP.srvOwns.d) window.__atTake = JSON.parse(${DOGS}); return f(m); }; return 1; })()`);
    await B.join();
    const taken = (await until(A, 'MP.srvOwns.d && !dogSim()', 10)) && (await until(B, 'MP.srvOwns.d', 10));
    const RD = room.rooms.get('dogs').relay.creatures.dogs;
    const before = JSON.parse(await ev(A, 'JSON.stringify(window.__atTake || [])'));
    await sleep(600);
    const after = JSON.parse(await ev(A, DOGS));
    let most = 0, n = 0;
    before.forEach((d, k) => { const q = after[k]; if (!d || !q || d[4]) return; n++; most = Math.max(most, Math.hypot(q[1] - d[1], q[2] - d[2]) - 0.6 * 9.4); });
    check('a second player arrives: the room carries on from the host\'s dogs, and the host sees nothing jump', taken && n > 30 && most < 1 && RD.took && RD.took.length === before.filter(Boolean).length,
      n + ' dogs; the most any moved in the 0.6 s after, beyond what the fastest lunge would take it: ' + Math.max(0, most).toFixed(2) + ' m');

    // ---- the second player crosses over -------------------------------------------
    await ev(B, 'setWorld(WS.BACK); 1');
    const atB = JSON.parse(await ev(B, STAND(at[0] + 4, at[1])));
    await sleep(2000);
    //  (the room tops the district up as it goes: read the two once they have heard the same)
    for (let i = 0; i < 30; i++) { if (await ev(A, 'dogs.filter((d) => d.live).length') === await ev(B, 'dogs.filter((d) => d.live).length')) break; await sleep(200); }
    const da = JSON.parse(await ev(A, DOGS)), db = JSON.parse(await ev(B, DOGS));
    let same = 0, off = 0, missing = 0;
    da.forEach((d, k) => { if (!d) return; const q = db[k]; if (!q) { missing++; return; } if (Math.abs(d[1] - atB[0]) < 90 && Math.abs(d[2] - atB[1]) < 90) { same++; off = Math.max(off, Math.hypot(q[1] - d[1], q[2] - d[2])); } });
    check('over there, both see the same dogs', missing === 0 && same >= 1 && off < 2.5, da.filter(Boolean).length + ' dogs on both screens; ' + same + ' within 90 m, the furthest apart ' + off.toFixed(2) + ' m; ' + missing + ' missing on the second screen');

    // ---- they hunt the second player too ------------------------------------------
    {
      const bx = atB[0], bz = atB[1];
      await ev(B, 'hp = HP_MAX; window.__bit = 0; const f = onRoomHp; onRoomHp = function (m, s) { if (m.src === \'dog\') window.__bit++; return f(m, s); }; 1');
      room.rooms.get('dogs').relay.players.get(await ev(B, 'MP.id')).bittenT = 0;
      const d = RD.dogs.find((q) => q.live && !q.dead && !q.lord);
      for (const q of RD.dogs) if (q.live && q !== d && Math.hypot(q.x - bx, q.z - bz) < 60) { q.x += 300 * Math.sign(q.x || 1); q.rx = q.x; }
      let bitten = false;
      for (let i = 0; i < 60 && !bitten; i++) {
        if (i % 20 === 0) { d.x = d.rx = bx + 2.6; d.z = d.rz = bz; d.y = 0; d.hd = Math.atan2(bx - d.x, bz - d.z); d.st = 'wander'; d.stT = 9; d.atkCd = 0; d.hp = 92; }
        await sleep(100); bitten = await ev(B, 'window.__bit > 0');
      }
      check('they hunt the second player too: the room decides the bite, and the player feels it', bitten && await ev(B, 'hp < HP_MAX'),
        'hp ' + await ev(B, 'hp') + ', bites ' + await ev(B, 'window.__bit'));
      await ev(B, 'hp = HP_MAX; 1');
    }

    // ---- a dog shot -------------------------------------------------------------------
    {
      await ev(B, 'if (dead) { MP.client.publish(mtopic(\'spawn\'), \'{}\'); dead = false; hp = HP_MAX; gameoverEl.classList.remove(\'show\'); } 1');
      const bx = atB[0], bz = atB[1];
      const d = RD.dogs.find((q) => q.live && !q.dead && !q.lord);
      const pin = () => { d.x = d.rx = bx + 9; d.z = d.rz = bz; d.y = 0; d.hp = 92; d.st = 'observe'; d.stT = 0; d.hasT = false; };
      pin(); await sleep(400); pin();
      const hp0 = d.hp;
      await ev(B, `new Promise((done) => { const d = dogs[${d.slot}]; const aim = () => { const dx = d.x - p.x, dz = d.z - p.z; yaw = Math.atan2(-dx, -dz); pitch = Math.atan2(d.y + 1.0 - p.y, Math.hypot(dx, dz)); };
        for (const o of dogs) if (o !== d && o.live) { o.x += 400; o.rx = o.x; }
        aim(); requestAnimationFrame(() => { aim(); requestAnimationFrame(() => { aim(); mode = 'mobile'; fireCd = 0; reloading = 0; ammo = Math.max(ammo, 5); fire(); done(1); }); }); })`);
      await sleep(600);
      const onA = await ev(A, `dogs[${d.slot}].hp`);
      check('a dog the second player shoots is hurt, the room having judged it, on both screens', d.hp === hp0 - 20 && onA <= hp0 - 20,
        'the room ' + hp0 + ' → ' + d.hp + ', the host\'s screen ' + onA + (room.rooms.get('dogs').relay.lastRefusal ? '; last refused: ' + room.rooms.get('dogs').relay.lastRefusal : ''));
    }

    // ---- the host's flayer summons its escort -------------------------------------------
    {
      await ev(A, `(() => { for (const d of dogs) d.x = d.x; const m = spawnFlayer({ x: p.x + 40, z: p.z }); if (!m) return 0; m.escorted = true; mfSummon(m, MF_ESC_DOG, 0); return 1; })()`);
      const f = await ev(A, 'JSON.stringify(flayers.filter((m) => m.live).map((m) => [m.x, m.z]))');
      let sworn = [];
      for (let i = 0; i < 30 && sworn.length < 1; i++) { await sleep(100); sworn = RD.dogs.filter((q) => q.live && q.lord === 'mf'); }
      await sleep(1500);
      sworn = RD.dogs.filter((q) => q.live && !q.dead && q.lord === 'mf');
      const onB = JSON.parse(await ev(B, DOGS)).filter((q) => q && q[5] === 'mf').length;
      check('the host\'s flayer summons its escort: the room makes them, sworn to it, and everyone sees them', sworn.length >= 1 && sworn.length <= 3 && onB === sworn.length,
        sworn.length + ' sworn to the flayer at ' + f + ' (the second screen shows ' + onB + ')');
    }

    // ---- what it costs ---------------------------------------------------------------
    await ev(B, `(() => { window.__dv = 0; const f = onNet; onNet = function (t, msg, bytes) { if (t.slice(-3) === '/dv') window.__dv += bytes; return f(t, msg, bytes); }; return 1; })()`);
    const roomUs = await dogCost(A, 6);
    const dvBytes = await ev(B, 'window.__dv');
    check('and what the other receives for them: a few KB a second', dvBytes / 6 < 8000, (dvBytes / 6 / 1024).toFixed(2) + ' KB/s');

    // ---- given back --------------------------------------------------------------------
    const last = JSON.parse(await ev(A, DOGS));
    await B.close();
    const back = await until(A, '!MP.srvOwns.d && dogSim()', 10);
    await sleep(1000);
    const now = JSON.parse(await ev(A, DOGS));
    let moved = 0, going = 0, kept = 0;
    last.forEach((d, k) => { const q = now[k]; if (!d || !q) return; kept++; const m = Math.hypot(q[1] - d[1], q[2] - d[2]); moved = Math.max(moved, m); if (m > 0.3) going++; });
    check('the second player leaves: the dogs are given back, and carry on from where they were', back && kept > 30 && moved < 15 && going > 5,
      kept + ' kept, ' + going + ' moving; the most any moved ' + moved.toFixed(1) + ' m (in about a second)');
    //  (the same dogs, the same scene: what running them costs this game again)
    const ownUs = await dogCost(A, 6);
    check('the host\'s game\'s time on the dogs, told them rather than running them: less', roomUs < ownUs * 0.85,
      'updateDogs ' + roomUs.toFixed(0) + ' µs a frame told them, ' + ownUs.toFixed(0) + ' µs running them again (' + ((1 - roomUs / ownUs) * 100).toFixed(0) + '% less told)');

    const errs = A.errors.concat(B.errors);
    check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  } finally {
    await room.close();
  }
  console.log('\nTHE OTHER SIDE\'S DOGS, RUN BY THE ROOM: ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

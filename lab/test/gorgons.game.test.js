'use strict';
//  ============================================================
//  THE OTHER SIDE'S DEMOGORGONS, RUN BY THE ROOM — the real game
//  ============================================================
//  The real game, with the room running the gorgons (with the dogs) once two
//  are here (server/dogs.js, shared/gorgons.js — the room's real code, in this
//  process, as the harness runs it). Checked:
//
//    - alone, the player's game runs them, as it always has
//    - a second player arrives: the room carries on from the host's game's
//      gorgons — where they were, as hurt as they were — and the host sees
//      nothing jump
//    - the second player crosses over: both see the same gorgons
//    - they hunt the second player too: the room decides the swing
//    - a gorgon one shoots is hurt on both screens, the room having judged it
//    - the mind flayer runs in the room with them, and summons its gorgons:
//      sworn to it there, and everyone sees them so; shot from far off, it
//      sends them after the shooter
//    - the second player leaves: the gorgons are given back, and carry on
//
//    node lab/test/gorgons.game.test.js     (about two minutes)

const { openRoom, sleep } = require('./harness/page.js');
const FL = require('../../shared/flayers.js');

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
const GORS_ = 'JSON.stringify(gorgons.map((g) => g.live ? [g.slot, +g.x.toFixed(2), +g.z.toFixed(2), Math.round(g.hp), g.dead ? 1 : 0, g.lord || 0] : null))';
const STAND = (x, z) => `(() => { carHitCd = 1e9; for (let r = 0; r < 60; r += 2) for (let k = 0; k < 12; k++) { const sx = ${x} + Math.sin(k * 0.52) * r, sz = ${z} + Math.cos(k * 0.52) * r;
  if (clearAt(sx, sz, 3)) { p.set(sx, EYE, sz); vy = 0; publishState(true); return JSON.stringify([sx, sz]); } } return null; })()`;

(async () => {
  const room = await openRoom({ creatures: true });
  try {
    const A = await room.player({ room: 'gors', nick: 'Aki' });
    const B = await room.player({ room: 'gors', nick: 'Ben' });
    await ev(B, 'window.__t.noRender(); 1');
    await A.join(); await sleep(2000);
    await ev(A, 'window.__t.noRender(); MFS.holdSpawn = true; MFS.spawnCd = 1e9; vecHoldSpawn = true; DOGS.holdSpawn = true; 1');
    await ev(A, 'setWorld(WS.BACK); 1');
    const at = JSON.parse(await ev(A, STAND(11, 10)));
    //  (stocked at once: the district fills a gorgon every few seconds of the game's
    //  own time, which a busy test machine runs slowly — how it fills is the
    //  traces' and server/test/gorgons.test.js's to check)
    await ev(A, 'for (let i = 0; i < 5; i++) GR.spawnGorgon(GORS); 1');
    const stocked = await until(A, 'gorgons.filter((g) => g.live).length >= 4', 20);
    //  (one of them a little hurt, to see it taken as hurt as it was)
    await ev(A, 'gorgons.find((g) => g.live && !g.dead).hp -= 60; 1');
    check('alone, the player\'s game runs the gorgons, as it always has', stocked && await ev(A, 'dogSim() && !MP.srvOwns.d'),
      await ev(A, 'gorgons.filter((g) => g.live).length') + ' gorgons up');

    // ---- a second player: the room carries on from the host's gorgons ------------------
    await ev(A, `(() => { const f = onRoomOwns; onRoomOwns = function (m) {
      if (m.d && !MP.srvOwns.d) { window.__atTake = JSON.parse(${GORS_}); window.__atTakeT = performance.now(); } return f(m); }; return 1; })()`);
    const CR = room.rooms.get('gors').relay.creatures;
    await B.join();
    const taken = (await until(A, 'MP.srvOwns.d && !dogSim()', 10)) && (await until(B, 'MP.srvOwns.d', 10));

    const RD = room.rooms.get('gors').relay.creatures.dogs;
    const before = JSON.parse(await ev(A, 'JSON.stringify(window.__atTake || [])'));
    await sleep(600);
    const [after, since] = JSON.parse(await ev(A, `JSON.stringify([${GORS_.replace('JSON.stringify(', '(')}, (performance.now() - window.__atTakeT) / 1000])`));
    let most = 0, n = 0, hpSame = true;
    before.forEach((g, k) => { const q = after[k]; if (!g || !q || g[4]) return; n++; most = Math.max(most, Math.hypot(q[1] - g[1], q[2] - g[2]) - since * 16.5); });
    for (const t of RD.tookG || []) { const g = before[t[0]]; if (!g || Math.abs(g[3] - t[3]) > 1) hpSame = false; }
    check('a second player arrives: the room carries on from the host\'s gorgons, as hurt as they were, and the host sees nothing jump',
      taken && n >= 4 && most < 1 && hpSame && RD.tookG && RD.tookG.length === before.filter(Boolean).length,
      n + ' gorgons (hp ' + before.filter(Boolean).map((g) => g[3]).join(', ') + '); the most any moved in the ' + since.toFixed(2) + ' s after, beyond what the fastest pounce would take it: ' + Math.max(0, most).toFixed(2) + ' m' +
      (n < 4 ? '; the room took ' + JSON.stringify(RD.tookG) + ', has ' + RD.gorgons.filter((g) => g.live).length + ', sees ' + RD.who.length + ' over there; the host shows ' + after.filter(Boolean).length : ''));

    // ---- the second player crosses over -------------------------------------------
    await ev(B, 'setWorld(WS.BACK); 1');
    const atB = JSON.parse(await ev(B, STAND(at[0] + 4, at[1])));
    await sleep(2000);
    for (let i = 0; i < 30; i++) { if (await ev(A, 'gorgons.filter((g) => g.live).length') === await ev(B, 'gorgons.filter((g) => g.live).length')) break; await sleep(200); }
    const ga = JSON.parse(await ev(A, GORS_)), gb = JSON.parse(await ev(B, GORS_));
    let off = 0, missing = 0, both = 0;
    ga.forEach((g, k) => { if (!g) return; const q = gb[k]; if (!q) { missing++; return; } both++; off = Math.max(off, Math.hypot(q[1] - g[1], q[2] - g[2])); });
    check('over there, both see the same gorgons', missing === 0 && both >= 4 && off < 3, both + ' on both screens, the furthest apart ' + off.toFixed(2) + ' m; ' + missing + ' missing on the second screen');

    // ---- they hunt the second player too ------------------------------------------
    {
      const bx = atB[0], bz = atB[1], idB = await ev(B, 'MP.id');
      await ev(B, 'hp = HP_MAX; window.__gor = 0; const f = onRoomHp; onRoomHp = function (m, s) { if (m.src === \'gor\' || m.src === \'gorpred\') window.__gor++; return f(m, s); }; 1');
      const pl = room.rooms.get('gors').relay.players.get(idB); pl.clawedT = 0;
      const g = RD.gorgons.find((q) => q.live && !q.dead && !q.lord);
      for (const q of RD.gorgons) if (q.live && q !== g && Math.hypot(q.x - bx, q.z - bz) < 80) { q.x += 300 * Math.sign(q.x || 1); q.rx = q.x; }
      let struck = false;
      for (let i = 0; i < 80 && !struck; i++) {
        if (i % 25 === 0) { g.x = g.rx = bx + 2.4; g.z = g.rz = bz; g.y = 0; g.hd = Math.atan2(bx - g.x, bz - g.z); g.atk = null; g.st = 'chase'; g.stT = 0; g.atkCd = 0; g.hasT = true; g.tx = bx; g.tz = bz; g.seeT = RD.t; g.rise = 1; }
        await sleep(100); struck = await ev(B, 'window.__gor > 0');
      }
      check('they hunt the second player too: the room decides the swing, and the player feels it', struck && await ev(B, 'hp < HP_MAX'),
        'hp ' + await ev(B, 'hp') + ', struck ' + await ev(B, 'window.__gor'));
      await ev(B, 'if (dead) { MP.client.publish(mtopic(\'spawn\'), \'{}\'); dead = false; gameoverEl.classList.remove(\'show\'); } hp = HP_MAX; 1');
      g.x += 200; g.rx = g.x;
    }

    // ---- a gorgon shot ---------------------------------------------------------------
    {
      const bx = atB[0], bz = atB[1];
      const g = RD.gorgons.find((q) => q.live && !q.dead && !q.lord);
      const pin = () => { g.x = g.rx = bx + 12; g.z = g.rz = bz; g.y = 0; g.hp = 420; g.st = 'wander'; g.stT = 0; g.hasT = false; g.atk = null; g.rise = 1; };
      pin(); await sleep(400); pin();
      await ev(B, `new Promise((done) => { const g = gorgons[${g.slot}]; const aim = () => { const dx = g.x - p.x, dz = g.z - p.z; yaw = Math.atan2(-dx, -dz); pitch = Math.atan2(g.y + 1.55 - p.y, Math.hypot(dx, dz)); };
        for (const o of dogs) if (o.live) { o.x += 400; o.rx = o.x; }
        aim(); requestAnimationFrame(() => { aim(); requestAnimationFrame(() => { aim(); mode = 'mobile'; fireCd = 0; reloading = 0; ammo = Math.max(ammo, 5); fire(); done(1); }); }); })`);
      await sleep(700);
      const onA = await ev(A, `gorgons[${g.slot}].hp`);
      check('a gorgon the second player shoots is hurt, the room having judged it, on both screens', g.hp === 400 && onA <= 400,
        'the room 420 → ' + g.hp + ', the host\'s screen ' + onA + (room.rooms.get('gors').relay.lastRefusal ? '; last refused: ' + room.rooms.get('gors').relay.lastRefusal : ''));
    }

    // ---- the flayer, in the room with them, summons its gorgons --------------------------------
    {
      for (const q of RD.gorgons) if (q.live && q.lord) q.lord = null;
      const ax = JSON.parse(await ev(A, 'JSON.stringify([p.x, p.z])'));
      const m = FL.spawnFlayer(RD.M, { x: ax[0] + 45, z: ax[1] });
      m.escorted = true; m.summonT = 999;
      const made = FL.summon(RD.M, m, 0, FL.MF_ESC_GOR);
      await sleep(1500);
      const sworn = RD.gorgons.filter((q) => q.live && !q.dead && q.lord === 'mf' && q.lordSlot === m.slot);
      const onB = JSON.parse(await ev(B, GORS_)).filter((q) => q && q[5] === 'mf').length;
      check('the flayer, run by the room with them, summons its gorgons: sworn to it there, and everyone sees them so', made >= 1 && sworn.length === made && onB === sworn.length,
        made + ' summoned, ' + sworn.length + ' sworn to it (the second screen shows ' + onB + ')');
      //  shot from far off: it sends everything about it after the shooter — all in the room now
      const x = m.x + 300, z = m.z;
      FL.hurt(RD.M, m, 20, x, z);
      const sent = sworn.filter((g) => g.hasT && Math.abs(g.tx - x) < 1 && g.st === 'chase');
      check('the flayer, shot from far off, sends its gorgons after the shooter', sent.length === sworn.length && sent.length >= 1, sent.length + ' of ' + sworn.length + ' sent');
      FL.despawnFlayer(RD.M, m);
    }

    // ---- given back --------------------------------------------------------------------
    const last = JSON.parse(await ev(A, GORS_));
    await B.close();
    const back = await until(A, '!MP.srvOwns.d && dogSim()', 10);
    await sleep(1000);
    const now = JSON.parse(await ev(A, GORS_));
    let moved = 0, kept = 0;
    last.forEach((g, k) => { const q = now[k]; if (!g || !q) return; kept++; moved = Math.max(moved, Math.hypot(q[1] - g[1], q[2] - g[2])); });
    check('the second player leaves: the gorgons are given back, and carry on from where they were', back && kept >= 4 && moved < 20,
      kept + ' kept; the most any moved ' + moved.toFixed(1) + ' m (in about a second)');

    const errs = A.errors.concat(B.errors);
    check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  } finally {
    await room.close();
  }
  console.log('\nTHE OTHER SIDE\'S DEMOGORGONS, RUN BY THE ROOM: ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

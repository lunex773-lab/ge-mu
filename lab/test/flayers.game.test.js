'use strict';
//  ============================================================
//  THE OTHER SIDE'S MIND FLAYERS, RUN BY THE ROOM — the real game
//  ============================================================
//  The real game, with the room running the mind flayer (with the dogs and
//  gorgons it commands) once two are here (server/dogs.js, shared/flayers.js
//  — the room's real code, in this process, as the harness runs it). Checked:
//
//    - alone, the player's game runs it, as it always has
//    - a second player arrives: the room carries on from the host's game's
//      flayer — where it was, as hurt as it was — and the host sees nothing jump
//    - the second player crosses over: both see the same flayer
//    - it hunts the second player too: the room decides the blow, and the
//      player is knocked back by it (the room says how far, the game does it)
//    - and the host sees the swing it was: the same attack, played out there
//    - a flayer the second player shoots is hurt on both screens, the room
//      having judged it
//    - it throws a car: the second player sees it fly, and it lies where the
//      room says it came down
//    - the host's VECNA still orders it about: the room hears it
//    - its escort is its own, in the room: it summons them, and everyone sees them
//    - the second player leaves: the flayer is given back, and carries on
//
//    node lab/test/flayers.game.test.js     (about two minutes)

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
const MF_ = 'JSON.stringify(flayers.map((m) => m.live ? [m.slot, +m.x.toFixed(2), +m.z.toFixed(2), Math.round(m.hp), m.dead ? 1 : 0, m.st, m.atk ? m.atk.kind : 0] : null))';
const STAND = (x, z) => `(() => { carHitCd = 1e9; for (let r = 0; r < 60; r += 2) for (let k = 0; k < 12; k++) { const sx = ${x} + Math.sin(k * 0.52) * r, sz = ${z} + Math.cos(k * 0.52) * r;
  if (clearAt(sx, sz, 3)) { p.set(sx, EYE, sz); vy = 0; publishState(true); return JSON.stringify([sx, sz]); } } return null; })()`;

(async () => {
  const room = await openRoom({ creatures: true });
  try {
    const A = await room.player({ room: 'mfs', nick: 'Aki' });
    const B = await room.player({ room: 'mfs', nick: 'Ben' });
    await ev(B, 'window.__t.noRender(); 1');
    await A.join(); await sleep(2000);
    await ev(A, 'window.__t.noRender(); MFS.holdSpawn = true; MFS.spawnCd = 1e9; vecHoldSpawn = true; DOGS.holdSpawn = true; GORS.holdSpawn = true; 1');
    await ev(A, 'setWorld(WS.BACK); 1');
    const at = JSON.parse(await ev(A, STAND(11, 10)));
    //  one, 70 m off, standing about with nothing to hunt, a little hurt
    await ev(A, `(() => { const m = spawnFlayer({ x: p.x + 70, z: p.z }); m.escorted = true; m.summonT = 999; m.hp -= 140; m.hasT = false; m.st = 'wander'; return 1; })()`);
    const up = await until(A, 'flayers.some((m) => m.live && !m.dead)', 5);
    await sleep(500);
    check('alone, the player\'s game runs the flayer, as it always has', up && await ev(A, 'dogSim() && !MP.srvOwns.d && flayers.find((m) => m.live).hp === 4060'),
      await ev(A, MF_));

    // ---- a second player: the room carries on from the host's flayer ------------------
    await ev(A, `(() => { const f = onRoomOwns; onRoomOwns = function (m) {
      if (m.d && !MP.srvOwns.d) { window.__atTake = JSON.parse(${MF_}); window.__atTakeT = performance.now(); } return f(m); }; return 1; })()`);
    const RM = room.rooms.get('mfs').relay;
    const CR = RM.creatures;
    await B.join();
    const taken = (await until(A, 'MP.srvOwns.d && !dogSim()', 10)) && (await until(B, 'MP.srvOwns.d', 10));
    const RD = CR.dogs;
    RD.D.holdSpawn = true; RD.G.holdSpawn = true; RD.M.holdSpawn = true;
    const before = JSON.parse(await ev(A, 'JSON.stringify(window.__atTake || [])'));
    await sleep(600);
    const [after, since] = JSON.parse(await ev(A, `JSON.stringify([${MF_.replace('JSON.stringify(', '(')}, (performance.now() - window.__atTakeT) / 1000])`));
    const b0 = before.find(Boolean), a0 = after.find(Boolean), took = (RD.tookF || [])[0];
    const jump = b0 && a0 ? Math.hypot(a0[1] - b0[1], a0[2] - b0[2]) - since * 6.2 : 99;
    check('a second player arrives: the room carries on from the host\'s flayer, as hurt as it was, and the host sees nothing jump',
      taken && took && b0 && Math.abs(took[3] - b0[3]) <= 1 && jump < 1,
      'hp ' + (b0 && b0[3]) + ' → the room\'s ' + (took && took[3]) + '; it moved ' + (b0 && a0 ? Math.hypot(a0[1] - b0[1], a0[2] - b0[2]).toFixed(2) : '-') + ' m in the ' + since.toFixed(2) + ' s after');

    // ---- the second player crosses over -------------------------------------------
    await ev(B, 'setWorld(WS.BACK); 1');
    const atB = JSON.parse(await ev(B, STAND(at[0] + 4, at[1])));
    await sleep(1500);
    await until(B, 'flayers.some((m) => m.live)', 5);
    await sleep(500);
    const fa = JSON.parse(await ev(A, MF_)).find(Boolean), fb = JSON.parse(await ev(B, MF_)).find(Boolean);
    check('over there, both see the same flayer', fa && fb && fa[0] === fb[0] && Math.hypot(fa[1] - fb[1], fa[2] - fb[2]) < 3 && fa[3] === fb[3],
      JSON.stringify(fa) + ' / ' + JSON.stringify(fb));

    const mf = RD.flayers.find((m) => m.live);
    const idB = await ev(B, 'MP.id');
    // ---- it hunts the second player too; the host sees the swing -------------------------------
    {
      //  (the host well off to one side: the second player is the one it is set on)
      JSON.parse(await ev(A, STAND(atB[0] - 150, atB[1])));
      const bx = atB[0], bz = atB[1];
      await ev(B, 'hp = HP_MAX; window.__mf = []; const f = onRoomHp; onRoomHp = function (m, s) { if (m.src === \'mf\') window.__mf.push([m.kb, +p.x.toFixed(2), +p.z.toFixed(2)]); return f(m, s); }; 1');
      const set = () => { const a = Math.atan2(mf.x - bx, mf.z - bz); mf.x = mf.rx = bx + Math.sin(a) * 13; mf.z = mf.rz = bz + Math.cos(a) * 13; mf.hd = Math.atan2(bx - mf.x, bz - mf.z); mf.atk = null; mf.st = 'track'; mf.stT = 0; mf.atkCd = 0; mf.hasT = true; mf.tx = bx; mf.tz = bz; mf.seeT = RD.t; mf.panicked = false; };
      set();
      let struck = null, same = 0, seenRoom = 0;
      for (let i = 0; i < 120 && !struck; i++) {
        if (i % 40 === 39) set();
        await sleep(100);
        const s = JSON.parse(await ev(B, 'JSON.stringify([window.__mf.length ? window.__mf[0] : null, +p.x.toFixed(2), +p.z.toFixed(2)])'));
        if (s[0]) struck = s;
        if (mf.atk) {
          seenRoom++;
          const onA = JSON.parse(await ev(A, `JSON.stringify(flayers[${mf.slot}].atk ? flayers[${mf.slot}].atk.kind : 0)`));
          if (onA === mf.atk.kind) same++;
        }
      }
      const kb = struck && struck[0][0];
      const moved = struck ? Math.hypot(struck[1] - bx, struck[2] - bz) : 0;
      check('it hunts the second player too: the room decides the blow, and the player is knocked back by it', struck && Array.isArray(kb) && await ev(B, 'hp < HP_MAX') && moved > 1,
        'hp ' + await ev(B, 'hp') + (struck ? ', told ' + JSON.stringify(struck[0]) + ', moved ' + moved.toFixed(1) + ' m from where they stood' : ''));
      check('and the host sees the swing as it was: the same attack, played out on its screen', seenRoom > 0 && same >= seenRoom * 0.6, same + ' of ' + seenRoom + ' looks matched');
      await ev(B, 'if (dead) { MP.client.publish(mtopic(\'spawn\'), \'{}\'); dead = false; gameoverEl.classList.remove(\'show\'); } hp = HP_MAX; 1');
    }

    // ---- a flayer shot --------------------------------------------------------------
    {
      const bxz = JSON.parse(await ev(B, STAND(atB[0], atB[1])));
      const pin = () => { mf.x = mf.rx = bxz[0] + 28; mf.z = mf.rz = bxz[1]; mf.hp = 4000; mf.st = 'wander'; mf.stT = 0; mf.hasT = false; mf.atk = null; mf.wanderT = 99; mf.wx = mf.x; mf.wz = mf.z; };
      pin(); await sleep(500); pin(); await sleep(300); pin();
      await ev(B, `new Promise((done) => { const m = flayers[${mf.slot}]; const aim = () => { const dx = m.x - p.x, dz = m.z - p.z; yaw = Math.atan2(-dx, -dz); pitch = Math.atan2(m.y + M_BODY_Y - p.y, Math.hypot(dx, dz)); };
        for (const o of dogs) if (o.live) { o.x += 400; o.rx = o.x; } for (const o of gorgons) if (o.live) { o.x += 400; o.rx = o.x; }
        aim(); requestAnimationFrame(() => { aim(); requestAnimationFrame(() => { aim(); mode = 'mobile'; fireCd = 0; reloading = 0; ammo = Math.max(ammo, 5); fire(); done(1); }); }); })`);
      await sleep(800);
      const onA = await ev(A, `flayers[${mf.slot}].hp`);
      check('a flayer the second player shoots is hurt, the room having judged it, on both screens', mf.hp === 3980 && onA <= 3980,
        'the room 4000 → ' + mf.hp + ', the host\'s screen ' + onA + (RM.lastRefusal ? '; last refused: ' + RM.lastRefusal : ''));
    }

    // ---- a car ----------------------------------------------------------------------
    {
      const bxz = JSON.parse(await ev(B, STAND(atB[0], atB[1])));
      await ev(B, 'window.__fly = []; const f = onMfFlight; onMfFlight = function (r) { if (r) window.__fly.push(r[0]); return f(r); }; 1');
      //  one lying 20–60 m from them, the flayer beside it
      let k = -1;
      for (let q = 0; q < RD.wrecks.length && k < 0; q++) { const w = RD.wrecks[q]; if (w && !w.thrown && !w.held) { const d = Math.hypot(w.x - bxz[0], w.z - bxz[1]); if (d > 25 && d < 60) k = q; } }
      const w = RD.wrecks[k], wx = w.x, wz = w.z;
      const a = Math.atan2(wx - bxz[0], wz - bxz[1]);
      mf.x = mf.rx = wx + Math.sin(a) * 9; mf.z = mf.rz = wz + Math.cos(a) * 9; mf.hd = Math.atan2(bxz[0] - mf.x, bxz[1] - mf.z);
      mf.hasT = true; mf.tx = bxz[0]; mf.tz = bxz[1]; mf.seeT = RD.t; mf.st = 'track'; mf.atkCd = 99; mf.atk = null;
      mf.holdW = k; FL.startAtk(RD.M, mf, 'throw');
      let down = false;
      for (let i = 0; i < 60 && !down; i++) { await sleep(100); down = !RD.M.thrown && !(mf.atk && mf.atk.kind === 'throw' && mf.atk.t < 1.5) && Math.hypot(w.x - wx, w.z - wz) > 3; }
      await sleep(600);
      const onB = JSON.parse(await ev(B, `JSON.stringify([wrecks[${k}].x, wrecks[${k}].z, !!wrecks[${k}].thrown, window.__fly.filter((q) => q === ${k}).length])`));
      check('it throws a car: the second player sees it fly, and it lies where the room says it came down', down && onB[3] >= 1 && !onB[2] && Math.hypot(onB[0] - w.x, onB[1] - w.z) < 0.1,
        'the room moved it ' + Math.hypot(w.x - wx, w.z - wz).toFixed(1) + ' m; the second screen heard it in the air ' + onB[3] + ' times, has it ' + Math.hypot(onB[0] - w.x, onB[1] - w.z).toFixed(2) + ' m from the room\'s');
    }

    // ---- VECNA (the host's) orders it about ------------------------------------------------
    {
      //  (what the room's flayer is, the moment the orders are made so — a moment later it may see someone for itself)
      const heard = [];
      let then = null;
      { const f = CR.dogOrders.bind(CR); CR.dogOrders = (from, p) => { for (const o of p.o || []) heard.push(o); const r = f(from, p); if ((p.o || []).some((o) => o[0] === 'ft')) then = [mf.st, mf.panicked, mf.tx, mf.tz]; return r; }; }
      mf.atk = null; mf.st = 'flee'; mf.panicked = true; mf.fleeT = 20;
      await sleep(400);
      const to = JSON.parse(await ev(A, `(() => { const m = flayers[${mf.slot}]; const x = p.x + 5, z = p.z - 5;
        withOrders(() => { m.hasT = true; m.tx = x; m.tz = z; m.seeT = cityT; m.panicked = false; m.st = 'track'; m.stT = 0; });
        return JSON.stringify([x, z]); })()`));
      await sleep(400);
      check('the host\'s VECNA still orders it about: the room hears it, and it turns', heard.some((o) => o[0] === 'ft') && heard.some((o) => o[0] === 'fk') && then && then[0] === 'track' && !then[1] && Math.abs(then[2] - to[0]) < 0.1,
        'heard ' + heard.map((o) => o[0]).join(',') + '; the room\'s ' + JSON.stringify(then));
    }

    // ---- its escort is its own, in the room ---------------------------------------------
    {
      //  (a district full of dogs has no room for more: a few far off are let go first, as in the game)
      for (const q of RD.dogs.filter((q) => q.live && !q.lord && Math.hypot(q.x - mf.x, q.z - mf.z) > 100).slice(0, 6)) require('../../shared/dogs.js').despawnDog(RD.D, q);
      for (const q of RD.dogs) if (q.live && q.lord === 'mf') q.lord = null;
      mf.claimT = 99;                                   // (and it is not left to claim the loose ones about it meanwhile)
      const n = FL.summon(RD.M, mf, FL.MF_ESC_DOG, 0);
      await sleep(1500);
      const sworn = RD.dogs.filter((q) => q.live && !q.dead && q.lord === 'mf' && q.lordSlot === mf.slot);
      const onB = await ev(B, `dogs.filter((d) => d.live && !d.dead && d.lord === 'mf').length`);
      check('its escort is its own, in the room: it summons them, and everyone sees them sworn to it', n >= 1 && sworn.length === n && onB === sworn.length,
        n + ' summoned, ' + sworn.length + ' sworn to it (the second screen shows ' + onB + ')');
    }

    // ---- given back --------------------------------------------------------------------
    const last = JSON.parse(await ev(A, MF_)).find(Boolean);
    await B.close();
    const back = await until(A, '!MP.srvOwns.d && dogSim()', 10);
    await sleep(1000);
    const now = JSON.parse(await ev(A, MF_)).find(Boolean);
    const moved = last && now ? Math.hypot(now[1] - last[1], now[2] - last[2]) : 99;
    check('the second player leaves: the flayer is given back, and carries on from where it was', back && now && now[3] === last[3] && moved < 12,
      JSON.stringify(last) + ' → ' + JSON.stringify(now) + '; moved ' + moved.toFixed(1) + ' m (in about a second)');

    const errs = A.errors.concat(B.errors);
    check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  } finally {
    await room.close();
  }
  console.log('\nTHE OTHER SIDE\'S MIND FLAYERS, RUN BY THE ROOM: ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

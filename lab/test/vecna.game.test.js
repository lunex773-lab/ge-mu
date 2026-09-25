'use strict';
//  ============================================================
//  VECNA, RUN BY THE ROOM — the real game
//  ============================================================
//  The real game, with the room running VECNA (beside the dogs, gorgons and
//  flayers he commands) once two are here (server/dogs.js, shared/vecna.js —
//  the room's real code, in this process, as the harness runs it). Checked:
//
//    - alone, the player's game runs him, as it always has
//    - a second player arrives: the room carries on from the host's game's
//      VECNA — where he was, as hurt as he was — and the host sees nothing jump
//    - the second player crosses over: both see the same VECNA
//    - he goes for the second player: the room decides the blow, and the
//      player is thrown by it (the room says how far and how high, the game
//      does it); and the host sees the swing it was
//    - the second player shoots him: he is hurt on both screens, the room
//      having judged it
//    - he takes hold of the second player from across the street: their game
//      lifts and drags them, the room does the harm, and lets go
//    - he takes up a car and throws it: the second player sees it circle him,
//      fly, and lie where the room says it came down
//    - killed: both screens see him fall
//    - the second player leaves: VECNA is given back, and carries on
//
//    node lab/test/vecna.game.test.js     (about two minutes)

const { openRoom, sleep } = require('./harness/page.js');
const VC = require('../../shared/vecna.js');

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
const VEC_ = 'JSON.stringify(vec.live ? [+vec.x.toFixed(2), +vec.z.toFixed(2), Math.round(vec.hp), vec.dead ? 1 : 0, vec.st, vec.atk ? vec.atk.kind : 0, vec.phase] : null)';
const STAND = (x, z) => `(() => { carHitCd = 1e9; for (let r = 0; r < 60; r += 2) for (let k = 0; k < 12; k++) { const sx = ${x} + Math.sin(k * 0.52) * r, sz = ${z} + Math.cos(k * 0.52) * r;
  if (clearAt(sx, sz, 3)) { p.set(sx, EYE, sz); vy = 0; publishState(true); return JSON.stringify([sx, sz]); } } return null; })()`;

(async () => {
  const room = await openRoom({ creatures: true });
  try {
    const A = await room.player({ room: 'vecs', nick: 'Aki' });
    const B = await room.player({ room: 'vecs', nick: 'Ben' });
    await ev(B, 'window.__t.noRender(); 1');
    await A.join(); await sleep(2000);
    await ev(A, 'window.__t.noRender(); VS.holdSpawn = true; VS.spawnCd = 1e9; MFS.holdSpawn = true; MFS.spawnCd = 1e9; DOGS.holdSpawn = true; GORS.holdSpawn = true; 1');
    await ev(A, 'setWorld(WS.BACK); 1');
    const at = JSON.parse(await ev(A, STAND(11, 10)));
    //  him, 70 m off, dormant, looking away, a little hurt
    await ev(A, `(() => { let s = null;
      for (let r = 0; r < 40 && !s; r += 2) for (let k = 0; k < 12 && !s; k++) { const sx = p.x + 70 + Math.sin(k * 0.52) * r, sz = p.z + Math.cos(k * 0.52) * r; if (clearAt(sx, sz, 3)) s = { x: sx, z: sz }; }
      spawnVecna(s); vec.hp -= 140; vec.hd = Math.atan2(s.x - p.x, s.z - p.z); vec.hasT = false; return 1; })()`);
    const up = await until(A, 'vec.live && !vec.dead', 5);
    await sleep(500);
    check('alone, the player\'s game runs VECNA, as it always has', up && await ev(A, `dogSim() && !MP.srvOwns.d && vec.hp === ${VC.V_HP - 140}`),
      await ev(A, VEC_));

    // ---- a second player: the room carries on from the host's VECNA ------------------
    await ev(A, `(() => { const f = onRoomOwns; onRoomOwns = function (m) {
      if (m.d && !MP.srvOwns.d) { window.__atTake = JSON.parse(${VEC_}); window.__atTakeT = performance.now(); } return f(m); }; return 1; })()`);
    const RM = room.rooms.get('vecs').relay;
    const CR = RM.creatures;
    await B.join();
    const taken = (await until(A, 'MP.srvOwns.d && !dogSim()', 10)) && (await until(B, 'MP.srvOwns.d', 10));
    const RD = CR.dogs;
    RD.D.holdSpawn = true; RD.G.holdSpawn = true; RD.M.holdSpawn = true; RD.V.holdSpawn = true;
    const before = JSON.parse(await ev(A, 'JSON.stringify(window.__atTake || null)'));
    await sleep(600);
    const [after, since] = JSON.parse(await ev(A, `JSON.stringify([${VEC_.replace('JSON.stringify(', '(')}, (performance.now() - window.__atTakeT) / 1000])`));
    const took = RD.tookV;
    const jump = before && after ? Math.hypot(after[0] - before[0], after[1] - before[1]) - since * 2.6 : 99;
    check('a second player arrives: the room carries on from the host\'s VECNA, as hurt as he was, and the host sees nothing jump',
      taken && took && before && Math.abs(took[2] - before[2]) <= 1 && jump < 1,
      'hp ' + (before && before[2]) + ' → the room\'s ' + (took && took[2]) + '; he moved ' + (before && after ? Math.hypot(after[0] - before[0], after[1] - before[1]).toFixed(2) : '-') + ' m in the ' + since.toFixed(2) + ' s after');

    // ---- the second player crosses over -------------------------------------------
    await ev(B, 'setWorld(WS.BACK); 1');
    const atB = JSON.parse(await ev(B, STAND(at[0] + 4, at[1])));
    await sleep(1500);
    await until(B, 'vec.live', 5);
    await sleep(500);
    const va = JSON.parse(await ev(A, VEC_)), vb = JSON.parse(await ev(B, VEC_));
    check('over there, both see the same VECNA', va && vb && Math.hypot(va[0] - vb[0], va[1] - vb[1]) < 3 && va[2] === vb[2],
      JSON.stringify(va) + ' / ' + JSON.stringify(vb));

    const rv = RD.vec;
    const idB = await ev(B, 'MP.id');
    const tB = () => RD.byId.get(idB);
    //  (a place n m from the second player from which he can see them)
    const inSight = (n) => {
      const t = tB(), E = RD.V.env, v0 = [rv.x, rv.z, rv.hd, rv.y];
      for (let k = 0; k < 48; k++) {
        const a = k * 0.4, x = t.x + Math.sin(a) * n, z = t.z + Math.cos(a) * n;
        if (!E.clearAt(x, z, 2)) continue;
        rv.x = x; rv.z = z; rv.y = E.supportHeight(x, z, 1); rv.hd = Math.atan2(t.x - x, t.z - z);
        const ok = VC.sees(RD.V, t);
        rv.x = v0[0]; rv.z = v0[1]; rv.hd = v0[2]; rv.y = v0[3];
        if (ok) return { x, z };
      }
      return null;
    };
    const put = (s, keep) => { rv.x = rv.rx = s.x; rv.z = rv.rz = s.z; rv.y = RD.V.env.supportHeight(s.x, s.z, 1); const t = tB(); rv.hd = Math.atan2(t.x - s.x, t.z - s.z); if (!keep) rv.atk = null; };
    const hunt = () => Object.assign(rv, { awake: true, st: 'hunt', stT: 0, hasT: true, tx: tB().x, tz: tB().z, seeT: RD.t, mentalT: 99, summonCd: 99, blinkCd: 99, cmdT: 99 });
    const heal = async () => {
      await ev(B, 'if (dead) { MP.client.publish(mtopic(\'spawn\'), \'{}\'); dead = false; gameoverEl.classList.remove(\'show\'); } hp = HP_MAX; 1');
      const pl = RM.players.get(idB); pl.hp = 100; pl.dead = false;
    };

    // ---- he goes for the second player; the host sees the swing -------------------------------
    {
      //  (the host well off to one side: the second player is the one he is set on)
      JSON.parse(await ev(A, STAND(atB[0] - 150, atB[1])));
      await sleep(600);
      await ev(B, 'hp = HP_MAX; window.__vb = []; const f = onRoomHp; onRoomHp = function (m, s) { if (m.src === \'vec\') window.__vb.push([m.k, m.kb, m.up, +p.x.toFixed(2), +p.z.toFixed(2), +p.y.toFixed(2)]); return f(m, s); }; 1');
      const bx = await ev(B, 'p.x'), bz = await ev(B, 'p.z');
      const s1 = inSight(7);
      const set = () => { put(s1); hunt(); rv.atkCd = 0; };
      set();
      let struck = null, same = 0, seenRoom = 0;
      for (let i = 0; i < 120 && !struck; i++) {
        if (i % 40 === 39) set();
        await sleep(100);
        const s = JSON.parse(await ev(B, 'JSON.stringify(window.__vb.length ? window.__vb[0] : null)'));
        if (s) struck = s;
        if (rv.atk) {
          seenRoom++;
          const onA = JSON.parse(await ev(A, 'JSON.stringify(vec.atk ? vec.atk.kind : 0)'));
          if (onA === rv.atk.kind) same++;
        }
      }
      await sleep(400);
      const [hpB, px, pz] = JSON.parse(await ev(B, 'JSON.stringify([hp, p.x, p.z])'));
      const moved = Math.hypot(px - bx, pz - bz);
      check('he goes for the second player: the room decides the blow, and the player is thrown by it', struck && Array.isArray(struck[1]) && struck[2] > 0 && hpB < 100 && moved > 1,
        'hp ' + hpB + (struck ? ', told ' + JSON.stringify(struck.slice(0, 3)) + ', thrown ' + moved.toFixed(1) + ' m from where they stood' : ''));
      check('and the host sees the swing as it was: the same attack, played out on its screen', seenRoom > 0 && same >= seenRoom * 0.6, same + ' of ' + seenRoom + ' looks matched');
      rv.atk = null; rv.atkCd = 99;
      await heal();
    }

    // ---- he is shot ------------------------------------------------------------------
    {
      JSON.parse(await ev(B, STAND(atB[0], atB[1])));
      await sleep(400);
      const s2 = inSight(28) || inSight(24);
      const pin = () => { put(s2); Object.assign(rv, { hp: 12000, st: 'dormant', stT: 0, awake: false, hasT: false, vuln: 0, atk: null, atkCd: 99, blinkCd: 99, hd: rv.hd + Math.PI }); };
      pin(); await sleep(500); pin(); await sleep(300); pin();
      await ev(B, `new Promise((done) => { const aim = () => { const dx = vec.x - p.x, dz = vec.z - p.z; yaw = Math.atan2(-dx, -dz); pitch = Math.atan2(vec.y + V_HIP + 0.98 + vec.hover * 1.45 - p.y, Math.hypot(dx, dz)); };
        for (const o of dogs) if (o.live) { o.x += 400; o.rx = o.x; } for (const o of gorgons) if (o.live) { o.x += 400; o.rx = o.x; } for (const o of flayers) if (o.live) { o.x += 400; o.rx = o.x; }
        aim(); requestAnimationFrame(() => { aim(); requestAnimationFrame(() => { aim(); mode = 'mobile'; fireCd = 0; reloading = 0; ammo = Math.max(ammo, 5); fire(); done(1); }); }); })`);
      await sleep(800);
      const onA = await ev(A, 'vec.hp');
      check('the second player shoots him: he is hurt, the room having judged it, on both screens', rv.hp === 12000 - 20 && onA <= 12000 - 20,
        'the room 12000 → ' + rv.hp + ', the host\'s screen ' + onA + (RM.lastRefusal ? '; last refused: ' + RM.lastRefusal : ''));
    }

    // ---- his grip -----------------------------------------------------------------------
    {
      await heal();
      JSON.parse(await ev(B, STAND(atB[0], atB[1])));
      await sleep(400);
      await ev(B, 'window.__held = []; 1');
      const s3 = inSight(22) || inSight(18);
      put(s3); hunt();
      rv.hp = VC.V_HP * 0.5; rv.phase = 2; rv.vuln = 0; rv.atkCd = 99;
      await sleep(200);
      const hp0 = RM.players.get(idB).hp;
      put(s3); hunt(); rv.atk = null; rv.atkCd = 99; VC.startAtk(RD.V, 'grab');
      let held = false, room = false, lifted = 0, let_go = false;
      const y0 = await ev(B, 'p.y');
      for (let i = 0; i < 60 && !let_go; i++) {
        put(s3, true);
        await sleep(100);
        const s = JSON.parse(await ev(B, 'JSON.stringify([!!psyHold, !!(psyHold && psyHold.room), p.y])'));
        if (s[0]) { held = true; room = room || s[1]; lifted = Math.max(lifted, s[2] - y0); }
        else if (held) let_go = true;
      }
      await sleep(400);
      const hp1 = RM.players.get(idB).hp;
      check('he takes hold of the second player from across the street: their game lifts them, the room does the harm (' + VC.V_GRAB_DMG + '), and he lets go',
        held && room && lifted > 1 && hp0 - hp1 === VC.V_GRAB_DMG && let_go && !tB().pl.grip,
        'held ' + held + ' (the room\'s ' + room + '), lifted ' + lifted.toFixed(1) + ' m, hp ' + hp0 + ' → ' + hp1 + ', let go ' + let_go);
      rv.hp = 12000; rv.phase = 0; rv.atk = null; rv.atkCd = 99;
      await sleep(300);
      await heal();
    }

    // ---- a car ----------------------------------------------------------------------
    {
      JSON.parse(await ev(B, STAND(atB[0], atB[1])));
      await sleep(400);
      await ev(B, 'window.__vo = []; window.__vf = []; const f = onVecOrbit; onVecOrbit = function (r) { if (r) for (let i = 0; i + 6 < r.length; i += 7) window.__vo.push(r[i]); return f(r); }; const g = onVecFlights; onVecFlights = function (r) { if (r) for (let i = 0; i + 8 < r.length; i += 9) window.__vf.push(r[i]); return g(r); }; 1');
      const s4 = inSight(30) || inSight(26);
      put(s4); hunt(); rv.atkCd = 99; rv.orbit.length = 0;
      //  (one lying beside him, far enough from them)
      const t = tB();
      let k = -1;
      for (let q = 0; q < RD.wrecks.length && k < 0; q++) { const w = RD.wrecks[q]; if (w && !w.thrown && !w.held && Math.hypot(w.x - t.x, w.z - t.z) > 60) k = q; }
      const w = RD.wrecks[k];
      w.x = rv.x + 9; w.z = rv.z; w.y = RD.V.env.supportHeight(w.x, w.z, 1);
      const got = VC.lift(RD.V, 1);
      let seen = false;
      for (let i = 0; i < 20 && !seen; i++) { put(s4, true); await sleep(100); seen = await ev(B, `vec.orbit.some((o) => o.k === ${k}) && !!wrecks[${k}].held`); }
      const kk = rv.orbit.length ? rv.orbit[0].k : -1;
      rv.atkCd = 0; VC.startAtk(RD.V, 'hurl');
      let down = false;
      for (let i = 0; i < 80 && !down; i++) { put(s4, true); await sleep(100); down = !RD.V.thrown.length && !(rv.atk && rv.atk.kind === 'hurl') && !w.held; }
      rv.atkCd = 99;
      await sleep(900);
      const onB = JSON.parse(await ev(B, `JSON.stringify([wrecks[${k}].x, wrecks[${k}].z, !!wrecks[${k}].thrown, !!wrecks[${k}].held, window.__vo.filter((q) => q === ${k}).length, window.__vf.filter((q) => q === ${k}).length])`));
      check('he takes up a car and throws it: the second player sees it circle him, fly, and lie where the room says it came down',
        got === 1 && kk === k && seen && down && onB[5] >= 1 && !onB[2] && !onB[3] && Math.hypot(onB[0] - w.x, onB[1] - w.z) < 0.1,
        'circling on their screen ' + seen + ', told in the air ' + onB[5] + ' times; the room has it ' + Math.hypot(w.x - t.x, w.z - t.z).toFixed(1) + ' m from them, the second screen ' + Math.hypot(onB[0] - w.x, onB[1] - w.z).toFixed(2) + ' m from the room\'s');
      await heal();
    }

    // ---- killed ---------------------------------------------------------------------
    {
      JSON.parse(await ev(B, STAND(atB[0], atB[1])));
      await sleep(400);
      const s5 = inSight(28) || inSight(24);
      const pin = () => { put(s5); Object.assign(rv, { hp: 5, st: 'dormant', stT: 0, awake: false, hasT: false, vuln: 0, atk: null, atkCd: 99, blinkCd: 99, hd: rv.hd + Math.PI }); };
      pin(); await sleep(500); pin(); await sleep(300); pin();
      await ev(B, `new Promise((done) => { const aim = () => { const dx = vec.x - p.x, dz = vec.z - p.z; yaw = Math.atan2(-dx, -dz); pitch = Math.atan2(vec.y + V_HIP + 0.98 + vec.hover * 1.45 - p.y, Math.hypot(dx, dz)); };
        aim(); requestAnimationFrame(() => { aim(); requestAnimationFrame(() => { aim(); mode = 'mobile'; fireCd = 0; reloading = 0; ammo = Math.max(ammo, 5); fire(); done(1); }); }); })`);
      await sleep(900);
      const onA = await ev(A, 'vec.live && vec.dead'), onB = await ev(B, 'vec.live && vec.dead');
      check('killed: both screens see him fall', rv.dead && onA && onB, 'the room ' + (rv.dead ? 'dead' : 'alive, hp ' + rv.hp) + ', the host\'s screen ' + onA + ', the second ' + onB);
      //  (and cleared, as some while later: then another comes)
      VC.clearVecna(RD.V);
      await until(A, '!vec.live', 3); await until(B, '!vec.live', 3);
    }

    // ---- given back --------------------------------------------------------------------
    {
      const t = tB();
      let s = null;
      for (let k = 0; k < 48 && !s; k++) { const x = t.x + 60 + Math.sin(k * 0.5) * (k % 8) * 3, z = t.z + Math.cos(k * 0.5) * (k % 8) * 3; if (RD.V.env.clearAt(x, z, 3)) s = { x, z }; }
      VC.spawnVecna(RD.V, s);
      rv.hp = VC.V_HP - 900; rv.hd = Math.atan2(s.x - t.x, s.z - t.z); rv.hasT = false;
      await until(A, 'vec.live && !vec.dead', 3);
      await sleep(600);
    }
    const last = JSON.parse(await ev(A, VEC_));
    await B.close();
    const back = await until(A, '!MP.srvOwns.d && dogSim()', 10);
    await sleep(1000);
    const now = JSON.parse(await ev(A, VEC_));
    const moved = last && now ? Math.hypot(now[0] - last[0], now[1] - last[1]) : 99;
    check('the second player leaves: VECNA is given back, and carries on from where he was', back && now && now[2] === last[2] && !now[3] && moved < 6,
      JSON.stringify(last) + ' → ' + JSON.stringify(now) + '; moved ' + moved.toFixed(1) + ' m (in about a second)');

    const errs = A.errors.concat(B.errors);
    check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  } finally {
    await room.close();
  }
  console.log('\nVECNA, RUN BY THE ROOM: ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

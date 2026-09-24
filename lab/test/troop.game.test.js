'use strict';
//  ============================================================
//  THE MONKEY TROOP, RUN BY THE ROOM — handed over and back, and shot at
//  ============================================================
//  The real game, with the room running the troop once two are here
//  (server/creatures.js, server/troop.js, shared/troop.js — the room's real
//  code, in this process, as the harness runs it). Checked:
//
//    - alone, the player's game runs the troop, as it always has
//    - a second player arrives: the room takes it over, from where it was;
//      the host's game stops running it and stops sending it
//    - both see the monkeys in the same places
//    - a shot at a monkey lands on the room's word, both see it, and the
//      whole troop turns on both screens
//    - taken down: gone on both screens, and it counts towards the tear for
//      whoever shot it
//    - the second player leaves: the room gives the troop back, and the game
//      carries on from where it was
//
//    node lab/test/troop.game.test.js     (about a minute and a half)

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
const TROOP = 'JSON.stringify(monkeyPeds.map((m) => TR.inPlay(m) ? [m.mi, +m.wx.toFixed(1), +m.wz.toFixed(1), m.hp] : null).filter(Boolean))';
//  stand 9 m from monkey i, in the open, with a clear line to it (the walkers,
//  and any other monkey near, step out of the way) …
const PLACE = (i) => `(() => { mode = 'mobile'; carHitCd = 1e9; hp = HP_MAX; dead = false;
  for (const e of peds) if (!e.isMonkey) e.wx += 500;
  const m = monkeyPeds[${i}], ro = new THREE.Vector3(), rd = new THREE.Vector3();
  for (let k = 0; k < 32; k++) { const a = k * 0.196, x = m.wx + Math.sin(a) * 9, z = m.wz + Math.cos(a) * 9;
    if (!clearAt(x, z, 0.8)) continue;
    ro.set(x, EYE, z); rd.set(m.wx - x, 1.05 - EYE, m.wz - z); const L = rd.length(); rd.normalize();
    if (rayCity(ro, rd, L) < L - 0.5) continue;
    p.set(x, EYE, z); vy = 0; publishState(true); return 1; }
  return 0; })()`;
//  … then face it where it is now, let the camera catch up (fire() shoots from
//  the camera, which follows the player each frame), and fire
const FIRE = (i) => `new Promise((done) => { const m = monkeyPeds[${i}];
  for (const o of monkeyPeds) if (o !== m && TR.inPlay(o) && Math.hypot(o.wx - p.x, o.wz - p.z) < 14) { o.wx += 40; o.netX = o.wx; o.rx = o.wx; }
  const aim = () => { const dx = m.wx - p.x, dz = m.wz - p.z; yaw = Math.atan2(-dx, -dz); pitch = Math.atan2(1.0 - p.y, Math.hypot(dx, dz)); };
  aim(); requestAnimationFrame(() => { aim(); requestAnimationFrame(() => { aim(); requestAnimationFrame(() => {
    fireCd = 0; reloading = 0; ammo = Math.max(ammo, 5); fire(); done(1); }); }); }); })`;
async function shoot(P, i) { const ok = await ev(P, PLACE(i)); await sleep(300); return ok && (await ev(P, FIRE(i))); }

(async () => {
  const room = await openRoom({ creatures: true });
  try {
    const A = await room.player({ room: 'troop', nick: 'Aki' });
    await A.join(); await sleep(2500);
    const solo = await ev(A, 'troopSim() && !MP.srvOwns.m');
    check('alone, the player\'s game runs the troop, as it always has', solo);

    // ---- a second player: the room takes it ------------------------------------------
    //  where A's game had them when the room's word came
    await ev(A, `(() => { const f = onRoomOwns; onRoomOwns = function (m) {
      if (m.m && !MP.srvOwns.m) window.__atTake = JSON.parse(${TROOP});
      return f(m); }; return 1; })()`);
    await ev(A, `(() => { const c = MP.client, pub = c.publish; window.__mobs = 0; window.__withM = 0;
      c.publish = function (t, pl) { if (t.slice(-4) === '/mob') { window.__mobs++; if (JSON.parse(pl).m) window.__withM++; } return pub.apply(this, arguments); }; return 1; })()`);
    const B = await room.player({ room: 'troop', nick: 'Ben' });
    await B.join();
    const taken = (await until(A, 'MP.srvOwns.m && !troopSim()', 10)) && (await until(B, 'MP.srvOwns.m', 10));
    const RT = room.rooms.get('troop').relay.creatures.troop;
    const took = RT.took || [], before = JSON.parse(await ev(A, 'JSON.stringify(window.__atTake || [])'));
    const off = took.map(([mi, x, z]) => { const b = before.find((q) => q[0] === mi); return b ? Math.hypot(b[1] - x, b[2] - z) : 99; });
    check('a second player arrives: the room takes the troop over, from where it was', taken && took.length === before.length && Math.max(...off) < 2,
      took.length + ' monkeys; the furthest from where the host had it when told ' + Math.max(...off).toFixed(1) + ' m');
    await ev(A, 'window.__mobs = 0; window.__withM = 0; 1');
    await sleep(1500);
    const mobs = await ev(A, 'window.__mobs'), withM = await ev(A, 'window.__withM');
    check('and the host\'s game stops sending it', mobs > 5 && withM === 0, withM + ' of ' + mobs + ' snapshots carried the troop');
    await sleep(500);
    const ta = JSON.parse(await ev(A, TROOP)), tb = JSON.parse(await ev(B, TROOP));
    const gap = ta.map(([mi, x, z]) => { const b = tb.find((q) => q[0] === mi); return b ? Math.hypot(b[1] - x, b[2] - z) : 99; });
    check('both see the monkeys in the same places', ta.length === tb.length && Math.max(...gap) < 3, 'the furthest apart ' + Math.max(...gap).toFixed(2) + ' m');

    // ---- a shot ------------------------------------------------------------------------
    const target = ta[0][0];
    const m = RT.T.monkeys[target], hp0 = m.hp;
    const shot = await shoot(A, target);
    const landed = await until(B, `monkeyPeds[${target}].hp < ${hp0}`, 3);
    const turned = (await until(A, 'troop.rageT > 0 && document.getElementById("rage").classList.contains("on")', 3)) && (await until(B, 'troop.rageT > 0 && document.getElementById("rage").classList.contains("on")', 3));
    const R = room.rooms.get('troop').relay;
    check('a shot at a monkey lands on the room\'s word, and both see it', shot && m.hp === hp0 - 20 && landed, hp0 + ' → ' + m.hp + (R.lastRefusal ? '; last refused: ' + R.lastRefusal : ''));
    check('and the whole troop turns, on both screens', turned && RT.T.rageT > 0);

    // ---- taken down ------------------------------------------------------------------------
    const kills0 = await ev(A, 'myKills');
    let down = false;
    for (let i = 0; i < 8 && !down; i++) {
      await sleep(350);
      if (!(RT.T.monkeys[target].hp > 0)) break;
      await shoot(A, target);
      down = (await until(A, `monkeyPeds[${target}].hp <= 0`, 2)) && (await until(B, `monkeyPeds[${target}].hp <= 0`, 2));
    }
    const kills1 = await ev(A, 'myKills');
    check('taken down: gone on both screens, and it counts towards the tear for whoever shot it', down && RT.T.monkeys[target].hp <= 0 && kills1 === kills0 + 1,
      'kills ' + kills0 + ' → ' + kills1 + '; room hp ' + RT.T.monkeys[target].hp);

    // ---- given back --------------------------------------------------------------------------
    const last = JSON.parse(await ev(A, TROOP));
    await B.close();
    const back = await until(A, '!MP.srvOwns.m && troopSim()', 10);
    await sleep(1000);
    const now = JSON.parse(await ev(A, TROOP));
    const jump = now.map(([mi, x, z]) => { const b = last.find((q) => q[0] === mi); return b ? Math.hypot(b[1] - x, b[2] - z) : 0; });
    const going = await ev(A, 'troop.rageT > 0');
    check('the second player leaves: the troop is given back, and carries on from where it was, still raging', back && Math.max(...jump) < 14 && going,
      now.length + ' in play; the furthest any moved in that moment ' + Math.max(...jump).toFixed(1) + ' m');

    const errs = A.errors.concat(B.errors);
    check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  } finally {
    await room.close();
  }
  console.log('\nTHE MONKEY TROOP, RUN BY THE ROOM: ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

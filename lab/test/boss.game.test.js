'use strict';
//  ============================================================
//  BEELZEBUB, RUN BY THE ROOM — handed over and back, and fought
//  ============================================================
//  The real game, with the room running him once two are here
//  (server/creatures.js, server/boss.js — the room's real code, in this
//  process, as the harness runs it). Checked:
//
//    - alone, the player's game runs him, as it always has
//    - a second player arrives: the room takes him over, from where he was,
//      and the host's game stops running him and stops sending him
//    - both see him in the same place; both players' shots land, on the room's word
//    - he fights: a player close to him is cut (each game judges his blade for itself)
//    - the second player leaves: the room gives him back, from where he was
//    - another arrives: the room takes him again
//    - he falls for everyone, and does not rise again at that tear
//
//    node lab/test/boss.game.test.js     (about two minutes)

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
const HIM = "JSON.stringify({ live: bzb.live, x: +bzb.x.toFixed(1), z: +bzb.z.toFixed(1), hp: Math.round(bzb.hp), hpMax: bzb.hpMax, mode: bzb.mode, runs: !!(bzbAI && bzbAI.body), room: MP.srvOwns.b })";
const him = async (P) => JSON.parse(await ev(P, HIM));
//  back on their feet, on the room's account too (it may have seen them cut down)
const upAgain = (P) => ev(P, "MP.client.publish(mtopic('spawn'), '{}'); hp = HP_MAX; dead = false; updateHpUI(); gameoverEl.classList.remove('show'); 1");
//  stand a player d metres from him, facing him, out of the traffic, with a
//  clear line to his chest (a wall between would stop a shot before it left)
const near = (P, d) => ev(P, `(() => { carHitCd = 1e9; const a = Math.atan2(p.x - bzb.x, p.z - bzb.z) || 0;
  const ro = new THREE.Vector3(), rd = new THREE.Vector3();
  for (let k = 0; k < 32; k++) { const aa = a + k * 0.196, x = bzb.x + Math.sin(aa) * ${d}, z = bzb.z + Math.cos(aa) * ${d};
    if (!clearAt(x, z, 0.8)) continue;
    ro.set(x, EYE, z); rd.set(bzb.x - x, bzb.alt + 2.6 - EYE, bzb.z - z); const L = rd.length(); rd.normalize();
    if (rayCity(ro, rd, L) < L - 1) continue;
    p.set(x, EYE, z); vy = 0; yaw = Math.atan2(-(bzb.x - x), -(bzb.z - z)); publishState(true); return 1; }
  return 0; })()`);
//  a real shot at his chest; the walkers and the troop step out of the line
//  first. window.__bhits counts the shots that hit him here and went to the room.
const SHOOT = `(() => { mode = 'mobile'; for (const e of peds) e.wx += 500;
  if (!window.__counting) { window.__counting = 1; window.__bhits = 0; const f = sendBzbHit; sendBzbHit = function (d) { window.__bhits++; return f(d); }; }
  const dx = bzb.x - p.x, dz = bzb.z - p.z; yaw = Math.atan2(-dx, -dz); pitch = Math.atan2(bzb.alt + 2.6 - p.y, Math.hypot(dx, dz));
  fireCd = 0; reloading = 0; ammo = Math.max(ammo, 5); fire(); return 1; })()`;

(async () => {
  const room = await openRoom({ creatures: true });
  try {
    const A = await room.player({ room: 'bossroom', nick: 'Aki' });
    await A.join(); await sleep(2500);
    await A.eval(() => { window.__t.myKills = 9; window.__t.creditMyKill(); });
    const up = await until(A, 'bzb.live && bzbAI && bzbAI.body', 30);
    const a0 = await him(A);
    check('alone, the player\'s game runs him, as it always has', up && a0.runs && !a0.room, JSON.stringify(a0));

    // ---- a second player: the room takes him --------------------------------
    await near(A, 14); await sleep(1500);
    //  where A's game had him when the room's word came
    await ev(A, `(() => { const f = onRoomOwns; onRoomOwns = function (m) {
      if (m.b && !MP.srvOwns.b) window.__atTake = { x: bzb.x, z: bzb.z, hp: Math.round(bzb.hp) };
      if (!m.b && MP.srvOwns.b) window.__given = m.s;
      const r = f(m);
      if (!m.b && m.s) window.__atGive = { x: bzb.x, z: bzb.z, hp: Math.round(bzb.hp) };
      return r; }; return 1; })()`);
    const B = await room.player({ room: 'bossroom', nick: 'Ben' });
    await B.join();
    const taken = (await until(A, 'MP.srvOwns.b && !(bzbAI && bzbAI.body)', 10)) && (await until(B, 'MP.srvOwns.b && bzb.live', 10));
    const R = room.rooms.get('bossroom').relay, boss = R.creatures.boss;
    const before = JSON.parse(await ev(A, 'JSON.stringify(window.__atTake || null)')), took = boss.took;
    check('a second player arrives: the room takes him over, from where he was', taken && before && took && Math.hypot(took.x - before.x, took.z - before.z) < 3 && took.hp === before.hp,
      'the host had him at ' + JSON.stringify(before) + ' when told; the room took him at ' + JSON.stringify(took));
    await ev(A, `(() => { const c = MP.client, pub = c.publish; window.__mobB = 0; window.__mobs = 0;
      c.publish = function (t, pl) { if (t.slice(-4) === '/mob') { window.__mobs++; if (JSON.parse(pl).b) window.__mobB++; } return pub.apply(this, arguments); }; return 1; })()`);
    await sleep(1500);
    const mobs = await ev(A, 'window.__mobs'), withB = await ev(A, 'window.__mobB');
    check('and the host\'s game stops running him, and stops sending him', mobs > 5 && withB === 0 && !(await him(A)).runs, withB + ' of ' + mobs + ' snapshots carried him');
    await near(B, 12); await sleep(1500);
    const ha = await him(A), hb = await him(B);
    check('both see him in the same place', ha.live && hb.live && Math.hypot(ha.x - hb.x, ha.z - hb.z) < 2, JSON.stringify(ha) + ' | ' + JSON.stringify(hb));

    // ---- shots ------------------------------------------------------------------
    const hp0 = Math.round(boss.st.hp);
    await near(A, 12); await sleep(300); await ev(A, SHOOT);
    const landedA = await until(B, 'Math.round(bzb.hp) < ' + hp0, 3);
    const hp1 = Math.round(boss.st.hp);
    await near(B, 16); await sleep(300); await ev(B, SHOOT);
    const landedB = await until(A, 'Math.round(bzb.hp) < ' + hp1, 3);
    check('both players\' shots land, on the room\'s word, and both see it', landedA && landedB,
      hp0 + ' → ' + hp1 + ' → ' + Math.round(boss.st.hp) + '; hits sent: A ' + (await ev(A, 'window.__bhits')) + ', B ' + (await ev(B, 'window.__bhits')) +
      (R.lastRefusal ? '; last refused: ' + R.lastRefusal : ''));

    // ---- he fights ----------------------------------------------------------------
    let cut = false;
    for (let i = 0; i < 40 && !cut; i++) {
      await near(A, 4); await near(B, 5); await ev(A, 'hp = Math.max(hp, 60); 1'); await ev(B, 'hp = Math.max(hp, 60); 1');
      await sleep(500);
      cut = (await ev(A, 'hp < 60 || dead')) || (await ev(B, 'hp < 60 || dead'));
    }
    check('he fights: a player close to him is cut', cut, 'swings so far: ' + boss.st.atkSeq + ', decisions ' + boss.ai.thinks);

    // ---- given back, taken again ------------------------------------------------------
    await upAgain(A); await upAgain(B); await near(A, 14); await sleep(800);
    await B.close();
    const back = await until(A, '!MP.srvOwns.b && bzbAI && bzbAI.body', 10);
    const given = JSON.parse(await ev(A, 'JSON.stringify(window.__given || null)')), atGive = JSON.parse(await ev(A, 'JSON.stringify(window.__atGive || null)'));
    check('the second player leaves: the room gives him back, from where he was', back && given && atGive && Math.hypot(atGive.x - given[0] / 10, atGive.z - given[1] / 10) < 1 && atGive.hp === given[4],
      'the room\'s last word ' + JSON.stringify(given) + '; the host took him at ' + JSON.stringify(atGive));
    const C = await room.player({ room: 'bossroom', nick: 'Cho' });
    await C.join();
    const again = (await until(A, 'MP.srvOwns.b && !(bzbAI && bzbAI.body)', 10)) && (await until(C, 'MP.srvOwns.b && bzb.live', 10));
    check('another arrives: the room takes him again', again, JSON.stringify(await him(C)));

    // ---- he falls ---------------------------------------------------------------------
    await upAgain(A); await sleep(300);
    boss.ai.body.hp = 10; boss.st.hp = 10;                      // (a whole fight is 320 shots)
    let fell = false;
    for (let i = 0; i < 5 && !fell; i++) {                       // (he may be in the air, or behind something, for a shot or two)
      await near(A, 12); await sleep(300); await ev(A, SHOOT);
      fell = (await until(A, "bzb.mode === 'dead'", 2)) && (await until(C, "bzb.mode === 'dead'", 3));
    }
    check('he falls for everyone', fell, JSON.stringify(await him(A)) + ' | ' + JSON.stringify(await him(C)) +
      '; hits sent by A ' + (await ev(A, 'window.__bhits')) + (R.lastRefusal ? '; last refused: ' + R.lastRefusal : ''));
    await sleep(13000);
    const gone = !(await ev(A, 'bzb.live')) && !(await ev(C, 'bzb.live')) && !boss.st;
    check('and does not rise again at that tear', gone, JSON.stringify(await him(A)));

    const errs = A.errors.concat(C.errors);
    check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  } finally {
    await room.close();
  }
  console.log('\nBEELZEBUB, RUN BY THE ROOM: ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

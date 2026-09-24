'use strict';
//  ============================================================
//  WHERE PLAYERS ARE — the room checks it; playing never trips it
//  ============================================================
//  The real game, two players, in a room that checks every step
//  (server/move.js, as every room on Cloudflare does). A step further than
//  anyone could have gone is not passed on, and the player is put back.
//  What must never be put back is ordinary play, however it moves you:
//
//    - running about for 20 s, turning and jumping, into walls and all
//    - crossing the tear (the game puts you beside it on the other side)
//    - over there, the mind flayer's stamp (11 m at once) and VECNA's pull
//      (28 m in a second and a half)
//    - dying and getting back up, somewhere else entirely
//
//  and what must be: a 200 m jump, and three times running speed.
//
//    node lab/test/move.game.test.js     (about a minute and a half)

const { openRoom, sleep } = require('./harness/page.js');
const RULES = require('../../shared/rules.js');

const results = [];
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  results.push((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '\n         ' + detail : ''));
}
const ev = (P, src) => P.eval((s) => window.__t.ev(s), src);
async function until(P, src, secs) {
  for (let i = 0; i < secs * 10; i++) { if (await ev(P, src)) return true; await sleep(100); }
  return false;
}
//  in the page: move p toward (tx, tz) the way VECNA's pull does, for secs
const PULL = (tx, tz, secs) => `new Promise((done) => { const t0 = performance.now(); let last = t0;
  const f = (now) => { const dt = Math.min(0.05, (now - last) / 1000); last = now; const k = Math.min(1, dt * 1.5);
    p.x += (${tx} - p.x) * k; p.z += (${tz} - p.z) * k;
    if (now - t0 < ${secs * 1000}) requestAnimationFrame(f); else done(1); };
  requestAnimationFrame(f); })`;

(async () => {
  const room = await openRoom({ moves: true });
  try {
    const A = await room.player({ room: 'move', nick: 'Aki' });
    await A.join(); await sleep(1500);
    const B = await room.player({ room: 'move', nick: 'Ben' });
    await B.join(); await sleep(4000);
    check('the game and the room agree how fast anyone runs and how big the city is',
      (await ev(A, 'RUN')) === RULES.RUN && (await ev(A, 'WORLD')) === RULES.WORLD, 'RUN ' + (await ev(A, 'RUN')) + ', WORLD ' + (await ev(A, 'WORLD')));

    // ---- ordinary play --------------------------------------------------------
    await ev(A, "carHitCd = 1e9; keys['KeyW'] = true; keys['ShiftLeft'] = true; 1");
    await ev(B, "carHitCd = 1e9; keys['KeyW'] = true; 1");
    const t0 = Date.now();
    let prev = JSON.parse(await ev(A, 'JSON.stringify([p.x, p.z])')), far = 0;
    while (Date.now() - t0 < 20000) {
      await ev(A, 'yaw += 0.35; if (Math.random() < 0.4) wantJump = true; 1');
      await ev(B, 'yaw -= 0.5; wantJump = true; 1');
      await sleep(700);
      const q = JSON.parse(await ev(A, 'JSON.stringify([p.x, p.z])'));
      far += Math.hypot(q[0] - prev[0], q[1] - prev[1]); prev = q;              // how far it went, not where it ended
    }
    await ev(A, "keys['KeyW'] = keys['ShiftLeft'] = false; 1"); await ev(B, "keys['KeyW'] = false; 1");
    const fx = async () => (await ev(A, 'MP.fixes')) + (await ev(B, 'MP.fixes'));
    check('running about for 20 s, turning and jumping: never put back', (await fx()) === 0 && far > 20,
      (await fx()) + ' times; A ran ' + far.toFixed(0) + ' m');

    // ---- through the tear, and what happens over there ------------------------
    await A.eval(() => { window.__t.myKills = 9; window.__t.creditMyKill(); });
    await until(A, 'rift.present', 15);
    await ev(A, `setWorld(WS.BACK); p.x = rift.x + Math.sin(rift.ry) * 2.6; p.z = rift.z + Math.cos(rift.ry) * 2.6;
      p.y = supportHeight(p.x, p.z, 0) + EYE; publishState(true); 1`);
    await sleep(1500);
    check('crossing the tear, set down beside it on the other side: not put back', (await ev(A, 'MP.fixes')) === 0);
    await ev(A, 'p.x += 11; publishState(true); 1');                 // the mind flayer's stamp
    await sleep(700);
    await A.eval((src) => window.__t.ev(src), PULL('p.x + 28', 'p.z', 1.5));   // VECNA's pull
    await ev(A, 'publishState(true); 1');
    await sleep(1000);
    check('over there, a stamp (11 m at once) and a pull (28 m): not put back', (await ev(A, 'MP.fixes')) === 0);

    await ev(A, 'applyDamage(999, null); 1'); await sleep(600);
    await ev(A, 'doContinue(); 1'); await sleep(1500);
    check('dying and getting back up somewhere else: not put back', (await ev(A, 'MP.fixes')) === 0);

    // ---- what is not believed ---------------------------------------------------
    await ev(A, 'setWorld(WS.NORMAL); 1'); await sleep(2000);          // (back over; a crossing, a while after the last)
    const here = JSON.parse(await ev(A, 'JSON.stringify([p.x, p.z])'));
    await ev(A, 'p.x += 200; if (Math.abs(p.x) > WORLD * 0.47) p.x -= 400; publishState(true); 1');
    const put = await until(A, 'MP.fixes === 1', 3);
    const now = JSON.parse(await ev(A, 'JSON.stringify([p.x, p.z])'));
    check('a 200 m jump: put back where the room had them', put && Math.hypot(now[0] - here[0], now[1] - here[1]) < 3,
      'from ' + here.map((v) => v.toFixed(1)) + ' to ' + now.map((v) => v.toFixed(1)));
    const seen = await ev(B, `(() => { const q = MP.peers.get(${JSON.stringify(await ev(A, 'MP.id'))}); return Math.hypot(q.tgt.x - ${here[0]}, q.tgt.z - ${here[1]}); })()`);
    check('and the other player never saw them there', seen < 3, 'B has them ' + seen.toFixed(1) + ' m from where they were');

    //  down the middle of a road (x = 0 is one), where no wall stops it: got
    //  there the honest way, by dying and being set down there on getting up
    await ev(A, 'applyDamage(999, null); 1'); await sleep(600);
    await ev(A, 'respawn = function () { p.set(0, EYE, -150); }; doContinue(); 1'); await sleep(1500);
    const f0 = await ev(A, 'MP.fixes'), s0 = JSON.parse(await ev(A, 'JSON.stringify([p.x, p.z])'));
    await A.eval((src) => window.__t.ev(src), `new Promise((done) => { const t0 = performance.now(); let last = t0;
      const f = (now) => { const dt = Math.min(0.05, (now - last) / 1000); last = now; p.x = 0; p.z += 3 * RUN * dt;
        if (now - t0 < 6000) requestAnimationFrame(f); else done(1); };
      requestAnimationFrame(f); })`);
    const f1 = await ev(A, 'MP.fixes'), s1 = JSON.parse(await ev(A, 'JSON.stringify([p.x, p.z])'));
    check('three times running speed for 6 s: put back', f1 > f0, (f1 - f0) + ' times; ended ' + Math.hypot(s1[0] - s0[0], s1[1] - s0[1]).toFixed(0) + ' m from where it began');

    const errs = A.errors.concat(B.errors);
    check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  } finally {
    await room.close();
  }
  console.log('\nWHERE PLAYERS ARE\n');
  console.log(results.join('\n'));
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

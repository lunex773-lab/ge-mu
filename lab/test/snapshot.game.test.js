'use strict';
//  ============================================================
//  THE CREATURE SNAPSHOT, TRIMMED — and nothing lost by it
//  ============================================================
//  The host tells everyone else where the creatures are, eight times a
//  second. On the other side that was 11.8 KB/s, most of it the dog packs.
//  Now every eighth snapshot is whole and the rest carry only what someone
//  else might see: the dogs near them, any dog whose health or state has
//  changed, and the daylight troop only while someone is in daylight.
//  Checked, two players standing together on the other side:
//
//    - the other player has the same dogs as the host, near ones where the
//      host has them, far ones no more than a second behind
//    - a far dog's death is heard at once, not a second later
//    - the host sends under half what it did
//    - walking back into daylight, the other player has the troop at once
//
//    node lab/test/snapshot.game.test.js     (about a minute)

const { openRoom, sleep } = require('./harness/page.js');

const results = [];
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  results.push((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '\n         ' + detail : ''));
}
const ev = (P, src) => P.eval((s) => window.__t.ev(s), src);
const DOGS = "JSON.stringify(dogs.filter((d) => d.live).map((d) => [d.slot, d.x, d.z, d.dead ? 1 : 0, d.netX, d.netZ]))";

(async () => {
  const room = await openRoom();
  try {
    const A = await room.player({ room: 'snap', nick: 'Aki' });
    await A.join(); await sleep(1500);
    const B = await room.player({ room: 'snap', nick: 'Ben' });
    await B.join(); await sleep(4000);
    await A.eval(() => { window.__t.myKills = 9; window.__t.creditMyKill(); });
    for (let i = 0; i < 60 && !(await ev(A, 'rift.present')); i++) await sleep(250);
    await ev(A, 'setWorld(WS.BACK); 1'); await ev(B, 'setWorld(WS.BACK); 1');
    for (let i = 0; i < 40 && !(await ev(A, 'dogs.filter((d) => d.live).length > 20')); i++) await sleep(250);
    const stand = (P, dx) => ev(P, `carHitCd = 1e9; p.set(11 + ${dx}, EYE, 10); vy = 0; publishState(true); 1`);
    await stand(A, 0); await stand(B, 3); await sleep(3000);

    // ---- the same dogs -----------------------------------------------------
    const da = JSON.parse(await ev(A, DOGS)), db = JSON.parse(await ev(B, DOGS));
    const bp = JSON.parse(await ev(B, 'JSON.stringify([p.x, p.z])'));
    const mb = new Map(db.map((d) => [d[0], d]));
    let missing = 0, nearOff = 0, farOff = 0, near = 0, far = 0;
    for (const d of da) {
      const o = mb.get(d[0]); if (!o) { missing++; continue; }
      const off = Math.hypot(o[4] - d[1], o[5] - d[2]);
      if (Math.abs(d[1] - bp[0]) < 110 && Math.abs(d[2] - bp[1]) < 110) { near++; nearOff = Math.max(nearOff, off); } else { far++; farOff = Math.max(farOff, off); }
    }
    check('the other player has every dog the host has, and no others', missing === 0 && da.length === db.length && da.length > 20, 'host ' + da.length + ', other ' + db.length + ', missing ' + missing);
    check('near ones where the host has them, far ones at most a second behind', near > 0 && nearOff < 1.0 && farOff < 4.0,
      near + ' near, off by ≤ ' + nearOff.toFixed(2) + ' m; ' + far + ' far, off by ≤ ' + farOff.toFixed(2) + ' m');

    // ---- a far dog dies ---------------------------------------------------
    const farDog = da.filter((d) => !d[3]).sort((p, q) => Math.hypot(q[1] - bp[0], q[2] - bp[1]) - Math.hypot(p[1] - bp[0], p[2] - bp[1]))[0];
    const dist = Math.hypot(farDog[1] - bp[0], farDog[2] - bp[1]);
    await ev(A, `killDog(dogs[${farDog[0]}]); 1`);
    const t0 = Date.now();
    let heard = false;
    while (!heard && Date.now() - t0 < 3000) { heard = await ev(B, `!!(dogs[${farDog[0]}] && dogs[${farDog[0]}].dead)`); if (!heard) await sleep(40); }
    const ms = Date.now() - t0;
    check('a far dog\'s death is heard at once, not with the next whole snapshot', heard && ms < 600, 'dog ' + Math.round(dist) + ' m away, heard after ' + ms + ' ms');

    // ---- what it costs ----------------------------------------------------
    await ev(A, `(() => { const c = MP.client, pub = c.publish; window.__up = 0;
      c.publish = function (t, pl) { window.__up += String(pl).length + 20; return pub.apply(this, arguments); }; return 1; })()`);
    await sleep(8000);
    const kbps = (await ev(A, 'window.__up')) / 8 / 1024;
    check('the host sends under half what it did over here (11.8 KB/s)', kbps < 5.9, kbps.toFixed(2) + ' KB/s');

    // ---- back into daylight -------------------------------------------------
    await ev(B, 'setWorld(WS.NORMAL); publishState(true); 1');
    await sleep(1200);
    const ta = JSON.parse(await ev(A, "JSON.stringify(monkeyPeds.map((m) => [m.hp > 0 ? 1 : 0, m.wx, m.wz]))")), tb = JSON.parse(await ev(B, "JSON.stringify(monkeyPeds.map((m) => [m.hp > 0 ? 1 : 0, m.netX, m.netZ]))"));
    let alive = 0, same = 0, worst = 0;
    ta.forEach((m, i) => { if (!m[0]) return; alive++; const o = tb[i]; if (o && o[0]) { same++; worst = Math.max(worst, Math.hypot(o[1] - m[1], o[2] - m[2])); } });
    check('walking back into daylight, the other player has the troop at once', alive > 0 && same === alive && worst < 3,
      same + ' of ' + alive + ' monkeys, off by ≤ ' + worst.toFixed(1) + ' m');

    const errs = A.errors.concat(B.errors);
    check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  } finally {
    await room.close();
  }
  console.log('\nTHE CREATURE SNAPSHOT, TRIMMED\n');
  console.log(results.join('\n'));
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
